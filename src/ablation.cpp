// ============================================================================
// Flexo Scheduling Ablation — Moser SA-R with Rolling Horizon
// ============================================================================
// Compile C++ files with:
// Remove-Item -Recurse -Force build, \*.egg-info -ErrorAction SilentlyContinue; pip install . --force-reinstall --no-cache-dir
//
// Reimplementation of the Reheating Simulated Annealing (SA-R) algorithm from
// Moser et al. (2022), adapted for the flexo scheduling problem.
// Uses Moser's geometric cooling with reheating, hierarchical neighborhood
// (Block/Single, Shift/Swap, Inter/Intra), constructive heuristic init,
// and batch-flow-time-based guidance (adapted from Moser's makespan guidance).
//
// Sections:
//   1. Headers & Constants
//   2. Data Types
//   3. Ink Changeover Computation
//   4. Schedule Simulation & Evaluation
//   5. SA Context & Workspace
//   6. Moser Neighborhood Moves (apply & revert)
//   7. Moser SA-R Core
//   8. Rolling Horizon Experiment Engine
//   9. Python Bindings
//
// ============================================================================

// ── 1. Headers & Constants ──────────────────────────────────────────────────

#include <pybind11/pybind11.h>
#include <pybind11/stl.h>
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <numeric>
#include <set>
#include <string>
#include <thread>
#include <unordered_map>
#include <unordered_set>
#include <vector>
#include "simulator.h"
#include "pybind_helpers.h"

namespace py = pybind11;

#ifdef _MSC_VER
#define FORCE_INLINE __forceinline
#else
#define FORCE_INLINE inline __attribute__((always_inline))
#endif

using Xoshiro256pp   = flexo_sim::Xoshiro256pp;
using Job            = flexo_sim::Job;
using OrderData      = flexo_sim::OrderData;
using BatchData      = flexo_sim::BatchData;
using MachineState   = flexo_sim::MachineState;
using ThreadLocalCache = flexo_sim::ThreadLocalCache;
using StepResult     = flexo_sim::StepResult;
using SAWorkspace    = flexo_sim::SAWorkspace;
using MoveUndo       = flexo_sim::MoveUndo;
using Solution       = flexo_sim::Solution;
using ExperimentResult = flexo_sim::ExperimentResult;

// ── 2. Data Types ───────────────────────────────────────────────────────────

struct OptimizerConfig {
    std::map<std::string, double> machine_production_rates;
    std::vector<std::string> machines;
    double sequence_dependent_setup_time;
    std::map<std::string, std::map<std::string, double>> initial_state;
    double ink_weight, batch_flow_time_weight;
    int seed, iterations;
    double acceptance_prob;
    std::vector<double> move_probs;
};

// SAContext extends SAContextBase with Moser SA-R–specific parameters.
struct SAContext : flexo_sim::SAContextBase {
    // Moser SA-R neighborhood parameters
    double p_I;    // inter-machine probability (default 0.66)
    double p_S;    // shift probability (default 0.84)
    double p_B;    // block move probability (default 0.04)
    double p_M;    // batch-flow-time guidance probability (default 0.71)
    int B_max;     // max block size (default 26)

    // Moser SA-R cooling parameters
    double T_max;  // initial/reheat temperature (default 2764.93)
    double T_min;  // minimum temperature triggering reheat (default 6.73)
    double alpha;  // geometric cooling rate (default 0.93)
    int N_s;       // iterations per temperature step (default 20)
};

// ── 3. Ink Changeover Computation ───────────────────────────────────────────

// Map-based fitness evaluation (used for initial solution and final scoring)
inline std::tuple<double, double, double, std::vector<std::string>> calculate_fitness(
    const std::map<std::string, std::vector<Job>>& schedule,
    const OptimizerConfig& cfg,
    const std::map<std::string, std::vector<int>>& init_inks,
    ThreadLocalCache& cache) {
    return flexo_sim::calculate_fitness(
        schedule,
        cfg.machine_production_rates,
        cfg.sequence_dependent_setup_time,
        cfg.ink_weight,
        cfg.batch_flow_time_weight,
        init_inks,
        cfg.initial_state,
        cache);
}

// ── 5. SA Context & Workspace ───────────────────────────────────────────────

