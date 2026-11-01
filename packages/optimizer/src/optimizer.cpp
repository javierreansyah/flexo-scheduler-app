#include <pybind11/pybind11.h>
#include <pybind11/stl.h>
#include <chrono>
#include "solver.h"

namespace py = pybind11;
namespace flexo {

Problem from_dict(const py::dict& d) {
    Problem p;
    p.arrivals=d["arrivals"].cast<std::vector<double>>(); p.n=(int)p.arrivals.size();
    p.initial_time=d["initial_time"].cast<std::vector<double>>(); p.m=(int)p.initial_time.size();
    p.batch_arrivals=d["batch_arrivals"].cast<std::vector<double>>(); p.b=(int)p.batch_arrivals.size();
    p.patterns=d["patterns"].cast<int>();
    p.setup=d["setup"].cast<double>(); p.ink_weight=d["ink_weight"].cast<double>(); p.flow_weight=d["flow_weight"].cast<double>();
    p.processing=d["processing"].cast<std::vector<double>>();
    p.transitions=d["transitions"].cast<std::vector<double>>();
    if (d.contains("durations")) p.durations=d["durations"].cast<std::vector<double>>();
    p.job_pattern=d["job_pattern"].cast<std::vector<int>>(); p.job_batch=d["job_batch"].cast<std::vector<int>>();
    p.initial_pattern=d["initial_pattern"].cast<std::vector<int>>();
    p.initial_ink=d["initial_ink"].cast<std::vector<double>>(); p.initial_batches=d["initial_batches"].cast<std::vector<double>>();
    if ((!p.durations.empty() && p.durations.size()!=size_t(p.patterns*p.patterns)) || p.m<1 || p.patterns<1 || p.processing.size()!=size_t(p.m*p.n) || p.transitions.size()!=size_t(p.patterns*p.patterns)
        || p.job_pattern.size()!=size_t(p.n) || p.job_batch.size()!=size_t(p.n) || p.initial_pattern.size()!=size_t(p.m)
        || p.initial_ink.size()!=size_t(p.m) || p.initial_batches.size()!=size_t(p.m*p.b)) throw std::invalid_argument("Invalid core array dimensions");
    for (int x:p.job_pattern) if (x<0 || x>=p.patterns) throw std::invalid_argument("Invalid pattern index");
    for (int x:p.initial_pattern) if (x<0 || x>=p.patterns) throw std::invalid_argument("Invalid initial pattern index");
    for (int x:p.job_batch) if (x<0 || x>=p.b) throw std::invalid_argument("Invalid batch index");
    return p;
}

py::dict evaluate(const Problem& p, const Schedule& seq) {
    if (seq.size()!=size_t(p.m)) throw std::invalid_argument("Wrong machine count");
    std::vector<int> seen(p.n,0);
    for (auto& jobs:seq) for (int j:jobs) if (j<0 || j>=p.n || ++seen[j]!=1) throw std::invalid_argument("Invalid or duplicate job");
    for (int count:seen) if (count!=1) throw std::invalid_argument("Missing job");
    std::vector<Cache> caches; py::list timelines;
    double ink=0, makespan=0, flow=0;
    for (int machine=0; machine<p.m; ++machine) {
        caches.emplace_back(p.n,p.b); auto& c=caches.back(); p.initialize(c,machine);
        p.suffix(c,c,seq[machine],machine,0);
        py::list timeline; double time=p.initial_time[machine]; int pattern=p.initial_pattern[machine];
        for (int job:seq[machine]) {
            auto s=p.step(machine,job,time,pattern);
            if (!std::isfinite(s.completion)) throw std::invalid_argument("Schedule contains an infeasible job assignment");
            py::dict entry; entry["job"]=job; entry["setup_start"]=s.setup_start; entry["start"]=s.start;
            entry["completion"]=s.completion; entry["ink_change_cost"]=s.cost;
            timeline.append(entry); time=s.completion; pattern=s.pattern;
        }
        timelines.append(timeline); ink+=c.ink[seq[machine].size()];
        if (!seq[machine].empty()) makespan=std::max(makespan,time);
    }
    for (int batch=0; batch<p.b; ++batch) {
        double done=-1;
        for (int machine=0; machine<p.m; ++machine) done=std::max(done,caches[machine].batches[seq[machine].size()*p.b+batch]);
        flow+=done-p.batch_arrivals[batch]; makespan=std::max(makespan,done);
    }
    py::dict out; out["schedule"]=timelines; out["fitness"]=p.score(seq,caches); out["ink_changes"]=ink;
    out["batch_flow_time"]=p.b ? flow/p.b:0; out["makespan"]=makespan;
    return out;
}
} // namespace flexo

PYBIND11_MODULE(_core,m) {
    using namespace flexo;
    m.def("changeover",&changeover);
    m.def("step_duration",[](double t,double a,double p,double c,double e,double d,double ed){auto s=advance(t,a,p,c,e,d,ed); return std::vector<double>{s.setup_start,s.start,s.completion,s.cost};});
    m.def("step",[](double time,double arrival,double proc,double cost,double empty_cost,double setup) {
        auto s=advance(time,arrival,proc,cost,empty_cost,setup);
        return std::vector<double>{s.setup_start,s.start,s.completion,s.cost};
    });
    py::class_<Problem>(m,"Problem").def(py::init(&from_dict))
        .def("evaluate",&evaluate)
        .def("solve",[](const Problem& p,const py::dict& config,uint64_t seed,int threads,bool debug) {
            Parameters par;
            par.evaluations=config["evaluations"].cast<int>(); par.starts=config["starts"].cast<int>();
            par.stage_length=config["stage_length"].cast<int>(); par.t_max=config["t_max"].cast<double>(); par.t_min=config["t_min"].cast<double>();
            par.rcl_alpha=config["rcl_alpha"].cast<double>(); par.p_inter=config["p_inter"].cast<double>();
            par.p_shift=config["p_shift"].cast<double>(); par.p_block=config["p_block"].cast<double>();
            if (par.evaluations<0 || par.starts<1 || par.starts>20 || par.stage_length<1 || !(par.t_min>0 && par.t_max>par.t_min)
                || !std::isfinite(par.t_max) || threads<0) throw std::invalid_argument("Invalid search parameters");
            for (double prob:{par.rcl_alpha,par.p_inter,par.p_shift,par.p_block})
                if (!(prob>=0 && prob<=1)) throw std::invalid_argument("Probabilities must be between zero and one");
            auto begin=std::chrono::steady_clock::now(); SearchResult r;
            { py::gil_scoped_release release; r=solve(p,par,seed,threads,debug); }
            auto out=evaluate(p,r.schedule); out["evaluations"]=r.evaluations;
            out["runtime"]=std::chrono::duration<double>(std::chrono::steady_clock::now()-begin).count(); return out;
        },py::arg("parameters"),py::arg("seed"),py::arg("num_threads"),py::arg("debug")=false);
}
