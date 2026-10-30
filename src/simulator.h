#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <functional>
#include <map>
#include <numeric>
#include <set>
#include <string>
#include <tuple>
#include <unordered_map>
#include <unordered_set>
#include <vector>

#ifdef _MSC_VER
#include <intrin.h>  // _umul128 for Xoshiro256pp
#endif

namespace flexo_sim {

#ifdef _MSC_VER
#define FLEXO_FORCE_INLINE __forceinline
#else
#define FLEXO_FORCE_INLINE inline __attribute__((always_inline))
#endif

constexpr double HOURS_PER_DAY = 8.0;
constexpr double INV_HOURS = 1.0 / HOURS_PER_DAY;

// ── Fast PRNG ────────────────────────────────────────────────────────────────
// Xoshiro256++ — faster than mt19937, passes BigCrush/PractRand.
// Seeded via SplitMix64 for a well-distributed initial state.
struct Xoshiro256pp {
    using result_type = uint64_t;
    uint64_t s[4];

    static constexpr result_type min() noexcept { return 0; }
    static constexpr result_type max() noexcept { return UINT64_MAX; }

    explicit Xoshiro256pp(uint64_t seed) noexcept {
        auto sm64 = [](uint64_t& x) noexcept -> uint64_t {
            uint64_t z = (x += 0x9e3779b97f4a7c15ULL);
            z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9ULL;
            z = (z ^ (z >> 27)) * 0x94d049bb133111ebULL;
            return z ^ (z >> 31);
        };
        s[0] = sm64(seed); s[1] = sm64(seed);
        s[2] = sm64(seed); s[3] = sm64(seed);
    }

    FLEXO_FORCE_INLINE result_type operator()() noexcept {
        const uint64_t result = rotl(s[0] + s[3], 23) + s[0];
        const uint64_t t = s[1] << 17;
        s[2] ^= s[0]; s[3] ^= s[1];
        s[1] ^= s[2]; s[0] ^= s[3];
        s[2] ^= t;
        s[3] = rotl(s[3], 45);
        return result;
    }

    FLEXO_FORCE_INLINE double next_double() noexcept {
        return (double)(operator()() >> 11) * 0x1.0p-53;
    }