SAContext build_sa_context(
    const std::vector<Job>& jobs, const OptimizerConfig& cfg,
    const std::map<std::string, std::vector<int>>& init_inks) {

    SAContext ctx;
    ctx.num_machines = (int)cfg.machines.size();
    ctx.setup_time = cfg.sequence_dependent_setup_time;
    ctx.ink_weight = cfg.ink_weight;
    ctx.batch_flow_time_weight = cfg.batch_flow_time_weight;

    // Unpack Moser SA-R parameters from move_probs vector
    // Layout: [p_I, p_S, p_B, p_M, B_max, T_max, T_min, N_s, alpha]
    ctx.p_I   = cfg.move_probs.size() > 0 ? cfg.move_probs[0] : 0.66;
    ctx.p_S   = cfg.move_probs.size() > 1 ? cfg.move_probs[1] : 0.84;
    ctx.p_B   = cfg.move_probs.size() > 2 ? cfg.move_probs[2] : 0.04;
    ctx.p_M   = cfg.move_probs.size() > 3 ? cfg.move_probs[3] : 0.71;
    ctx.B_max = cfg.move_probs.size() > 4 ? (int)cfg.move_probs[4] : 26;
    ctx.T_max = cfg.move_probs.size() > 5 ? cfg.move_probs[5] : 2764.93;
    ctx.T_min = cfg.move_probs.size() > 6 ? cfg.move_probs[6] : 6.73;
    ctx.N_s   = cfg.move_probs.size() > 7 ? (int)cfg.move_probs[7] : 20;
    ctx.alpha = cfg.move_probs.size() > 8 ? cfg.move_probs[8] : 0.93;

    // Build unique ink pattern index (pattern 0 = empty = cleared inks)
    std::map<std::vector<int>, int> ink_map;
    std::vector<std::vector<int>> patterns = {{}};
    ink_map[{}] = 0;

    auto register_pattern = [&](const std::vector<int>& inks) {
        if (ink_map.find(inks) == ink_map.end()) {
            ink_map[inks] = (int)patterns.size();
            patterns.push_back(inks);
        }
    };
    for (auto& j : jobs) register_pattern(j.inks);
    for (auto& [m, inks] : init_inks) register_pattern(inks);

    // Flatten changeover matrix
    ctx.num_patterns = (int)patterns.size();
    ctx.changeover_matrix.resize(ctx.num_patterns * ctx.num_patterns, 0);
    for (int i = 0; i < ctx.num_patterns; i++)
        for (int j = 0; j < ctx.num_patterns; j++)
            ctx.changeover_matrix[i * ctx.num_patterns + j] =
                flexo_sim::changeover_compute(patterns[i], patterns[j]);

    // Build quantity index and processing time table
    std::map<int, int> qty_map;
    std::vector<int> qtys;
    for (auto& j : jobs) {
        if (qty_map.find(j.production_quantity) == qty_map.end()) {
            qty_map[j.production_quantity] = (int)qtys.size();
            qtys.push_back(j.production_quantity);
        }
    }
    ctx.num_qtys = (int)qtys.size();
    ctx.proc_times.resize(ctx.num_machines * ctx.num_qtys);
    for (int m = 0; m < ctx.num_machines; m++) {
        double rate = cfg.machine_production_rates.at(cfg.machines[m]);
        for (int q = 0; q < ctx.num_qtys; q++)
            ctx.proc_times[m * ctx.num_qtys + q] = qtys[q] / rate / 60.0;
    }

    // Per-job SoA vectors
    int nj = (int)jobs.size();
    ctx.num_jobs = nj;
    ctx.job_ink_pattern_idx.resize(nj);
    ctx.job_qty_idx.resize(nj);
    ctx.job_arrival_time.resize(nj);
    ctx.job_order_code.resize(nj);
    ctx.job_inks.resize(nj);
    ctx.job_production_quantity.resize(nj);

    // Arrival time index for batch grouping
    std::set<double> unique_arr;
    for (auto& j : jobs) unique_arr.insert(j.arrival_time);
    ctx.arrival_time_values.assign(unique_arr.begin(), unique_arr.end());
    ctx.num_arrival_times = (int)ctx.arrival_time_values.size();
    std::map<double, int> arr_map;
    for (int i = 0; i < ctx.num_arrival_times; i++)
        arr_map[ctx.arrival_time_values[i]] = i;
    ctx.job_arrival_idx.resize(nj);

    for (int i = 0; i < nj; i++) {
        ctx.job_ink_pattern_idx[i] = ink_map[jobs[i].inks];
        ctx.job_qty_idx[i] = qty_map[jobs[i].production_quantity];
        ctx.job_arrival_time[i] = jobs[i].arrival_time;
        ctx.job_order_code[i] = jobs[i].order_code;
        ctx.job_inks[i] = jobs[i].inks;
        ctx.job_production_quantity[i] = jobs[i].production_quantity;
        ctx.job_arrival_idx[i] = arr_map[jobs[i].arrival_time];
    }

    // Machine initial states
    ctx.init_ink_patterns.resize(ctx.num_machines);
    ctx.init_times.resize(ctx.num_machines, 0.0);
    for (int m = 0; m < ctx.num_machines; m++) {
        const std::string& mname = cfg.machines[m];
        auto it = init_inks.find(mname);
        ctx.init_ink_patterns[m] = (it != init_inks.end()) ? ink_map[it->second] : 0;
        auto it2 = cfg.initial_state.find(mname);
        if (it2 != cfg.initial_state.end()) {
            auto it3 = it2->second.find("time");
            if (it3 != it2->second.end()) ctx.init_times[m] = it3->second;
        }
    }
    return ctx;
}

