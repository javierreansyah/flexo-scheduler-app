// ============================================================================
// Flexo Scheduling Optimizer — SA with Rolling Horizon
// ============================================================================
//
// Compile C++ files with:
// Remove-Item -Recurse -Force build, \*.egg-info -ErrorAction SilentlyContinue; pip install . --force-reinstall --no-cache-dir
//
// Sections:
//   1. Headers & Constants
//   2. Data Types
//   3. Ink Changeover Computation
//   4. Schedule Simulation & Evaluation
//   5. SA Context & Workspace
//   6. Neighborhood Moves (apply & revert)
//   7. SA Core
//   8. Rolling Horizon Experiment Engine
//   9. Python Bindings
//
// ============================================================================

// ── 1. Headers ───────────────────────────────────────────────────────────────
// All simulation primitives, shared SA data structures (SAContextBase,
// SAWorkspace, MoveUndo, Solution, ExperimentResult), PRNG (Xoshiro256pp),
// calculate_fitness_internal, and fill_sa_context_base live in simulator.h.
// Python-binding helpers (schedule_to_pydict, convert_input) live in
// pybind_helpers.h.

#include <pybind11/pybind11.h>
#include <pybind11/stl.h>
#include <algorithm>
#include <chrono>
#include <cmath>
#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>
#include "simulator.h"
#include "pybind_helpers.h"

namespace py = pybind11;

#ifdef _MSC_VER
#define FORCE_INLINE __forceinline
#else
#define FORCE_INLINE inline __attribute__((always_inline))
#endif

using Job              = flexo_sim::Job;
using OrderData        = flexo_sim::OrderData;
using BatchData        = flexo_sim::BatchData;
using MachineState     = flexo_sim::MachineState;
using ThreadLocalCache = flexo_sim::ThreadLocalCache;
using Xoshiro256pp     = flexo_sim::Xoshiro256pp;
using SAWorkspace      = flexo_sim::SAWorkspace;
using MoveUndo         = flexo_sim::MoveUndo;
using Solution         = flexo_sim::Solution;
using BatchObjectiveTrace = flexo_sim::BatchObjectiveTrace;
using ExperimentResult = flexo_sim::ExperimentResult;

// ── 2. Data Types ────────────────────────────────────────────────────────────

struct OptimizerConfig {
    std::map<std::string, double> machine_production_rates;
    std::vector<std::string> machines;
    double sequence_dependent_setup_time;
    std::map<std::string, std::map<std::string, double>> initial_state;
    double ink_weight, batch_flow_time_weight;
    int seed, iterations;
    double T_max;         // initial SA temperature
    double T_min;         // minimum temperature (cooling rate auto-calibrated)
    int    N_s;           // iterations per temperature step
    double rcl_alpha;     // GRASP greediness: 0 = fully greedy, 1 = fully random
    std::vector<double> move_probs;  // [p_I, p_S, p_B]
    bool use_metropolis;  // if false, only accept improving moves (hill-climbing)
};

// SAContext extends SAContextBase with hierarchical move parameters.
struct SAContext : flexo_sim::SAContextBase {
    double p_I;   // inter-machine probability
    double p_S;   // shift vs swap probability
    double p_B;   // block vs single-job probability
    int    B_max; // maximum block size
    int    N_s;   // iterations per temperature step
};

// ── 3. SA Context ─────────────────────────────────────────────────────────────

SAContext build_sa_context(
    const std::vector<Job>& jobs, const OptimizerConfig& cfg,
    const std::map<std::string, std::vector<int>>& init_inks) {

    SAContext ctx;
    flexo_sim::fill_sa_context_base(
        ctx, jobs, cfg.machines, cfg.machine_production_rates,
        cfg.sequence_dependent_setup_time, cfg.ink_weight, cfg.batch_flow_time_weight,
        init_inks, cfg.initial_state);

    // Hierarchical move parameters from move_probs: [p_I, p_S, p_B]
    ctx.p_I   = cfg.move_probs.size() > 0 ? cfg.move_probs[0] : 0.66;
    ctx.p_S   = cfg.move_probs.size() > 1 ? cfg.move_probs[1] : 0.84;
    ctx.p_B   = cfg.move_probs.size() > 2 ? cfg.move_probs[2] : 0.04;
    ctx.B_max = 26;
    ctx.N_s   = cfg.N_s;
    return ctx;
}