    // Lemire's nearly divisionless algorithm — uniform in [0, n).
    FLEXO_FORCE_INLINE uint64_t bounded(uint64_t n) noexcept {
#ifdef _MSC_VER
        uint64_t hi, lo = _umul128((*this)(), n, &hi);
        if (lo < n) {
            uint64_t t = (uint64_t)(0u - n) % n;
            while (lo < t) { lo = _umul128((*this)(), n, &hi); }
        }
        return hi;
#else
        unsigned __int128 m = (unsigned __int128)(*this)() * n;
        uint64_t lo = (uint64_t)m;
        if (lo < n) {
            uint64_t t = (uint64_t)(0u - n) % n;
            while (lo < t) { m = (unsigned __int128)(*this)() * n; lo = (uint64_t)m; }
        }
        return (uint64_t)(m >> 64);
#endif
    }

private:
    static FLEXO_FORCE_INLINE uint64_t rotl(uint64_t x, int k) noexcept {
        return (x << k) | (x >> (64 - k));
    }
};

struct Job {
    std::string order_code;
    std::vector<int> inks;
    int production_quantity = 0;
    double arrival_time = 0;
    double start_time = 0;
    double completion_time = 0;
    int ink_pattern_idx = 0;
    int qty_idx = 0;
};

struct OrderData { std::string id; int quantity; std::vector<int> inks; };
struct BatchData { double arrival_time; std::vector<std::string> orders; };

struct MachineState {
    std::string name;
    double current_time = 0;
    std::vector<int> current_inks;
    std::vector<Job> locked_jobs, unlocked_jobs;
};

struct ThreadLocalCache {
    std::unordered_map<size_t, int> changeover_cache;
    std::unordered_map<size_t, double> proc_time_cache;
};

struct StepResult { double earliest, start, done; int ink_chg; };

FLEXO_FORCE_INLINE bool day_boundary_crossed(double t_prev, double t_now) {
    if (t_now < HOURS_PER_DAY) return false;
    int k_floor = (int)(t_prev * INV_HOURS);
    int k = k_floor + (t_prev > k_floor * HOURS_PER_DAY ? 1 : 0);
    if (k < 1) k = 1;
    return k * HOURS_PER_DAY <= t_now;
}

FLEXO_FORCE_INLINE double next_shift_end(double t) {
    return (std::floor(t * INV_HOURS) + 1) * HOURS_PER_DAY;
}

inline size_t hash_inks(const std::vector<int>& v) {
    size_t h = 0;
    for (int x : v) h = h * 31 + x;
    return h;
}

inline int changeover_compute(const std::vector<int>& prev, const std::vector<int>& next) {
    std::map<int, int> A, B;
    for (int x : prev) A[x]++;
    for (int x : next) B[x]++;
    if (A == B) return 0;

    std::vector<int> rem, add;
    std::set<int> levels;
    for (auto& [k, v] : A) levels.insert(k);
    for (auto& [k, v] : B) levels.insert(k);
    for (int lvl : levels) {
        int d = A[lvl] - B[lvl];
        for (int i = 0; i < d; i++) rem.push_back(lvl);
        for (int i = 0; i < -d; i++) add.push_back(lvl);
    }

    size_t m = std::min(rem.size(), add.size());
    int deletions = (int)rem.size() - (int)m;
    int best = 1000000000;

    using Combo = std::vector<size_t>;
    auto gen_combos = [](size_t n, size_t k) {
        std::vector<Combo> out;
        Combo cur;
        std::function<void(size_t)> go = [&](size_t start) {
            if (cur.size() == k) { out.push_back(cur); return; }
            for (size_t i = start; i < n; i++) {
                cur.push_back(i);
                go(i + 1);
                cur.pop_back();
            }
        };
        go(0);
        return out;
    };

    auto identity_combo = [](size_t n) {
        Combo c(n);
        std::iota(c.begin(), c.end(), 0);
        return c;
    };
    auto rem_combos = (rem.size() <= m)
        ? std::vector<Combo>{identity_combo(m)}
        : gen_combos(rem.size(), m);
    auto add_combos = (add.size() <= m)
        ? std::vector<Combo>{identity_combo(m)}
        : gen_combos(add.size(), m);

    for (auto& ridx : rem_combos) {
        std::vector<int> r;
        for (size_t i : ridx) r.push_back(rem[i]);
        for (auto& aidx : add_combos) {
            std::vector<int> sel;
            for (size_t i : aidx) sel.push_back(add[i]);
            std::sort(sel.begin(), sel.end());
            do {
                int cost = deletions;
                for (size_t i = 0; i < r.size(); i++)
                    if (r[i] > sel[i]) cost++;
                best = std::min(best, cost);
            } while (std::next_permutation(sel.begin(), sel.end()));
        }
    }
    return best;
}

inline int changeover(const std::vector<int>& prev, const std::vector<int>& next, ThreadLocalCache& cache) {
    size_t key = hash_inks(prev) ^ (hash_inks(next) << 1);
    auto it = cache.changeover_cache.find(key);
    if (it != cache.changeover_cache.end()) return it->second;
    int result = changeover_compute(prev, next);
    cache.changeover_cache[key] = result;
    return result;
}

inline double get_proc_time(const std::string& m, int qty,
                            const std::map<std::string, double>& machine_rates,
                            ThreadLocalCache& cache) {
    size_t key = std::hash<std::string>{}(m) ^ ((size_t)qty * 31);
    auto it = cache.proc_time_cache.find(key);
    if (it != cache.proc_time_cache.end()) return it->second;
    double r = qty / machine_rates.at(m) / 60.0;
    cache.proc_time_cache[key] = r;
    return r;
}

inline void prewarm_caches(const std::map<std::string, OrderData>& order_lookup,
                           const std::map<std::string, double>& machine_rates,
                           ThreadLocalCache& cache) {
    std::set<std::vector<int>> all_inks;
    std::set<int> all_qtys;
    all_inks.insert({});
    for (auto& [oid, od] : order_lookup) {
        all_inks.insert(od.inks);
        all_qtys.insert(od.quantity);
    }
    for (auto& a : all_inks)
        for (auto& b : all_inks)
            changeover(a, b, cache);
    for (auto& [m, rate] : machine_rates)
        for (int q : all_qtys) {
            size_t key = std::hash<std::string>{}(m) ^ ((size_t)q * 31);
            cache.proc_time_cache[key] = q / rate / 60.0;
        }
}

FLEXO_FORCE_INLINE StepResult simulate_job_step(
    double& machine_time, std::vector<int>& prev_inks,
    double arrival, const std::vector<int>& job_inks,
    double setup_time_cfg, double proc, ThreadLocalCache& cache) {

    double earliest = std::max(machine_time, arrival);
    if (day_boundary_crossed(machine_time, earliest)) prev_inks.clear();

    int ink_chg = changeover(prev_inks, job_inks, cache);
    double setup = ink_chg > 0 ? setup_time_cfg : 0;

    if (earliest + setup + proc > next_shift_end(earliest)) {
        earliest = next_shift_end(earliest);
        prev_inks.clear();
        ink_chg = changeover(prev_inks, job_inks, cache);
        setup = ink_chg > 0 ? setup_time_cfg : 0;
    }

    double start = earliest + setup;
    double done = start + proc;
    machine_time = done;
    prev_inks = job_inks;
    return {earliest, start, done, ink_chg};
}

FLEXO_FORCE_INLINE StepResult probe_job_step(
    double machine_time, std::vector<int> prev_inks,
    double arrival, const std::vector<int>& job_inks,
    double setup_time_cfg, double proc, ThreadLocalCache& cache) {
    return simulate_job_step(machine_time, prev_inks, arrival, job_inks,
                             setup_time_cfg, proc, cache);
}

inline std::tuple<double, double, double, std::vector<std::string>> calculate_fitness(
    const std::map<std::string, std::vector<Job>>& schedule,
    const std::map<std::string, double>& machine_rates,
    double setup_time,
    double ink_weight, double bft_weight,
    const std::map<std::string, std::vector<int>>& init_inks,
    const std::map<std::string, std::map<std::string, double>>& initial_state,
    ThreadLocalCache& cache) {

    double total_ink = 0;
    std::map<double, std::pair<double, std::string>> batch_completions;

    for (auto& [m, jobs] : schedule) {
        double t = 0;
        std::vector<int> p_inks;

        auto it = initial_state.find(m);
        if (it != initial_state.end()) {
            auto tt = it->second.find("time");
            if (tt != it->second.end()) t = tt->second;
        }
        auto iit = init_inks.find(m);
        if (iit != init_inks.end()) p_inks = iit->second;

        for (auto& job : jobs) {
            double proc = get_proc_time(m, job.production_quantity, machine_rates, cache);
            auto step = simulate_job_step(
                t, p_inks, job.arrival_time, job.inks,
                setup_time, proc, cache);
            total_ink += step.ink_chg;
            auto& bc = batch_completions[job.arrival_time];
            if (step.done > bc.first) bc = {step.done, m};
        }
    }

    double sum_ft = 0;
    std::vector<std::string> crit;
    for (auto& [arr, comp] : batch_completions) {
        sum_ft += comp.first - arr;
        crit.push_back(comp.second);
    }
    int nb = (int)batch_completions.size();
    double avg_bft = nb > 0 ? sum_ft / nb : 0;
    double fit = ink_weight * total_ink + bft_weight * avg_bft;
    return {fit, total_ink, avg_bft, crit};
}

// Calculate global makespan: wall-clock time from t=0 until the last job
// completes on any machine.  Used only for final reporting — never called in
// the SA hot loop so correctness and clarity are prioritised over speed.
inline double calculate_makespan(
    const std::map<std::string, std::vector<Job>>& schedule,
    const std::map<std::string, double>& machine_rates,
    double setup_time,
    const std::map<std::string, std::vector<int>>& init_inks,
    const std::map<std::string, std::map<std::string, double>>& initial_state,
    ThreadLocalCache& cache) {

    double makespan = 0.0;
    for (auto& [m, jobs] : schedule) {
        if (jobs.empty()) continue;
        double t = 0.0;
        std::vector<int> p_inks;

        auto it = initial_state.find(m);
        if (it != initial_state.end()) {
            auto tt = it->second.find("time");
            if (tt != it->second.end()) t = tt->second;
        }
        auto iit = init_inks.find(m);
        if (iit != init_inks.end()) p_inks = iit->second;

        for (auto& job : jobs) {
            double proc = get_proc_time(m, job.production_quantity, machine_rates, cache);
            // simulate_job_step updates t and p_inks in-place
            simulate_job_step(t, p_inks, job.arrival_time, job.inks,
                              setup_time, proc, cache);
        }
        makespan = std::max(makespan, t);
    }
    return makespan;
}

inline std::map<std::string, MachineState> create_machine_states(
    double now,
    const std::vector<std::string>& machines,
    const std::map<std::string, double>& machine_rates,
    double setup_time,
    const std::map<std::string, std::map<std::string, double>>& initial_state,
    const std::map<std::string, std::vector<Job>>* schedule,
    const std::map<std::string, std::vector<int>>& init_inks,
    ThreadLocalCache& cache) {

    std::map<std::string, MachineState> states;
    for (auto& m : machines)
        states[m] = {m, 0, {}, {}, {}};

    if (!schedule) return states;

    for (auto& [m, jobs] : *schedule) {
        double clock = 0;
        std::vector<int> inks;

        auto it = initial_state.find(m);
        if (it != initial_state.end()) {
            auto tt = it->second.find("time");
            if (tt != it->second.end()) clock = tt->second;
        }
        auto ii = init_inks.find(m);
        if (ii != init_inks.end()) inks = ii->second;

        auto& st = states[m];
        st.current_time = clock;
        st.current_inks = inks;

        for (auto job : jobs) {
            double proc = get_proc_time(m, job.production_quantity, machine_rates, cache);
            auto step = simulate_job_step(
                clock, inks, job.arrival_time, job.inks,
                setup_time, proc, cache);

            job.start_time = step.start;
            job.completion_time = step.done;

            if (step.earliest <= now) {
                st.locked_jobs.push_back(job);
                st.current_time = step.done;
                st.current_inks = job.inks;
            } else {
                st.unlocked_jobs.push_back(job);
            }
        }

        if (day_boundary_crossed(st.current_time, now))
            st.current_inks.clear();
    }
    return states;
}

inline std::vector<Job> build_unlocked_jobs(
    const std::map<std::string, MachineState>& states,
    const std::map<std::string, Job>& visible_jobs) {

    std::unordered_set<std::string> scheduled;
    for (auto& [m, s] : states) {
        for (auto& j : s.locked_jobs) scheduled.insert(j.order_code);
        for (auto& j : s.unlocked_jobs) scheduled.insert(j.order_code);
    }

    std::vector<Job> unlocked;
    for (auto& [m, s] : states)
        for (auto& j : s.unlocked_jobs)
            unlocked.push_back(j);
    for (auto& [oid, j] : visible_jobs)
        if (scheduled.find(oid) == scheduled.end())
            unlocked.push_back(j);
    return unlocked;
}

// ── SA Shared Data Structures ────────────────────────────────────────────────
// Common fields used by all SA variants (optimizer and ablation).
// Each variant defines a derived SAContext that adds algorithm-specific fields.

struct SAContextBase {
    // Per-job data (Structure of Arrays for cache-friendly access)
    std::vector<int> job_ink_pattern_idx, job_qty_idx, job_arrival_idx;
    std::vector<double> job_arrival_time;
    std::vector<std::string> job_order_code;
    std::vector<std::vector<int>> job_inks;
    std::vector<int> job_production_quantity;
    int num_jobs = 0;