// ── 6. Moser Neighborhood Moves (apply & revert) ───────────────────────────
//
// Moser SA-R hierarchical move selection:
//   1. Block (p_B) or Single
//   2. Shift (p_S) or Swap
//   3. Inter-machine (p_I) or Intra-machine
//
// Batch-flow-time guidance (adapted from Moser's makespan guidance):
//   With probability p_M, fix source machine to one that causes the worst
//   batch completion (critical machine). For multi-batch, all critical machines
//   across batches are collected and one is chosen randomly.
//
// Move types stored in MoveUndo:
//   0 = intra-swap (single)    1 = inter-swap (single)
//   2 = intra-shift (single)   3 = inter-shift (single)
//   5 = intra-block-shift      6 = inter-block-shift
//   7 = inter-block-swap       8 = intra-block-swap

void apply_moser_move_internal(
    std::vector<std::vector<int>>& schedule,
    const SAContext& ctx, SAWorkspace& ws, Xoshiro256pp& rng,
    MoveUndo& undo, const std::vector<int>& cur_crit) {

    int n_m = ctx.num_machines;

    // ── Moser hierarchical move selection ──
    bool is_block = rng.next_double() < ctx.p_B;
    int L = is_block ? (int)(2 + rng.bounded(std::max(1, ctx.B_max - 1))) : 1;
    bool is_shift = rng.next_double() < ctx.p_S;
    bool is_inter = rng.next_double() < ctx.p_I;

    // ── Batch-flow-time guidance (Moser's makespan guidance adapted) ──
    // Pick source machine from critical set (machines causing worst batch flow time)
    int mf;
    bool guided = rng.next_double() < ctx.p_M && !cur_crit.empty();
    if (guided) {
        mf = cur_crit[(int)rng.bounded((uint64_t)cur_crit.size())];
    } else {
        mf = (int)rng.bounded((uint64_t)n_m);
    }

    // Pick second machine != mf for inter-machine moves
    int m2 = mf;
    if (is_inter) {
        if (n_m <= 1) { undo.move_type = -1; return; }
        int raw = (int)rng.bounded((uint64_t)(n_m - 1));
        m2 = (raw >= mf) ? raw + 1 : raw;
    }

    undo.m1 = mf;
    undo.m2 = m2;
    auto& j1 = schedule[mf];
    auto& j2 = schedule[m2];

    auto rnd = [&](size_t lo, size_t hi) -> size_t {
        return lo + rng.bounded(hi - lo + 1);
    };

    // Clamp block size to available jobs on source machine
    if (is_block) {
        L = std::min(L, (int)j1.size());
        if (L < 2) { is_block = false; L = 1; }
    }

    if (!is_block) {
        // ── Single job moves ──
        if (is_shift) {
            if (is_inter) {
                // Inter-shift: move job from mf to m2
                if (j1.empty()) { undo.move_type = -1; return; }
                undo.move_type = 3;
                size_t i = rnd(0, j1.size()-1);
                int job = j1[i];
                j1.erase(j1.begin() + i);
                size_t pos = rnd(0, j2.size());
                j2.insert(j2.begin() + pos, job);
                undo.i1 = i; undo.i2 = pos;
            } else {
                // Intra-shift: relocate within mf
                if (j1.size() < 2) { undo.move_type = -1; return; }
                undo.move_type = 2;
                size_t i = rnd(0, j1.size()-1);
                int job = j1[i];
                j1.erase(j1.begin() + i);
                size_t pos = rnd(0, j1.size());
                j1.insert(j1.begin() + pos, job);
                undo.i1 = i; undo.i2 = pos;
            }
        } else {
            if (is_inter) {
                // Inter-swap: swap one job between machines
                if (j1.empty() || j2.empty()) { undo.move_type = -1; return; }
                undo.move_type = 1;
                undo.i1 = rnd(0, j1.size()-1);
                undo.i2 = rnd(0, j2.size()-1);
                std::swap(j1[undo.i1], j2[undo.i2]);
            } else {
                // Intra-swap: swap two jobs on mf
                if (j1.size() < 2) { undo.move_type = -1; return; }
                undo.move_type = 0;
                size_t a = rnd(0, j1.size()-1), b = rnd(0, j1.size()-1);
                while (a == b) b = rnd(0, j1.size()-1);
                undo.i1 = a; undo.i2 = b;
                std::swap(j1[a], j1[b]);
            }
        }
    } else {
        // ── Block moves (L >= 2) ──
        if (is_shift) {
            if (is_inter) {
                // Inter-block-shift: move block from mf to m2
                if ((int)j1.size() < L) { undo.move_type = -1; return; }
                undo.move_type = 6;
                size_t max_start = j1.size() - L;
                size_t i = rnd(0, max_start);
                size_t jj = i + L;
                undo.i1 = i; undo.j1 = jj;
                undo.saved_len1 = L;
                std::copy(j1.begin() + i, j1.begin() + jj, ws.move_buf1.begin());
                j1.erase(j1.begin() + i, j1.begin() + jj);
                size_t pos = rnd(0, j2.size());
                undo.i2 = pos;
                j2.insert(j2.begin() + pos, ws.move_buf1.begin(), ws.move_buf1.begin() + L);
            } else {
                // Intra-block-shift: relocate block within mf
                if ((int)j1.size() < L) { undo.move_type = -1; return; }
                undo.move_type = 5;
                size_t max_start = j1.size() - L;
                size_t i = rnd(0, max_start);
                size_t jj = i + L;
                undo.i1 = i; undo.j1 = jj;
                undo.saved_len1 = L;
                std::copy(j1.begin() + i, j1.begin() + jj, ws.move_buf1.begin());
                j1.erase(j1.begin() + i, j1.begin() + jj);
                size_t pos = rnd(0, j1.size());
                undo.i2 = pos;
                j1.insert(j1.begin() + pos, ws.move_buf1.begin(), ws.move_buf1.begin() + L);
            }
        } else {
            if (is_inter) {
                // Inter-block-swap: swap same-size blocks between machines
                if ((int)j1.size() < L || (int)j2.size() < L) { undo.move_type = -1; return; }
                undo.move_type = 7;
                size_t i1 = rnd(0, j1.size() - L);
                size_t i2 = rnd(0, j2.size() - L);
                undo.i1 = i1; undo.j1 = i1 + L;
                undo.i2 = i2; undo.j2 = i2 + L;
                undo.saved_len1 = L;
                undo.saved_len2 = L;
                std::copy(j1.begin() + i1, j1.begin() + i1 + L, ws.move_buf1.begin());
                std::copy(j2.begin() + i2, j2.begin() + i2 + L, ws.move_buf2.begin());
                // Same-size blocks: swap in-place
                std::copy(ws.move_buf2.begin(), ws.move_buf2.begin() + L, j1.begin() + i1);
                std::copy(ws.move_buf1.begin(), ws.move_buf1.begin() + L, j2.begin() + i2);
            } else {
                // Intra-block-swap: swap two non-overlapping blocks on same machine
                if ((int)j1.size() < 2 * L) { undo.move_type = -1; return; }
                undo.move_type = 8;
                size_t a = rnd(0, j1.size() - L);
                size_t b;
                int tries = 0;
                do {
                    b = rnd(0, j1.size() - L);
                    tries++;
                } while (tries < 20 && !(b + L <= a || a + L <= b));
                if (!(b + L <= a || a + L <= b)) { undo.move_type = -1; return; }
                undo.i1 = a; undo.i2 = b;
                undo.saved_len1 = L;
                std::copy(j1.begin() + a, j1.begin() + a + L, ws.move_buf1.begin());
                std::copy(j1.begin() + b, j1.begin() + b + L, ws.move_buf2.begin());
                // Swap in-place
                std::copy(ws.move_buf2.begin(), ws.move_buf2.begin() + L, j1.begin() + a);
                std::copy(ws.move_buf1.begin(), ws.move_buf1.begin() + L, j1.begin() + b);
            }
        }
    }
}

