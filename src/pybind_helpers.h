#pragma once
// ============================================================================
// Flexo Scheduling — shared Python-binding helpers
// Included by optimizer.cpp, ablation.cpp, dispatch.cpp.
// ============================================================================
// Compile C++ files with:
// Remove-Item -Recurse -Force build, \*.egg-info -ErrorAction SilentlyContinue; pip install . --force-reinstall --no-cache-dir

#include <map>
#include <string>
#include <vector>
#include <pybind11/pybind11.h>
#include <pybind11/stl.h>
#include "simulator.h"

namespace py = pybind11;

// Convert a C++ schedule map to a Python dict {machine: [job_dict, ...]}.
inline py::dict schedule_to_pydict(
    const std::map<std::string, std::vector<flexo_sim::Job>>& schedule) {
    py::dict d;
    for (auto& [m, jobs] : schedule) {
        py::list jl;
        for (auto& j : jobs) {
            py::dict jd;
            jd["order_code"]          = j.order_code;
            jd["inks"]                = j.inks;
            jd["production_quantity"] = j.production_quantity;
            jd["arrival_time"]        = j.arrival_time;
            jl.append(jd);
        }
        d[py::str(m)] = jl;
    }
    return d;
}

// Convert Python input lists to C++ BatchData / OrderData structures.
inline std::pair<std::vector<flexo_sim::BatchData>,
                 std::map<std::string, flexo_sim::OrderData>>
convert_input(
    const std::vector<std::map<std::string, py::object>>& job_batches,
    const std::vector<std::map<std::string, py::object>>& orders_data) {

    std::map<std::string, flexo_sim::OrderData> order_lookup;
    for (auto& o : orders_data) {
        flexo_sim::OrderData od;
        od.id       = py::str(o.at("id"));
        od.quantity = o.at("quantity").cast<int>();
        for (auto& ink : o.at("inks")) od.inks.push_back(ink.cast<int>());
        order_lookup[od.id] = od;
    }

    std::vector<flexo_sim::BatchData> batches;
    for (auto& batch : job_batches) {
        flexo_sim::BatchData bd;
        bd.arrival_time = batch.at("arrival_time").cast<double>();
        for (auto& item : batch.at("orders"))
            bd.orders.push_back(py::str(item));
        batches.push_back(bd);
    }
    return {batches, order_lookup};
}