    // Precomputed flat tables
    std::vector<int> changeover_matrix;   // [prev_pat * num_patterns + next_pat]
    std::vector<double> proc_times;       // [machine * num_qtys + qty]
    std::vector<int> init_ink_patterns;
    std::vector<double> init_times;
    int num_machines = 0, num_patterns = 0, num_qtys = 0;

    // SA weights (duplicated here for self-contained hot path)
    double setup_time = 0, ink_weight = 0, batch_flow_time_weight = 0;

    // Batch arrival index
    std::vector<double> arrival_time_values;
    int num_arrival_times = 0;
};

struct SAWorkspace {
    std::vector<double> bc_time;
    std::vector<int> bc_machine, crit;
    double fitness = 0, ink_changes = 0, batch_flow_time = 0;
    std::vector<int> move_buf1, move_buf2;

    // Per-machine caches for delta fitness evaluation
    std::vector<int> machine_ink;       // [num_machines]
    std::vector<double> machine_bc;     // [num_machines * num_arrival_times]

    // Snapshot buffers for undo (saved before each move)
    std::vector<int> saved_machine_ink;
    std::vector<double> saved_machine_bc;

    void init(const SAContextBase& ctx) {
        bc_time.resize(ctx.num_arrival_times);
        bc_machine.resize(ctx.num_arrival_times);
        crit.reserve(ctx.num_arrival_times);
        move_buf1.resize(ctx.num_jobs);
        move_buf2.resize(ctx.num_jobs);
        int mbc_sz = ctx.num_machines * ctx.num_arrival_times;
        machine_ink.resize(ctx.num_machines, 0);
        machine_bc.resize(mbc_sz, -1.0);
        saved_machine_ink.resize(ctx.num_machines);
        saved_machine_bc.resize(mbc_sz);
    }
};

struct MoveUndo {
    int move_type = -1;
    int m1 = 0, m2 = 0;
    size_t i1 = 0, i2 = 0, j1 = 0, j2 = 0;
    size_t saved_len1 = 0, saved_len2 = 0;
};

struct Solution {
    std::map<std::string, std::vector<Job>> schedule;
    double fitness = 0, ink_changes = 0, batch_flow_time = 0;
    std::vector<std::string> critical_machines;
};

struct BatchObjectiveTrace {
    int batch_idx = 0;
    double arrival_time = 0;
    int unlocked_jobs = 0;
    int selected_seed = 0;
    double local_fitness = 0;
    double local_ink_changes = 0;
    double local_batch_flow_time = 0;
    double prefix_fitness = 0;
    double prefix_ink_changes = 0;
    double prefix_batch_flow_time = 0;
};

struct ExperimentResult {
    std::map<std::string, std::vector<Job>> schedule;
    double fitness = 0, batch_flow_time = 0, ink_changes = 0, runtime = 0, makespan = 0;
    std::vector<BatchObjectiveTrace> batch_objectives;
};

// ── SA Common Utilities ──────────────────────────────────────────────────────

// prewarm_caches overload for job-list input (used by SA variants).
inline void prewarm_caches(
    const std::vector<Job>& jobs,
    const std::vector<std::string>& machines,
    const std::map<std::string, double>& machine_rates,
    ThreadLocalCache& cache) {
    std::set<std::vector<int>> all_inks;
    std::set<int> all_qtys;
    all_inks.insert({});
    for (auto& j : jobs) { all_inks.insert(j.inks); all_qtys.insert(j.production_quantity); }
    for (auto& a : all_inks)
        for (auto& b : all_inks)
            changeover(a, b, cache);
    for (auto& m : machines) {
        double rate = machine_rates.at(m);
        for (int q : all_qtys) {
            size_t key = std::hash<std::string>{}(m) ^ ((size_t)q * 31);
            cache.proc_time_cache[key] = q / rate / 60.0;
        }
    }
}

// Fill the common (base) fields of an SAContext derived from SAContextBase.
// Call this first, then set algorithm-specific fields (move_cdf, Moser params, etc.).
inline void fill_sa_context_base(
    SAContextBase& ctx,
    const std::vector<Job>& jobs,
    const std::vector<std::string>& machines,
    const std::map<std::string, double>& machine_rates,
    double setup_time, double ink_weight, double batch_flow_time_weight,
    const std::map<std::string, std::vector<int>>& init_inks,
    const std::map<std::string, std::map<std::string, double>>& initial_state) {

    ctx.num_machines = (int)machines.size();
    ctx.setup_time = setup_time;
    ctx.ink_weight = ink_weight;
    ctx.batch_flow_time_weight = batch_flow_time_weight;

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
    ctx.changeover_matrix.resize(ctx.num_patterns * ctx.num_patterns);
    for (int i = 0; i < ctx.num_patterns; i++)
        for (int j = 0; j < ctx.num_patterns; j++)
            ctx.changeover_matrix[i * ctx.num_patterns + j] =
                changeover_compute(patterns[i], patterns[j]);

    // Build quantity index and flat processing time table
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
        double rate = machine_rates.at(machines[m]);
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

    // Arrival time index for batch-completion grouping
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
        ctx.job_qty_idx[i]         = qty_map[jobs[i].production_quantity];
        ctx.job_arrival_time[i]    = jobs[i].arrival_time;
        ctx.job_order_code[i]      = jobs[i].order_code;
        ctx.job_inks[i]            = jobs[i].inks;
        ctx.job_production_quantity[i] = jobs[i].production_quantity;
        ctx.job_arrival_idx[i]     = arr_map[jobs[i].arrival_time];
    }