void revert_move_internal(
    std::vector<std::vector<int>>& schedule, const MoveUndo& undo,
    const SAWorkspace& ws) {

    if (undo.move_type < 0) return;
    auto& j1 = schedule[undo.m1];
    auto& j2 = schedule[undo.m2];

    switch (undo.move_type) {
    case 0: std::swap(j1[undo.i1], j1[undo.i2]); break;
    case 1: std::swap(j1[undo.i1], j2[undo.i2]); break;
    case 2: {
        int job = j1[undo.i2];
        j1.erase(j1.begin() + undo.i2);
        j1.insert(j1.begin() + undo.i1, job);
        break;
    }
    case 3: {
        int job = j2[undo.i2];
        j2.erase(j2.begin() + undo.i2);
        j1.insert(j1.begin() + undo.i1, job);
        break;
    }
    case 5: {
        j1.erase(j1.begin() + undo.i2, j1.begin() + undo.i2 + undo.saved_len1);
        j1.insert(j1.begin() + undo.i1, ws.move_buf1.begin(), ws.move_buf1.begin() + undo.saved_len1);
        break;
    }
    case 6: {
        j2.erase(j2.begin() + undo.i2, j2.begin() + undo.i2 + undo.saved_len1);
        j1.insert(j1.begin() + undo.i1, ws.move_buf1.begin(), ws.move_buf1.begin() + undo.saved_len1);
        break;
    }
    case 7: {
        // Inter-block-swap: restore originals from buffers (same-size blocks)
        std::copy(ws.move_buf1.begin(), ws.move_buf1.begin() + undo.saved_len1, j1.begin() + undo.i1);
        std::copy(ws.move_buf2.begin(), ws.move_buf2.begin() + undo.saved_len2, j2.begin() + undo.i2);
        break;
    }
    case 8: {
        // Intra-block-swap: restore originals from buffers (same machine)
        std::copy(ws.move_buf1.begin(), ws.move_buf1.begin() + undo.saved_len1, j1.begin() + undo.i1);
        std::copy(ws.move_buf2.begin(), ws.move_buf2.begin() + undo.saved_len1, j1.begin() + undo.i2);
        break;
    }
    }
}