// Map-based fitness — initial solution and final evaluation.
inline std::tuple<double, double, double, std::vector<std::string>> calculate_fitness(
    const std::map<std::string, std::vector<Job>>& schedule,
    const OptimizerConfig& cfg,
    const std::map<std::string, std::vector<int>>& init_inks,
    ThreadLocalCache& cache) {
    return flexo_sim::calculate_fitness(
        schedule, cfg.machine_production_rates,
        cfg.sequence_dependent_setup_time, cfg.ink_weight, cfg.batch_flow_time_weight,
        init_inks, cfg.initial_state, cache);
}

// ── 6. Neighborhood Moves (hierarchical, Moser-style) ──────────────────────

// Hierarchical move selection (Moser-style, no guidance):
//   1. Block (p_B) or Single
//   2. Shift (p_S) or Swap
//   3. Inter-machine (p_I) or Intra-machine
//
// Move types:
//   0 = intra-swap (single)    1 = inter-swap (single)
//   2 = intra-shift (single)   3 = inter-shift (single)
//   5 = intra-block-shift      6 = inter-block-shift
//   7 = inter-block-swap       8 = intra-block-swap
void apply_move_internal(
    std::vector<std::vector<int>>& schedule,
    const SAContext& ctx, SAWorkspace& ws, Xoshiro256pp& rng,
    MoveUndo& undo) {

    int n_m = ctx.num_machines;

    // Hierarchical selection
    bool is_block = rng.next_double() < ctx.p_B;
    int L = is_block ? (int)(2 + rng.bounded(std::max(1, ctx.B_max - 1))) : 1;
    bool is_shift = rng.next_double() < ctx.p_S;
    bool is_inter = rng.next_double() < ctx.p_I;

    // Pick source machine uniformly at random
    int mf = (int)rng.bounded((uint64_t)n_m);
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

    if (is_block) {
        L = std::min(L, (int)j1.size());
        if (L < 2) { is_block = false; L = 1; }
    }

    if (!is_block) {
        // ── Single-job moves ──
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
                undo.i1 = i;
                undo.saved_len1 = L;
                std::copy(j1.begin() + i, j1.begin() + i + L, ws.move_buf1.begin());
                j1.erase(j1.begin() + i, j1.begin() + i + L);
                size_t pos = rnd(0, j2.size());
                undo.i2 = pos;
                j2.insert(j2.begin() + pos, ws.move_buf1.begin(), ws.move_buf1.begin() + L);
            } else {
                // Intra-block-shift: relocate block within mf
                if ((int)j1.size() < L) { undo.move_type = -1; return; }
                undo.move_type = 5;
                size_t max_start = j1.size() - L;
                size_t i = rnd(0, max_start);
                undo.i1 = i;
                undo.saved_len1 = L;
                std::copy(j1.begin() + i, j1.begin() + i + L, ws.move_buf1.begin());
                j1.erase(j1.begin() + i, j1.begin() + i + L);
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
                undo.i1 = i1; undo.i2 = i2;
                undo.saved_len1 = undo.saved_len2 = L;
                std::copy(j1.begin() + i1, j1.begin() + i1 + L, ws.move_buf1.begin());
                std::copy(j2.begin() + i2, j2.begin() + i2 + L, ws.move_buf2.begin());
                std::copy(ws.move_buf2.begin(), ws.move_buf2.begin() + L, j1.begin() + i1);
                std::copy(ws.move_buf1.begin(), ws.move_buf1.begin() + L, j2.begin() + i2);
            } else {
                // Intra-block-swap: swap two non-overlapping blocks within mf
                if ((int)j1.size() < 2 * L) { undo.move_type = -1; return; }
                undo.move_type = 8;
                size_t max_pos = j1.size() - L;
                size_t a = rnd(0, max_pos), b = rnd(0, max_pos);
                int attempts = 0;
                while ((size_t)std::abs((int)a - (int)b) < (size_t)L && attempts++ < 20)
                    b = rnd(0, max_pos);
                if ((size_t)std::abs((int)a - (int)b) < (size_t)L) { undo.move_type = -1; return; }
                if (a > b) std::swap(a, b);  // ensure a < b
                undo.i1 = a; undo.i2 = b;
                undo.saved_len1 = L;
                std::copy(j1.begin() + a, j1.begin() + a + L, ws.move_buf1.begin());
                std::copy(j1.begin() + b, j1.begin() + b + L, ws.move_buf2.begin());
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

// ── 7. SA Core (GRASP construction + geometric cooling SA) ─────────────────

// GRASP-inspired construction:
//   1. Sort jobs: arrival ascending (oldest first), then quantity descending (largest first).
//   2. While unassigned jobs remain:
//      a. For each unassigned job, find its best machine (minimum fitness when appended)
//         and record that best-fitness score.
//      b. Build RCL over jobs: jobs whose best-fitness <= best_job + rcl_alpha*(worst_job - best_job).
//      c. Pick a job uniformly at random from the RCL.
//      d. Append that job to its best machine.
Solution create_initial_solution(
    std::vector<Job> jobs, const OptimizerConfig& cfg,
    const std::map<std::string, std::vector<int>>& init_inks,
    ThreadLocalCache& cache, Xoshiro256pp& rng) {

    // Step 1: sort by arrival asc, then by production_quantity desc
    std::sort(jobs.begin(), jobs.end(), [](const Job& a, const Job& b) {
        if (a.arrival_time != b.arrival_time) return a.arrival_time < b.arrival_time;
        return a.production_quantity > b.production_quantity;
    });

    std::map<std::string, std::vector<Job>> schedule;
    for (auto& m : cfg.machines) schedule[m] = {};

    const int n_m = (int)cfg.machines.size();
    const double alpha = cfg.rcl_alpha;

    // Track which jobs are still unassigned
    std::vector<bool> assigned(jobs.size(), false);
    int remaining = (int)jobs.size();

    while (remaining > 0) {
        // Step 2a: for each unassigned job, find its best machine and best-fitness score
        std::vector<double> job_best_fit(jobs.size(), std::numeric_limits<double>::infinity());
        std::vector<int>    job_best_machine(jobs.size(), 0);

        for (int ji = 0; ji < (int)jobs.size(); ji++) {
            if (assigned[ji]) continue;
            for (int mi = 0; mi < n_m; mi++) {
                schedule[cfg.machines[mi]].push_back(jobs[ji]);
                auto [fit, ink, bft, crit] = calculate_fitness(schedule, cfg, init_inks, cache);
                schedule[cfg.machines[mi]].pop_back();
                if (fit < job_best_fit[ji]) {
                    job_best_fit[ji] = fit;
                    job_best_machine[ji] = mi;
                }
            }
        }

        // Step 2b: build RCL over unassigned jobs by their best-fitness score
        double best_score  = std::numeric_limits<double>::infinity();
        double worst_score = -std::numeric_limits<double>::infinity();
        for (int ji = 0; ji < (int)jobs.size(); ji++) {
            if (assigned[ji]) continue;
            best_score  = std::min(best_score,  job_best_fit[ji]);
            worst_score = std::max(worst_score, job_best_fit[ji]);
        }
        double threshold = best_score + alpha * (worst_score - best_score);

        std::vector<int> rcl;
        for (int ji = 0; ji < (int)jobs.size(); ji++)
            if (!assigned[ji] && job_best_fit[ji] <= threshold + 1e-12)
                rcl.push_back(ji);

        // Step 2c: pick uniformly from RCL
        int chosen_ji = rcl[(size_t)rng.bounded((uint64_t)rcl.size())];

        // Step 2d: append to its best machine
        schedule[cfg.machines[job_best_machine[chosen_ji]]].push_back(jobs[chosen_ji]);
        assigned[chosen_ji] = true;
        remaining--;
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

// GRASP-SA hybrid with geometric cooling (templated on UseMetropolis for zero overhead):
//   - GRASP constructs the initial solution (RCL-based greediness via rcl_alpha)
//   - SA cools from T_max to T_min over (iterations / N_s) temperature stages
//   - Cooling rate alpha is auto-calibrated: alpha = (T_min/T_max)^(1/(stages-1))
//   - N_s iterations per stage; Boltzmann acceptance: exp(-delta/tc) (if UseMetropolis)
//   - UseMetropolis=false → pure hill-climbing (only accept non-worsening moves)
template <bool UseMetropolis>
Solution optimize_impl(
    std::vector<Job> jobs, const OptimizerConfig& cfg,
    const std::map<std::string, std::vector<int>>& init_inks,
    ThreadLocalCache& cache) {

    flexo_sim::prewarm_caches(jobs, cfg.machines, cfg.machine_production_rates, cache);
    Xoshiro256pp rng((uint64_t)(unsigned)cfg.seed);

    // Build initial solution (GRASP) and SA context
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

    flexo_sim::calculate_fitness_internal(cur_sched, ctx, ws);

    double cur_fit = ws.fitness, cur_ink = ws.ink_changes, cur_bft = ws.batch_flow_time;
    auto best_sched = cur_sched;
    double best_fit = cur_fit, best_ink = cur_ink, best_bft = cur_bft;
    std::vector<int> best_crit;

    // Auto-calibrate cooling rate: T_max → T_min over (iterations / N_s) stages
    int total_stages = std::max(1, cfg.iterations / std::max(1, ctx.N_s));
    double alpha = (total_stages > 1 && cfg.T_min > 0.0 && cfg.T_max > 0.0)
        ? std::pow(cfg.T_min / cfg.T_max, 1.0 / (double)(total_stages - 1))
        : 1.0;
    double tc = cfg.T_max;
    double neg_inv_tc = (tc > 0.0) ? -1.0 / tc : 0.0;

    MoveUndo undo;
    int total_iters = 0;

    // Geometric cooling SA: N_s iterations per temperature stage
    while (total_iters < cfg.iterations) {
        for (int s = 0; s < ctx.N_s && total_iters < cfg.iterations; s++, total_iters++) {
            flexo_sim::save_workspace(ws);
            apply_move_internal(cur_sched, ctx, ws, rng, undo);
            if (undo.move_type < 0) continue;
            flexo_sim::calculate_fitness_delta(cur_sched, ctx, ws, undo.m1, undo.m2);

            double delta = ws.fitness - cur_fit;
            bool accept = (delta <= 0);
            if constexpr (UseMetropolis) {
                if (!accept && tc > 0.0)
                    accept = rng.next_double() < std::exp(delta * neg_inv_tc);
            }

            if (accept) {
                cur_fit = ws.fitness;
                cur_ink = ws.ink_changes;
                cur_bft = ws.batch_flow_time;
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
        tc *= alpha;
        neg_inv_tc = (tc > 1e-300) ? -1.0 / tc : 0.0;
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

// Dispatch wrapper: runtime bool → compile-time template specialisation
Solution optimize(
    std::vector<Job> jobs, const OptimizerConfig& cfg,
    const std::map<std::string, std::vector<int>>& init_inks,
    ThreadLocalCache& cache) {
    if (cfg.use_metropolis)
        return optimize_impl<true>(std::move(jobs), cfg, init_inks, cache);
    else
        return optimize_impl<false>(std::move(jobs), cfg, init_inks, cache);
}

// ── 8. Rolling Horizon Experiment Engine ─────────────────────────────────────

ExperimentResult run_experiment_core(
    const std::vector<BatchData>& batches,
    const std::map<std::string, OrderData>& order_lookup,
    const std::map<std::string, double>& machine_production_rates,
    double sequence_dependent_setup_time,
    double ink_weight, double batch_flow_time_weight,
    int seed, int iterations,
    double T_max, double T_min, int N_s,
    double rcl_alpha,
    const std::vector<double>& move_probs,
    int num_starts, int num_threads,
    bool use_metropolis) {

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
    cfg.T_max = T_max;
    cfg.T_min = T_min;
    cfg.N_s = N_s;
    cfg.rcl_alpha = rcl_alpha;
    cfg.move_probs = move_probs;
    cfg.use_metropolis = use_metropolis;

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
    std::vector<BatchObjectiveTrace> batch_objectives;
    Xoshiro256pp base_rng((uint64_t)(unsigned)seed);
    int nthreads = num_threads > 0 ? num_threads : (int)std::thread::hardware_concurrency();
    int batch_idx = 0;

    // Rolling horizon: process each batch arrival
    for (auto& [arrival, oids] : sorted_batches) {
        batch_idx++;
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
            c.rcl_alpha = rcl_alpha;
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
                    c.rcl_alpha = rcl_alpha;
                    c.T_max = T_max;
                    c.T_min = T_min;
                    c.N_s = N_s;
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

        auto [prefix_fit, prefix_ink, prefix_bft, prefix_crit] = flexo_sim::calculate_fitness(
            *current_schedule, cfg.machine_production_rates,
            cfg.sequence_dependent_setup_time, cfg.ink_weight, cfg.batch_flow_time_weight,
            init_inks_global, cfg.initial_state, cache);
        (void)prefix_crit;

        BatchObjectiveTrace bt;
        bt.batch_idx = batch_idx;
        bt.arrival_time = arrival;
        bt.unlocked_jobs = (int)unlocked.size();
        bt.selected_seed = run_seeds[best_idx];
        bt.local_fitness = sol.fitness;
        bt.local_ink_changes = sol.ink_changes;
        bt.local_batch_flow_time = sol.batch_flow_time;
        bt.prefix_fitness = prefix_fit;
        bt.prefix_ink_changes = prefix_ink;
        bt.prefix_batch_flow_time = prefix_bft;
        batch_objectives.push_back(bt);
    }

    auto [fit, ink, bft, crit] = flexo_sim::calculate_fitness(
        *current_schedule, cfg.machine_production_rates,
        cfg.sequence_dependent_setup_time, cfg.ink_weight, cfg.batch_flow_time_weight,
        init_inks_global, cfg.initial_state, cache);
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
    res.batch_objectives = std::move(batch_objectives);
    return res;
}

// ── 9. Python Bindings ───────────────────────────────────────────────────────

py::dict run_experiment(
    const std::vector<std::map<std::string, py::object>>& job_batches,
    const std::vector<std::map<std::string, py::object>>& orders_data,
    const std::map<std::string, double>& machine_production_rates,
    double sequence_dependent_setup_time,
    double ink_weight, double batch_flow_time_weight,
    int seed, int iterations,
    double T_max, double T_min, int N_s,
    double rcl_alpha = 0.0,
    int num_starts = 1, int num_threads = 0,
    const std::vector<double>& move_probs = {0.66, 0.84, 0.04},
    bool use_metropolis = true) {

    auto [batches, order_lookup] = convert_input(job_batches, orders_data);
    auto result = run_experiment_core(
        batches, order_lookup, machine_production_rates,
        sequence_dependent_setup_time, ink_weight, batch_flow_time_weight,
        seed, iterations, T_max, T_min, N_s, rcl_alpha,
        move_probs, num_starts, num_threads, use_metropolis);

    py::list batch_objectives;
    for (const auto& bt : result.batch_objectives) {
        py::dict d;
        d["batch_idx"] = bt.batch_idx;
        d["arrival_time"] = bt.arrival_time;
        d["unlocked_jobs"] = bt.unlocked_jobs;
        d["selected_seed"] = bt.selected_seed;
        d["local_fitness"] = bt.local_fitness;
        d["local_ink_changes"] = bt.local_ink_changes;
        d["local_batch_flow_time"] = bt.local_batch_flow_time;
        d["prefix_fitness"] = bt.prefix_fitness;
        d["prefix_ink_changes"] = bt.prefix_ink_changes;
        d["prefix_batch_flow_time"] = bt.prefix_batch_flow_time;
        batch_objectives.append(d);
    }

    py::dict ret;
    ret["schedule"] = schedule_to_pydict(result.schedule);
    ret["fitness"] = result.fitness;
    ret["batch_flow_time"] = result.batch_flow_time;
    ret["ink_changes"] = result.ink_changes;
    ret["runtime"] = result.runtime;
    ret["makespan"] = result.makespan;
    ret["batch_objectives"] = batch_objectives;
    return ret;
}

py::list run_multiple_experiments(
    const std::vector<std::map<std::string, py::object>>& job_batches,
    const std::vector<std::map<std::string, py::object>>& orders_data,
    const std::map<std::string, double>& machine_production_rates,
    double sequence_dependent_setup_time,
    double ink_weight, double batch_flow_time_weight,
    const std::vector<int>& seeds,
    int iterations,
    double T_max, double T_min, int N_s,
    int num_threads, int num_starts = 1,
    const std::vector<double>& move_probs = {0.66, 0.84, 0.04},
    bool sequential = false,
    double rcl_alpha = 0.0,
    bool use_metropolis = true) {

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
                seeds[i], iterations, T_max, T_min, N_s, rcl_alpha,
                move_probs, num_starts, num_threads, use_metropolis);
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
                    seeds[idx], iterations, T_max, T_min, N_s, rcl_alpha,
                    move_probs, num_starts, 1, use_metropolis);
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
        py::list batch_objectives;
        for (const auto& bt : results[i].batch_objectives) {
            py::dict d;
            d["batch_idx"] = bt.batch_idx;
            d["arrival_time"] = bt.arrival_time;
            d["unlocked_jobs"] = bt.unlocked_jobs;
            d["selected_seed"] = bt.selected_seed;
            d["local_fitness"] = bt.local_fitness;
            d["local_ink_changes"] = bt.local_ink_changes;
            d["local_batch_flow_time"] = bt.local_batch_flow_time;
            d["prefix_fitness"] = bt.prefix_fitness;
            d["prefix_ink_changes"] = bt.prefix_ink_changes;
            d["prefix_batch_flow_time"] = bt.prefix_batch_flow_time;
            batch_objectives.append(d);
        }
        rd["batch_objectives"] = batch_objectives;
        ret.append(rd);
    }
    return ret;
}

PYBIND11_MODULE(optimizer, m) {
    m.def("run_experiment", &run_experiment,
        py::arg("job_batches"),
        py::arg("orders_data"),
        py::arg("machine_production_rates"),
        py::arg("sequence_dependent_setup_time"),
        py::arg("ink_weight"),
        py::arg("batch_flow_time_weight"),
        py::arg("seed"),
        py::arg("iterations"),
        py::arg("T_max"),
        py::arg("T_min"),
        py::arg("N_s"),
        py::arg("rcl_alpha") = 0.0,
        py::arg("num_starts") = 1,
        py::arg("num_threads") = 0,
        py::arg("move_probs") = std::vector<double>{0.66, 0.84, 0.04},
        py::arg("use_metropolis") = true);

    m.def("run_single_batch", [](
            const std::vector<std::map<std::string, py::object>>& orders_data,
            const std::map<std::string, double>& machine_production_rates,
            double sequence_dependent_setup_time,
            double ink_weight, double batch_flow_time_weight,
            int seed, int iterations,
            double T_max, double T_min, int N_s,
            double rcl_alpha,
            int num_starts, int num_threads,
            const std::vector<double>& move_probs,
            bool use_metropolis,
            const std::map<std::string, double>& init_times,
            const std::map<std::string, std::vector<int>>& init_inks) -> py::dict {

        // Build jobs from orders_data (single batch, arrival=0)
        std::vector<Job> jobs;
        for (auto& o : orders_data) {
            Job j;
            j.order_code = py::str(o.at("id"));
            j.production_quantity = o.at("quantity").cast<int>();
            j.arrival_time = o.at("arrival_time").cast<double>();
            for (auto& ink : o.at("inks")) j.inks.push_back(ink.cast<int>());
            jobs.push_back(j);
        }

        // Build config
        OptimizerConfig cfg;
        cfg.machine_production_rates = machine_production_rates;
        for (auto& [name, rate] : machine_production_rates) cfg.machines.push_back(name);
        cfg.sequence_dependent_setup_time = sequence_dependent_setup_time;
        cfg.ink_weight = ink_weight;
        cfg.batch_flow_time_weight = batch_flow_time_weight;
        cfg.seed = seed;
        cfg.iterations = iterations;
        cfg.T_max = T_max;
        cfg.T_min = T_min;
        cfg.N_s = N_s;
        cfg.rcl_alpha = rcl_alpha;
        cfg.move_probs = move_probs;
        cfg.use_metropolis = use_metropolis;
        for (auto& [m, t] : init_times)
            cfg.initial_state[m]["time"] = t;

        // Run multi-start optimize
        Xoshiro256pp base_rng((uint64_t)(unsigned)seed);
        int n_runs = std::max(1, num_starts);
        int nthreads = num_threads > 0 ? num_threads : (int)std::thread::hardware_concurrency();
        std::vector<int> run_seeds(n_runs);
        for (int i = 0; i < n_runs; i++) run_seeds[i] = (int)base_rng();

        std::vector<Solution> run_results(n_runs);

        {
            py::gil_scoped_release release;
            if (n_runs == 1) {
                OptimizerConfig c = cfg;
                c.seed = run_seeds[0];
                ThreadLocalCache tc;
                run_results[0] = optimize(std::move(jobs), c, init_inks, tc);
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
                        OptimizerConfig c = cfg;
                        c.seed = run_seeds[idx];
                        ThreadLocalCache tc;
                        run_results[idx] = optimize(jobs, c, init_inks, tc);
                    }
                };
                std::vector<std::thread> threads;
                for (int i = 0; i < actual_threads; i++) threads.emplace_back(worker);
                for (auto& t : threads) t.join();
            }
        }

        int best_idx = 0;
        for (int i = 1; i < n_runs; i++)
            if (run_results[i].fitness < run_results[best_idx].fitness) best_idx = i;

        auto& sol = run_results[best_idx];
        py::dict ret;
        ret["schedule"] = schedule_to_pydict(sol.schedule);
        ret["fitness"] = sol.fitness;
        ret["batch_flow_time"] = sol.batch_flow_time;
        ret["ink_changes"] = sol.ink_changes;
        return ret;
    },
        py::arg("orders_data"),
        py::arg("machine_production_rates"),
        py::arg("sequence_dependent_setup_time"),
        py::arg("ink_weight"),
        py::arg("batch_flow_time_weight"),
        py::arg("seed"),
        py::arg("iterations"),
        py::arg("T_max"),
        py::arg("T_min"),
        py::arg("N_s"),
        py::arg("rcl_alpha") = 0.0,
        py::arg("num_starts") = 1,
        py::arg("num_threads") = 0,
        py::arg("move_probs") = std::vector<double>{0.66, 0.84, 0.04},
        py::arg("use_metropolis") = true,
        py::arg("init_times") = std::map<std::string, double>{},
        py::arg("init_inks") = std::map<std::string, std::vector<int>>{});

    m.def("run_multiple_experiments", &run_multiple_experiments,
        py::arg("job_batches"),
        py::arg("orders_data"),
        py::arg("machine_production_rates"),
        py::arg("sequence_dependent_setup_time"),
        py::arg("ink_weight"),
        py::arg("batch_flow_time_weight"),
        py::arg("seeds"),
        py::arg("iterations"),
        py::arg("T_max"),
        py::arg("T_min"),
        py::arg("N_s"),
        py::arg("num_threads"),
        py::arg("num_starts") = 1,
        py::arg("move_probs") = std::vector<double>{0.66, 0.84, 0.04},
        py::arg("sequential") = false,
        py::arg("rcl_alpha") = 0.0,
        py::arg("use_metropolis") = true);

    // ── calculate_fitness binding ─────────────────────────────────────────────
    // Evaluates the true weighted fitness of a complete schedule using the same
    // C++ simulate_job_step logic as the optimizer.
    //
    // schedule       : {machine: [{order_code, production_quantity, inks,
    //                               arrival_time (hours)}]}
    // machine_rates  : {machine: rate}
    // setup_time     : sequence-dependent setup time (hours)
    // ink_weight / batch_flow_time_weight : objective weights
    // init_inks      : {machine: [ink_levels]}         (empty = no prior inks)
    // initial_state  : {machine: {"time": float_hours}} (empty = start at 0)
    //
    // Returns dict with keys: fitness, ink_changes, batch_flow_time_h
    m.def("calculate_fitness", [](
            const std::map<std::string, std::vector<std::map<std::string, py::object>>>& schedule_py,
            const std::map<std::string, double>& machine_rates,
            double setup_time,
            double ink_weight, double batch_flow_time_weight,
            const std::map<std::string, std::vector<int>>& init_inks,
            const std::map<std::string, std::map<std::string, double>>& initial_state) -> py::dict {

        // Convert Python schedule dict to C++ schedule map
        std::map<std::string, std::vector<Job>> schedule;
        for (auto& [m, job_list] : schedule_py) {
            std::vector<Job> jobs;
            for (auto& jd : job_list) {
                Job j;
                j.order_code          = jd.at("order_code").cast<std::string>();
                j.production_quantity = jd.at("production_quantity").cast<int>();
                j.arrival_time        = jd.at("arrival_time").cast<double>();
                for (auto& ink : jd.at("inks")) j.inks.push_back(ink.cast<int>());
                jobs.push_back(j);
            }
            schedule[m] = std::move(jobs);
        }

        ThreadLocalCache cache;
        auto [fitness, ink_changes, bft, _crit] = flexo_sim::calculate_fitness(
            schedule, machine_rates, setup_time,
            ink_weight, batch_flow_time_weight,
            init_inks, initial_state, cache);

        py::dict ret;
        ret["fitness"]           = fitness;
        ret["ink_changes"]       = ink_changes;
        ret["batch_flow_time_h"] = bft;
        return ret;
    },
        py::arg("schedule"),
        py::arg("machine_rates"),
        py::arg("setup_time"),
        py::arg("ink_weight"),
        py::arg("batch_flow_time_weight"),
        py::arg("init_inks")      = std::map<std::string, std::vector<int>>{},
        py::arg("initial_state")  = std::map<std::string, std::map<std::string, double>>{});
}