    // Machine initial states
    ctx.init_ink_patterns.resize(ctx.num_machines);
    ctx.init_times.resize(ctx.num_machines, 0.0);
    for (int m = 0; m < ctx.num_machines; m++) {
        const std::string& mname = machines[m];
        auto it = init_inks.find(mname);
        ctx.init_ink_patterns[m] = (it != init_inks.end()) ? ink_map.at(it->second) : 0;
        auto it2 = initial_state.find(mname);
        if (it2 != initial_state.end()) {
            auto it3 = it2->second.find("time");
            if (it3 != it2->second.end()) ctx.init_times[m] = it3->second;
        }
    }
}

// ── Delta Fitness Primitives ─────────────────────────────────────────────────
// simulate_single_machine: re-simulate one machine, updating per-machine caches.
// aggregate_fitness:       derive global fitness from per-machine caches.
// calculate_fitness_delta: re-simulate only affected machines + aggregate.
// save_workspace / restore_workspace: snapshot/restore caches for SA undo.

FLEXO_FORCE_INLINE void simulate_single_machine(
    int m, const std::vector<int>& jobs,
    const SAContextBase& ctx, SAWorkspace& ws) {

    const int np = ctx.num_patterns, nq = ctx.num_qtys;
    const int*    co      = ctx.changeover_matrix.data();
    const double* pt      = ctx.proc_times.data();
    const int*    ink_idx = ctx.job_ink_pattern_idx.data();
    const int*    qty_idx = ctx.job_qty_idx.data();
    const double* arr     = ctx.job_arrival_time.data();
    const int*    aidx    = ctx.job_arrival_idx.data();

    const int na = ctx.num_arrival_times;
    double* mbc = ws.machine_bc.data() + m * na;
    std::fill(mbc, mbc + na, -1.0);

    double t         = ctx.init_times[m];
    int    p_ink_off = ctx.init_ink_patterns[m] * np;
    const int mo     = m * nq;
    int ink_total    = 0;

    for (int ji : jobs) {
        double earliest = std::max(t, arr[ji]);
        if (day_boundary_crossed(t, earliest)) p_ink_off = 0;

        int    job_ink = ink_idx[ji];
        int    chg     = co[p_ink_off + job_ink];
        double setup   = chg > 0 ? ctx.setup_time : 0;
        double proc    = pt[mo + qty_idx[ji]];

        double shift_end = next_shift_end(earliest);
        if (earliest + setup + proc > shift_end) {
            earliest   = shift_end;
            p_ink_off  = 0;
            chg        = co[job_ink];
            setup      = chg > 0 ? ctx.setup_time : 0;
        }

        double done = earliest + setup + proc;
        ink_total  += chg;

        int ai = aidx[ji];
        if (done > mbc[ai]) mbc[ai] = done;

        t         = done;
        p_ink_off = job_ink * np;
    }
    ws.machine_ink[m] = ink_total;
}