// ── 7. Moser SA-R Core ────────────────────────────────────────────────────

// Moser Constructive Heuristic: sort by arrival time (analog to due date),
// greedily assign each job to the machine with lowest resulting machine span.
// Ties are broken randomly (Moser spec).
Solution create_initial_solution(
    std::vector<Job> jobs, const OptimizerConfig& cfg,
    const std::map<std::string, std::vector<int>>& init_inks,
    ThreadLocalCache& cache, Xoshiro256pp& rng) {

    // Sort by arrival time ascending (Moser sorts by due date)
    std::sort(jobs.begin(), jobs.end(), [](const Job& a, const Job& b) {
        return a.arrival_time < b.arrival_time;
    });

    std::map<std::string, std::vector<Job>> schedule;
    std::map<std::string, double> machine_times;
    std::map<std::string, std::vector<int>> machine_inks;

    for (auto& m : cfg.machines) {
        schedule[m] = {};
        machine_times[m] = 0;
        auto it = cfg.initial_state.find(m);
        if (it != cfg.initial_state.end()) {
            auto tt = it->second.find("time");
            if (tt != it->second.end()) machine_times[m] = tt->second;
        }
        auto ii = init_inks.find(m);
        machine_inks[m] = (ii != init_inks.end()) ? ii->second : std::vector<int>{};
    }

    // Greedy assignment: each job → machine with lowest span after assignment
    for (auto& job : jobs) {
        double best_span = 1e18;
        std::string best_m;
        int tie_count = 0;

        for (auto& m : cfg.machines) {
            // Trial: simulate adding job to end of machine m (copy state)
            double trial_t = machine_times[m];
            std::vector<int> trial_inks = machine_inks[m];
            double proc = flexo_sim::get_proc_time(m, job.production_quantity, cfg.machine_production_rates, cache);
            auto step = flexo_sim::simulate_job_step(
                trial_t, trial_inks, job.arrival_time, job.inks,
                cfg.sequence_dependent_setup_time, proc, cache);

            if (step.done < best_span) {
                best_span = step.done;
                best_m = m;
                tie_count = 1;
            } else if (step.done == best_span) {
                // Moser tie-breaking: random among tied machines
                tie_count++;
                if ((int)rng.bounded(tie_count) == 0) best_m = m;
            }
        }

        // Commit assignment on chosen machine
        double proc = flexo_sim::get_proc_time(best_m, job.production_quantity, cfg.machine_production_rates, cache);
        flexo_sim::simulate_job_step(
            machine_times[best_m], machine_inks[best_m],
            job.arrival_time, job.inks,
            cfg.sequence_dependent_setup_time, proc, cache);
        schedule[best_m].push_back(job);
    }

    Solution sol;
    sol.schedule = schedule;
    auto [fit, ink, bft, crit] = calculate_fitness(schedule, cfg, init_inks, cache);
    sol.fitness = fit;
    sol.ink_changes = ink;
    sol.batch_flow_time = bft;
    sol.critical_machines = crit;
    return sol;
}

