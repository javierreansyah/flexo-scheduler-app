// ============================================================================
// Flexo Scheduling ??? Dispatching Rule Baselines
// ============================================================================
// Compile C++ files with:
// Remove-Item -Recurse -Force build, \*.egg-info -ErrorAction SilentlyContinue; pip install . --force-reinstall --no-cache-dir
//
// Rules:
//   SPT  ??? Shortest Processing Time with earliest-completion assignment
//   GMC  ??? Greedy Minimum Changeover (minimum ink change, tie-break by ECT)
//
// Uses the same rolling-horizon framework, shift-boundary logic, ink
// changeover computation, and fitness evaluation as the main SA optimizer
// so that results are directly comparable.
//
// ============================================================================

#include <pybind11/pybind11.h>
#include <pybind11/stl.h>
#include <algorithm>
#include <chrono>
#include <climits>
#include <cmath>
#include <functional>
#include <map>
#include <memory>
#include <numeric>
#include <set>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>
#include "simulator.h"
#include "pybind_helpers.h"

namespace py = pybind11;

using Job            = flexo_sim::Job;
using OrderData      = flexo_sim::OrderData;
using BatchData      = flexo_sim::BatchData;
using MachineState   = flexo_sim::MachineState;
using ThreadLocalCache = flexo_sim::ThreadLocalCache;
using StepResult     = flexo_sim::StepResult;
using ExperimentResult = flexo_sim::ExperimentResult;

// ?????? SPT Dispatching Rule ????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
// Sort jobs by quantity (ascending = shortest processing time first).
// Assign each job to the machine where it would finish earliest.

void dispatch_spt(
    std::vector<Job>& jobs,
    std::map<std::string, MachineState>& states,
    const std::map<std::string, double>& rates,
    double setup_time,
    ThreadLocalCache& cache) {

    // Sort by quantity ascending (shortest processing time first)
    std::sort(jobs.begin(), jobs.end(), [](const Job& a, const Job& b) {
        return a.production_quantity < b.production_quantity;
    });

    for (auto& job : jobs) {
        std::string best_machine;
        double best_done = 1e18;

        // Find the machine where this job would finish earliest
        for (auto& [m, state] : states) {
            double proc = flexo_sim::get_proc_time(m, job.production_quantity, rates, cache);
            auto step = flexo_sim::probe_job_step(
                state.current_time, state.current_inks,
                job.arrival_time, job.inks, setup_time, proc, cache);

            if (step.done < best_done) {
                best_done = step.done;
                best_machine = m;
            }
        }

        // Assign to best machine — simulate in-place
        auto& st = states[best_machine];
        double proc = flexo_sim::get_proc_time(best_machine, job.production_quantity, rates, cache);
        auto step = flexo_sim::simulate_job_step(
            st.current_time, st.current_inks,
            job.arrival_time, job.inks, setup_time, proc, cache);

        job.start_time = step.start;
        job.completion_time = step.done;
        st.locked_jobs.push_back(job);
    }
}

// ?????? GMC (Greedy Minimum Changeover) Dispatching Rule ????????????????????????????????????????????????????????????????????????
// At each step, pick the (job, machine) pair with the minimum changeover cost.
// Ties broken by earliest completion time.

void dispatch_gmc(
    std::vector<Job>& jobs,
    std::map<std::string, MachineState>& states,
    const std::map<std::string, double>& rates,
    double setup_time,
    ThreadLocalCache& cache) {

    std::vector<bool> assigned(jobs.size(), false);

    for (size_t step_num = 0; step_num < jobs.size(); step_num++) {
        int best_chg = INT_MAX;
        double best_done = 1e18;
        int best_ji = -1;
        std::string best_machine;

        for (size_t ji = 0; ji < jobs.size(); ji++) {
            if (assigned[ji]) continue;
            auto& job = jobs[ji];

            for (auto& [m, state] : states) {
                double proc = flexo_sim::get_proc_time(m, job.production_quantity, rates, cache);
                auto step = flexo_sim::probe_job_step(
                    state.current_time, state.current_inks,
                    job.arrival_time, job.inks, setup_time, proc, cache);

                // Primary: minimum changeover; Secondary: earliest completion
                if (step.ink_chg < best_chg ||
                    (step.ink_chg == best_chg && step.done < best_done)) {
                    best_chg = step.ink_chg;
                    best_done = step.done;
                    best_ji = (int)ji;
                    best_machine = m;
                }
            }
        }

        if (best_ji < 0) break;  // safety: no unassigned jobs left

        // Assign best_ji to best_machine
        auto& job = jobs[best_ji];
        auto& st = states[best_machine];
        double proc = flexo_sim::get_proc_time(best_machine, job.production_quantity, rates, cache);
        auto step = flexo_sim::simulate_job_step(
            st.current_time, st.current_inks,
            job.arrival_time, job.inks, setup_time, proc, cache);

        job.start_time = step.start;
        job.completion_time = step.done;
        st.locked_jobs.push_back(job);
        assigned[best_ji] = true;
    }
}

// ?????? Rolling Horizon Dispatch Engine ???????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
// Mirrors run_experiment_core from optimizer.cpp exactly, except the SA
// optimize() call is replaced by dispatch_spt() or dispatch_gmc().