FLEXO_FORCE_INLINE void aggregate_fitness(
    const SAContextBase& ctx, SAWorkspace& ws) {

    const int na = ctx.num_arrival_times;
    const int nm = ctx.num_machines;

    int total_ink = 0;
    for (int m = 0; m < nm; m++) total_ink += ws.machine_ink[m];

    double sum_ft = 0;
    int    nb     = 0;
    ws.crit.clear();
    for (int i = 0; i < na; i++) {
        double best = -1.0;
        int    best_m = -1;
        for (int m = 0; m < nm; m++) {
            double v = ws.machine_bc[m * na + i];
            if (v > best) { best = v; best_m = m; }
        }
        if (best >= 0.0) {
            sum_ft += best - ctx.arrival_time_values[i];
            ws.crit.push_back(best_m);
            nb++;
        }
    }
    ws.batch_flow_time = nb > 0 ? sum_ft / nb : 0;
    ws.ink_changes     = total_ink;
    ws.fitness         = ctx.ink_weight * total_ink + ctx.batch_flow_time_weight * ws.batch_flow_time;
}

// Full evaluation — simulates all machines.  Used for initial + final.
inline void calculate_fitness_internal(
    const std::vector<std::vector<int>>& schedule,
    const SAContextBase& ctx, SAWorkspace& ws) {

    for (int m = 0; m < ctx.num_machines; m++)
        simulate_single_machine(m, schedule[m], ctx, ws);
    aggregate_fitness(ctx, ws);
}