// Moser Reheating Simulated Annealing (SA-R)
//
// Cooling schedule:
//   - Start at T_max
//   - Inner loop: N_s iterations at current temperature
//   - After inner loop: t_c *= alpha (geometric cooling)
//   - When t_c < T_min: reheat to T_max
//   - Terminate after 'iterations' total SA iterations
//
// Acceptance: delta < 0 → accept; delta >= 0 → accept if random < exp(-delta/t_c)
Solution optimize(
    std::vector<Job> jobs, const OptimizerConfig& cfg,
    const std::map<std::string, std::vector<int>>& init_inks,
    ThreadLocalCache& cache) {

    flexo_sim::prewarm_caches(jobs, cfg.machines, cfg.machine_production_rates, cache);
    Xoshiro256pp rng((uint64_t)(unsigned)cfg.seed);

    // Build initial solution using Moser constructive heuristic
    Solution initial = create_initial_solution(jobs, cfg, init_inks, cache, rng);
    SAContext ctx = build_sa_context(jobs, cfg, init_inks);

    // Map order codes and machine names to flat indices
    std::map<std::string, int> order_idx, machine_idx;
    for (int i = 0; i < ctx.num_jobs; i++)
        order_idx[ctx.job_order_code[i]] = i;
    for (int i = 0; i < (int)cfg.machines.size(); i++)
        machine_idx[cfg.machines[i]] = i;

    // Convert initial solution to indexed schedule
    std::vector<std::vector<int>> cur_sched(ctx.num_machines);
    for (auto& [m, jlist] : initial.schedule)
        for (auto& j : jlist)
            cur_sched[machine_idx[m]].push_back(order_idx[j.order_code]);

    SAWorkspace ws;
    ws.init(ctx);

    // Evaluate initial solution
    flexo_sim::calculate_fitness_internal(cur_sched, ctx, ws);

    double cur_fit = ws.fitness, cur_ink = ws.ink_changes, cur_bft = ws.batch_flow_time;
    std::vector<int> cur_crit = ws.crit;  // critical machines for guidance
    auto best_sched = cur_sched;
    double best_fit = cur_fit, best_ink = cur_ink, best_bft = cur_bft;
    std::vector<int> best_crit = ws.crit;

    // Moser SA-R temperature parameters
    double tc = ctx.T_max;
    double neg_inv_tc = -1.0 / tc;

    MoveUndo undo;
    int total_iters = 0;

    // ── Moser SA-R main loop ──
    // Outer: temperature stages with geometric cooling + reheating
    // Inner: N_s iterations at each temperature step
    while (total_iters < cfg.iterations) {
        // Inner loop: N_s iterations at current temperature
        for (int s = 0; s < ctx.N_s && total_iters < cfg.iterations; s++, total_iters++) {
            flexo_sim::save_workspace(ws);
            apply_moser_move_internal(cur_sched, ctx, ws, rng, undo, cur_crit);
            if (undo.move_type < 0) continue;

            flexo_sim::calculate_fitness_delta(cur_sched, ctx, ws, undo.m1, undo.m2);
            double delta = ws.fitness - cur_fit;

            bool accept = (delta < 0);
            if (!accept && tc > 0) {
                accept = rng.next_double() < std::exp(delta * neg_inv_tc);
            }

            if (accept) {
                cur_fit = ws.fitness;
                cur_ink = ws.ink_changes;
                cur_bft = ws.batch_flow_time;
                cur_crit = ws.crit;
                if (cur_fit < best_fit) {
                    best_fit = cur_fit;
                    best_ink = cur_ink;
                    best_bft = cur_bft;
                    best_crit = ws.crit;
                    best_sched = cur_sched;
                }
            } else {
                revert_move_internal(cur_sched, undo, ws);
                flexo_sim::restore_workspace(ws);
            }
        }

        // Geometric cooling
        tc *= ctx.alpha;

        // Reheating: if below minimum temperature, reheat to T_max
        if (tc < ctx.T_min) tc = ctx.T_max;

        neg_inv_tc = -1.0 / tc;
    }

    // Convert best indexed schedule back to Solution with Job objects
    Solution best;
    for (int m = 0; m < ctx.num_machines; m++) {
        std::vector<Job> jlist;
        for (int ji : best_sched[m]) {
            Job j;
            j.order_code = ctx.job_order_code[ji];
            j.inks = ctx.job_inks[ji];
            j.production_quantity = ctx.job_production_quantity[ji];
            j.arrival_time = ctx.job_arrival_time[ji];
            j.ink_pattern_idx = ctx.job_ink_pattern_idx[ji];
            j.qty_idx = ctx.job_qty_idx[ji];
            jlist.push_back(std::move(j));
        }
        best.schedule[cfg.machines[m]] = std::move(jlist);
    }
    best.fitness = best_fit;
    best.ink_changes = best_ink;
    best.batch_flow_time = best_bft;
    for (int mi : best_crit)
        best.critical_machines.push_back(cfg.machines[mi]);
    return best;
}

// ── 8. Rolling Horizon Experiment Engine ────────────────────────────────────