ExperimentResult run_dispatch_core(
    const std::string& rule,
    const std::vector<BatchData>& batches,
    const std::map<std::string, OrderData>& order_lookup,
    const std::map<std::string, double>& machine_production_rates,
    double sequence_dependent_setup_time,
    double ink_weight, double batch_flow_time_weight) {

    auto t_start = std::chrono::high_resolution_clock::now();
    ThreadLocalCache cache;

    // Machine name list (same ordering as optimizer.cpp)
    std::vector<std::string> machines;
    for (auto& [name, rate] : machine_production_rates) machines.push_back(name);

    // Prewarm caches
    flexo_sim::prewarm_caches(order_lookup, machine_production_rates, cache);

    // Build all jobs and sort batches by arrival (identical to optimizer.cpp)
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
    std::map<std::string, std::vector<int>> init_inks_global;  // always empty, same as optimizer
    static const std::map<std::string, std::map<std::string, double>> empty_initial_state;

    // Rolling horizon: process each batch arrival (mirrors optimizer.cpp)
    for (auto& [arrival, oids] : sorted_batches) {
        double now = arrival;

        // Visible jobs: arrival <= now (same as optimizer.cpp)
        std::map<std::string, Job> visible;
        for (auto& [oid, j] : all_jobs)
            if (j.arrival_time <= now) visible[oid] = j;

        // Machine states from current schedule (same as optimizer.cpp)
        auto states = flexo_sim::create_machine_states(
            now, machines, machine_production_rates,
            sequence_dependent_setup_time,
            empty_initial_state,
            current_schedule.get(), init_inks_global, cache);

        // Unlocked + new jobs (same call as optimizer.cpp)
        auto unlocked = flexo_sim::build_unlocked_jobs(states, visible);
        if (unlocked.empty()) continue;

        // Clear unlocked_jobs from states ??? dispatch will rebuild from scratch
        for (auto& [m, s] : states) {
            s.unlocked_jobs.clear();
        }

        // Apply dispatching rule (replaces SA optimize() call)
        if (rule == "spt") {
            dispatch_spt(unlocked, states, machine_production_rates,
                        sequence_dependent_setup_time, cache);
        } else {  // "gmc"
            dispatch_gmc(unlocked, states, machine_production_rates,
                        sequence_dependent_setup_time, cache);
        }

        // Merge locked + dispatched results (mirrors optimizer.cpp)
        // In optimizer.cpp:
        //   (*current_schedule)[m] = s.locked_jobs;
        //   (*current_schedule)[m].insert(end, sol.schedule[m]...);
        // Here the dispatched jobs are already appended to locked_jobs by dispatch_*()
        if (!current_schedule)
            current_schedule = std::make_unique<std::map<std::string, std::vector<Job>>>();
        for (auto& [m, st] : states) {
            (*current_schedule)[m] = st.locked_jobs;
        }
    }

    if (!current_schedule)
        current_schedule = std::make_unique<std::map<std::string, std::vector<Job>>>();

    // Final fitness evaluation (identical to optimizer.cpp)
    auto [fit, ink, bft, crit] = flexo_sim::calculate_fitness(
        *current_schedule, machine_production_rates,
        sequence_dependent_setup_time, ink_weight, batch_flow_time_weight,
        init_inks_global, empty_initial_state, cache);
    double makespan = flexo_sim::calculate_makespan(
        *current_schedule, machine_production_rates,
        sequence_dependent_setup_time,
        init_inks_global, empty_initial_state, cache);
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

// ?????? Python Bindings ???????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????

py::dict run_dispatch(
    const std::string& rule,
    const std::vector<std::map<std::string, py::object>>& job_batches,
    const std::vector<std::map<std::string, py::object>>& orders_data,
    const std::map<std::string, double>& machine_production_rates,
    double sequence_dependent_setup_time,
    double ink_weight, double batch_flow_time_weight) {

    auto [batches, order_lookup] = convert_input(job_batches, orders_data);
    auto result = run_dispatch_core(
        rule, batches, order_lookup, machine_production_rates,
        sequence_dependent_setup_time, ink_weight, batch_flow_time_weight);

    py::dict ret;
    ret["schedule"] = schedule_to_pydict(result.schedule);
    ret["fitness"] = result.fitness;
    ret["batch_flow_time"] = result.batch_flow_time;
    ret["ink_changes"] = result.ink_changes;
    ret["runtime"] = result.runtime;
    ret["makespan"] = result.makespan;
    return ret;
}

PYBIND11_MODULE(dispatch, m) {
    m.doc() = "Dispatching rule baselines for flexo scheduling";
    m.def("run_dispatch", &run_dispatch,
        py::arg("rule"),
        py::arg("job_batches"),
        py::arg("orders_data"),
        py::arg("machine_production_rates"),
        py::arg("sequence_dependent_setup_time"),
        py::arg("ink_weight"),
        py::arg("batch_flow_time_weight"),
        R"doc(
        Run a dispatching rule on a flexo scheduling instance.

        Parameters
        ----------
        rule : str
            "spt" (Shortest Processing Time) or "gmc" (Greedy Minimum Changeover)
        job_batches : list[dict]
            Each dict has 'arrival_time' (float) and 'orders' (list of order IDs)
        orders_data : list[dict]
            Each dict has 'id', 'quantity' (int), 'inks' (list[int])
        machine_production_rates : dict[str, float]
            Machine name -> production rate (pieces/min)
        sequence_dependent_setup_time : float
            Setup time (hours) when ink changeover > 0
        ink_weight : float
            Weight for ink changeover objective
        batch_flow_time_weight : float
            Weight for batch flow time objective

        Returns
        -------
        dict with keys: schedule, fitness, batch_flow_time, ink_changes, runtime
        )doc");
}