// Delta evaluation — re-simulate only affected machine(s).
FLEXO_FORCE_INLINE void calculate_fitness_delta(
    const std::vector<std::vector<int>>& schedule,
    const SAContextBase& ctx, SAWorkspace& ws,
    int m1, int m2) {

    simulate_single_machine(m1, schedule[m1], ctx, ws);
    if (m2 != m1)
        simulate_single_machine(m2, schedule[m2], ctx, ws);
    aggregate_fitness(ctx, ws);
}

// Save per-machine caches before a move (cheap memcpy).
FLEXO_FORCE_INLINE void save_workspace(SAWorkspace& ws) {
    std::memcpy(ws.saved_machine_ink.data(), ws.machine_ink.data(),
               ws.machine_ink.size() * sizeof(int));
    std::memcpy(ws.saved_machine_bc.data(), ws.machine_bc.data(),
               ws.machine_bc.size() * sizeof(double));
}

// Restore per-machine caches after a rejected move.
FLEXO_FORCE_INLINE void restore_workspace(SAWorkspace& ws) {
    std::memcpy(ws.machine_ink.data(), ws.saved_machine_ink.data(),
               ws.machine_ink.size() * sizeof(int));
    std::memcpy(ws.machine_bc.data(), ws.saved_machine_bc.data(),
               ws.machine_bc.size() * sizeof(double));
}

} // namespace flexo_sim