ExperimentResult run_experiment_core(
    const std::vector<BatchData>& batches,
    const std::map<std::string, OrderData>& order_lookup,
    const std::map<std::string, double>& machine_production_rates,
    double sequence_dependent_setup_time,
    double ink_weight, double batch_flow_time_weight,
    int seed, int iterations,
    double acceptance_prob,
    const std::vector<double>& move_probs,
    int num_starts, int num_threads) {

    auto t_start = std::chrono::high_resolution_clock::now();
    ThreadLocalCache cache;

    // Build optimizer config
    OptimizerConfig cfg;
    cfg.machine_production_rates = machine_production_rates;
    for (auto& [name, rate] : machine_production_rates) cfg.machines.push_back(name);
    cfg.sequence_dependent_setup_time = sequence_dependent_setup_time;
    cfg.ink_weight = ink_weight;
    cfg.batch_flow_time_weight = batch_flow_time_weight;
    cfg.seed = seed;
    cfg.iterations = iterations;
    cfg.acceptance_prob = acceptance_prob;
    cfg.move_probs = move_probs;

    // Build all jobs and sort batches by arrival
    std::map<std::string, Job> all_jobs;
    std::vector<std::pair<double, std::vector<std::string>>> sorted_batches;
    for (auto& batch : batches) {
        std::vector<std::string> oids;
        for (auto& oid : batch.orders) {
            oids.push_back(oid);
            auto& od = order_lookup.at(oid);
            Job j;
            j.order_code = oid;
            j.production_quantity = od.quantity;
            j.arrival_time = batch.arrival_time;
            j.inks = od.inks;
            all_jobs[oid] = j;
        }
        sorted_batches.push_back({batch.arrival_time, oids});
    }
    std::sort(sorted_batches.begin(), sorted_batches.end());

    std::unique_ptr<std::map<std::string, std::vector<Job>>> current_schedule;
    std::map<std::string, std::vector<int>> init_inks_global;
    Xoshiro256pp base_rng((uint64_t)(unsigned)seed);
    int nthreads = num_threads > 0 ? num_threads : (int)std::thread::hardware_concurrency();

    // Rolling horizon: process each batch arrival
    for (auto& [arrival, oids] : sorted_batches) {
        double now = arrival;

        std::map<std::string, Job> visible;
        for (auto& [oid, j] : all_jobs)
            if (j.arrival_time <= now) visible[oid] = j;

        auto states = flexo_sim::create_machine_states(
            now, cfg.machines, cfg.machine_production_rates,
            cfg.sequence_dependent_setup_time, cfg.initial_state,
            current_schedule.get(), init_inks_global, cache);
        auto unlocked = flexo_sim::build_unlocked_jobs(states, visible);
        if (unlocked.empty()) continue;

        OptimizerConfig batch_cfg = cfg;
        std::map<std::string, std::vector<int>> batch_init_inks;
        for (auto& [m, s] : states) {
            batch_cfg.initial_state[m]["time"] = s.current_time;
            batch_init_inks[m] = s.current_inks;
        }

        int n_runs = std::max(1, num_starts);
        std::vector<int> run_seeds(n_runs);
        for (int i = 0; i < n_runs; i++) run_seeds[i] = (int)base_rng();

        std::vector<Solution> run_results(n_runs);

        if (n_runs == 1) {
            OptimizerConfig c = batch_cfg;
            c.seed = run_seeds[0];
            ThreadLocalCache tc;
            run_results[0] = optimize(unlocked, c, batch_init_inks, tc);
        } else {
            int actual_threads = std::min(nthreads, n_runs);
            std::mutex idx_mutex;
            int next_idx = 0;

            auto worker = [&]() {
                while (true) {
                    int idx;
                    {
                        std::lock_guard<std::mutex> lock(idx_mutex);
                        if (next_idx >= n_runs) return;
                        idx = next_idx++;
                    }
                    OptimizerConfig c = batch_cfg;
                    c.seed = run_seeds[idx];
                    ThreadLocalCache tc;
                    run_results[idx] = optimize(unlocked, c, batch_init_inks, tc);
                }
            };

            std::vector<std::thread> threads;
            for (int i = 0; i < actual_threads; i++) threads.emplace_back(worker);
            for (auto& t : threads) t.join();
        }

        // Pick best run
        int best_idx = 0;
        for (int i = 1; i < n_runs; i++)
            if (run_results[i].fitness < run_results[best_idx].fitness) best_idx = i;

        auto& sol = run_results[best_idx];
        if (!current_schedule)
            current_schedule = std::make_unique<std::map<std::string, std::vector<Job>>>();
        for (auto& [m, s] : states) {
            (*current_schedule)[m] = s.locked_jobs;
            auto& sj = sol.schedule[m];
            (*current_schedule)[m].insert((*current_schedule)[m].end(), sj.begin(), sj.end());
        }
    }

    auto [fit, ink, bft, crit] = calculate_fitness(*current_schedule, cfg, init_inks_global, cache);
    double makespan = flexo_sim::calculate_makespan(
        *current_schedule, cfg.machine_production_rates,
        cfg.sequence_dependent_setup_time,
        init_inks_global, cfg.initial_state, cache);
    double runtime = std::chrono::duration<double>(
        std::chrono::high_resolution_clock::now() - t_start).count();
    ExperimentResult res;
    res.schedule = *current_schedule;
    res.fitness = fit;
    res.batch_flow_time = bft;
    res.ink_changes = ink;
    res.runtime = runtime;
    res.makespan = makespan;
    return res;
}

// ── 9. Python Bindings ──────────────────────────────────────────────────────

// Moser SA-R default parameters:
// [p_I=0.66, p_S=0.84, p_B=0.04, p_M=0.71, B_max=26, T_max=2764.93, T_min=6.73, N_s=20, alpha=0.93]
static const std::vector<double> MOSER_DEFAULT_PARAMS = {0.66, 0.84, 0.04, 0.71, 26.0, 2764.93, 6.73, 20.0, 0.93};

py::dict run_experiment(
    const std::vector<std::map<std::string, py::object>>& job_batches,
    const std::vector<std::map<std::string, py::object>>& orders_data,
    const std::map<std::string, double>& machine_production_rates,
    double sequence_dependent_setup_time,
    double ink_weight, double batch_flow_time_weight,
    int seed, int iterations, double acceptance_prob,
    int num_starts = 1, int num_threads = 0,
    const std::vector<double>& move_probs = MOSER_DEFAULT_PARAMS) {

    auto [batches, order_lookup] = convert_input(job_batches, orders_data);
    auto result = run_experiment_core(
        batches, order_lookup, machine_production_rates,
        sequence_dependent_setup_time, ink_weight, batch_flow_time_weight,
        seed, iterations, acceptance_prob,
        move_probs, num_starts, num_threads);

    py::dict ret;
    ret["schedule"] = schedule_to_pydict(result.schedule);
    ret["fitness"] = result.fitness;
    ret["batch_flow_time"] = result.batch_flow_time;
    ret["ink_changes"] = result.ink_changes;
    ret["runtime"] = result.runtime;
    ret["makespan"] = result.makespan;
    return ret;
}

py::list run_multiple_experiments(
    const std::vector<std::map<std::string, py::object>>& job_batches,
    const std::vector<std::map<std::string, py::object>>& orders_data,
    const std::map<std::string, double>& machine_production_rates,
    double sequence_dependent_setup_time,
    double ink_weight, double batch_flow_time_weight,
    const std::vector<int>& seeds,
    int iterations, double acceptance_prob,
    int num_threads, int num_starts = 1,
    const std::vector<double>& move_probs = MOSER_DEFAULT_PARAMS,
    bool sequential = false) {

    auto [batches, order_lookup] = convert_input(job_batches, orders_data);

    int n = (int)seeds.size();
    std::vector<ExperimentResult> results(n);

    py::gil_scoped_release release;

    if (sequential) {
        // Run each seed one by one; multi-start inside each run is still parallelized
        for (int i = 0; i < n; i++) {
            results[i] = run_experiment_core(
                batches, order_lookup, machine_production_rates,
                sequence_dependent_setup_time, ink_weight, batch_flow_time_weight,
                seeds[i], iterations, acceptance_prob,
                move_probs, num_starts, num_threads);
        }
    } else {
        int nthreads = std::min(
            num_threads > 0 ? num_threads : (int)std::thread::hardware_concurrency(), n);

        std::mutex idx_mutex;
        int next_idx = 0;

        auto worker = [&]() {
            while (true) {
                int idx;
                {
                    std::lock_guard<std::mutex> lock(idx_mutex);
                    if (next_idx >= n) return;
                    idx = next_idx++;
                }
                results[idx] = run_experiment_core(
                    batches, order_lookup, machine_production_rates,
                    sequence_dependent_setup_time, ink_weight, batch_flow_time_weight,
                    seeds[idx], iterations, acceptance_prob,
                    move_probs, num_starts, 1);
            }
        };

        std::vector<std::thread> threads;
        for (int i = 0; i < nthreads; i++) threads.emplace_back(worker);
        for (auto& t : threads) t.join();
    }

    py::gil_scoped_acquire acquire;

    py::list ret;
    for (int i = 0; i < n; i++) {
        py::dict rd;
        rd["seed"] = seeds[i];
        rd["schedule"] = schedule_to_pydict(results[i].schedule);
        rd["fitness"] = results[i].fitness;
        rd["batch_flow_time"] = results[i].batch_flow_time;
        rd["ink_changes"] = results[i].ink_changes;
        rd["runtime"] = results[i].runtime;
        rd["makespan"] = results[i].makespan;
        ret.append(rd);
    }
    return ret;
}

PYBIND11_MODULE(ablation, m) {
    m.def("run_experiment", &run_experiment,
        py::arg("job_batches"),
        py::arg("orders_data"),
        py::arg("machine_production_rates"),
        py::arg("sequence_dependent_setup_time"),
        py::arg("ink_weight"),
        py::arg("batch_flow_time_weight"),
        py::arg("seed"),
        py::arg("iterations"),
        py::arg("acceptance_prob"),
        py::arg("num_starts") = 1,
        py::arg("num_threads") = 0,
        py::arg("move_probs") = MOSER_DEFAULT_PARAMS);

    m.def("run_multiple_experiments", &run_multiple_experiments,
        py::arg("job_batches"),
        py::arg("orders_data"),
        py::arg("machine_production_rates"),
        py::arg("sequence_dependent_setup_time"),
        py::arg("ink_weight"),
        py::arg("batch_flow_time_weight"),
        py::arg("seeds"),
        py::arg("iterations"),
        py::arg("acceptance_prob"),
        py::arg("num_threads"),
        py::arg("num_starts") = 1,
        py::arg("move_probs") = MOSER_DEFAULT_PARAMS,
        py::arg("sequential") = false);
}
