#include <pybind11/pybind11.h>
#include <pybind11/stl.h>
#include <chrono>
#include "moves.h"

namespace py = pybind11;
namespace flexo {

void commit_suffix(Cache& dest, const Cache& src, int first, int last, int b) {
    // The incoming row is unchanged; copy only the newly simulated rows.
    int count=last-first;
    if (count==0) return;
    ++first;
    std::copy_n(src.time.data()+first,count,dest.time.data()+first);
    std::copy_n(src.pattern.data()+first,count,dest.pattern.data()+first);
    std::copy_n(src.ink.data()+first,count,dest.ink.data()+first);
    std::copy_n(src.batches.data()+first*b,count*b,dest.batches.data()+first*b);
}

SearchResult search(const Problem& p, const Parameters& par, uint64_t seed, int budget, bool debug) {
    Xoshiro256pp rng(seed);
    Schedule seq(p.m);
    for (auto& s:seq) s.reserve(p.n);
    std::vector<Cache> caches;
    caches.reserve(p.m);
    for (int machine=0; machine<p.m; ++machine) {
        caches.emplace_back(p.n,p.b); p.initialize(caches.back(),machine);
    }
    Cache trial1(p.n,p.b), trial2(p.n,p.b);
    std::vector<bool> assigned(p.n,false);
    std::vector<double> best_score(p.n);
    std::vector<int> best_machine(p.n), rcl;
    std::vector<int> construction_order(p.n);
    std::iota(construction_order.begin(),construction_order.end(),0);
    std::sort(construction_order.begin(),construction_order.end(),[&](int a,int b) {
        if (p.arrivals[a]!=p.arrivals[b]) return p.arrivals[a]<p.arrivals[b];
        return p.processing[a]>p.processing[b];
    });
    rcl.reserve(p.n);
    // Appending needs one transition, not a replay of the partial schedule.
    for (int remaining=p.n; remaining>0; --remaining) {
        double low=std::numeric_limits<double>::infinity(), high=-low;
        for (int job:construction_order) if (!assigned[job]) {
            best_score[job]=std::numeric_limits<double>::infinity();
            for (int machine=0; machine<p.m; ++machine) {
                int pos=(int)seq[machine].size();
                seq[machine].push_back(job);
                p.suffix(trial1,caches[machine],seq[machine],machine,pos);
                double fit=p.score(seq,caches,machine,&trial1);
                seq[machine].pop_back();
                if (fit<best_score[job]) { best_score[job]=fit; best_machine[job]=machine; }
            }
            if (!std::isfinite(best_score[job])) throw std::invalid_argument("Job cannot fit within a fresh 8-hour shift on any machine");
            low=std::min(low,best_score[job]); high=std::max(high,best_score[job]);
        }
        rcl.clear();
        for (int job:construction_order)
            if (!assigned[job] && best_score[job]<=low+par.rcl_alpha*(high-low)+1e-12) rcl.push_back(job);
        int job=rcl[rng.bounded(rcl.size())], machine=best_machine[job];
        int pos=(int)seq[machine].size(); seq[machine].push_back(job);
        p.suffix(caches[machine],caches[machine],seq[machine],machine,pos);
        assigned[job]=true;
    }
    double cur=p.score(seq,caches);
    SearchResult best{seq,cur,0};
    SAContext ctx{p.m,par.p_inter,par.p_shift,par.p_block};
    SAWorkspace ws; ws.move_buf1.resize(p.n); ws.move_buf2.resize(p.n);
    int stages=std::max(1,budget/par.stage_length+(budget%par.stage_length!=0));
    double factor=stages>1 ? std::pow(par.t_min/par.t_max,1./(stages-1)) : 1.;
    double temperature=par.t_max;
    int stage_remaining=par.stage_length;
    Schedule before;
    for (int it=0; it<budget; ++it) {
        if (stage_remaining==0) { temperature*=factor; stage_remaining=par.stage_length; }
        --stage_remaining;
        if (debug) before=seq;
        MoveUndo undo;
        apply_move_internal(seq,ctx,ws,rng,undo);
        if (undo.move_type<0) continue;
        int m1=undo.m1, m2=undo.m2;
        int first1=(int)(m1==m2 ? std::min(undo.i1,undo.i2) : undo.i1);
        int first2=(int)undo.i2;
        p.suffix(trial1,caches[m1],seq[m1],m1,first1);
        if (m1!=m2) p.suffix(trial2,caches[m2],seq[m2],m2,first2);
        double fit=p.score(seq,caches,m1,&trial1,m1==m2 ? -1:m2,&trial2);
        if (debug) {
            auto full=caches;
            for (int machine=0; machine<p.m; ++machine) p.suffix(full[machine],full[machine],seq[machine],machine,0);
            double reference=p.score(seq,full);
            if (std::isfinite(fit)!=std::isfinite(reference) || (std::isfinite(fit) && std::abs(fit-reference)>1e-8))
                throw std::logic_error("Incremental fitness differs from full evaluation");
        }
        bool accept=std::isfinite(fit) && (fit<=cur || rng.next_double()<std::exp((cur-fit)/temperature));
        if (accept) {
            commit_suffix(caches[m1],trial1,first1,(int)seq[m1].size(),p.b);
            if (m1!=m2) commit_suffix(caches[m2],trial2,first2,(int)seq[m2].size(),p.b);
            cur=fit;
            if (cur<best.fitness) { best.schedule=seq; best.fitness=cur; }
        } else {
            revert_move_internal(seq,undo,ws);
            if (debug) {
                if (seq!=before) throw std::logic_error("Move undo did not restore the original sequence");
                auto full=caches;
                for (int machine=0; machine<p.m; ++machine) p.suffix(full[machine],full[machine],seq[machine],machine,0);
                if (std::abs(p.score(seq,full)-cur)>1e-8) throw std::logic_error("Move undo changed schedule fitness");
            }
        }
    }
    best.evaluations=budget;
    return best;
}

SearchResult solve(const Problem& p, const Parameters& par, uint64_t seed, int threads, bool debug) {
    if (p.n==0) {
        Schedule seq(p.m); std::vector<Cache> caches;
        for (int machine=0; machine<p.m; ++machine) { caches.emplace_back(0,p.b); p.initialize(caches.back(),machine); }
        return {seq,p.score(seq,caches),0};
    }
    int starts=std::min(par.starts,std::max(1,par.evaluations));
    Xoshiro256pp rng(seed);
    std::vector<uint64_t> seeds(starts);
    for (auto& s:seeds) s=static_cast<uint32_t>(rng());
    std::vector<SearchResult> results(starts);
    std::atomic<int> next{0}; std::exception_ptr error; std::mutex error_mutex;
    auto worker=[&] {
        try {
            while (true) {
                int i=next.fetch_add(1); if (i>=starts) break;
                int budget=par.evaluations/starts+(i<par.evaluations%starts ? 1:0);
                results[i]=search(p,par,seeds[i],budget,debug);
            }
        } catch (...) { std::lock_guard<std::mutex> lock(error_mutex); if (!error) error=std::current_exception(); }
    };
    int count=std::min(starts,threads>0 ? threads:(int)std::max(1u,std::thread::hardware_concurrency()));
    if (count==1) worker();
    else {
        std::vector<std::thread> pool;
        try { for (int i=0; i<count; ++i) pool.emplace_back(worker); }
        catch (...) { for (auto& t:pool) t.join(); throw; }
        for (auto& t:pool) t.join();
    }
    if (error) std::rethrow_exception(error);
    int best=0;
    for (int i=1; i<starts; ++i) if (results[i].fitness<results[best].fitness) best=i;
    results[best].evaluations=par.evaluations;
    return results[best];
}

Problem from_dict(const py::dict& d) {
    Problem p;
    p.arrivals=d["arrivals"].cast<std::vector<double>>(); p.n=(int)p.arrivals.size();
    p.initial_time=d["initial_time"].cast<std::vector<double>>(); p.m=(int)p.initial_time.size();
    p.batch_arrivals=d["batch_arrivals"].cast<std::vector<double>>(); p.b=(int)p.batch_arrivals.size();
    p.patterns=d["patterns"].cast<int>();
    p.setup=d["setup"].cast<double>(); p.ink_weight=d["ink_weight"].cast<double>(); p.flow_weight=d["flow_weight"].cast<double>();
    p.processing=d["processing"].cast<std::vector<double>>();
    p.transitions=d["transitions"].cast<std::vector<double>>();
    p.job_pattern=d["job_pattern"].cast<std::vector<int>>(); p.job_batch=d["job_batch"].cast<std::vector<int>>();
    p.initial_pattern=d["initial_pattern"].cast<std::vector<int>>();
    p.initial_ink=d["initial_ink"].cast<std::vector<double>>(); p.initial_batches=d["initial_batches"].cast<std::vector<double>>();
    if (p.m<1 || p.patterns<1 || p.processing.size()!=size_t(p.m*p.n) || p.transitions.size()!=size_t(p.patterns*p.patterns)
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
            if (par.evaluations<0 || par.starts<1 || par.starts>4 || par.stage_length<1 || !(par.t_min>0 && par.t_max>par.t_min)
                || !std::isfinite(par.t_max) || threads<0) throw std::invalid_argument("Invalid search parameters");
            for (double prob:{par.rcl_alpha,par.p_inter,par.p_shift,par.p_block})
                if (!(prob>=0 && prob<=1)) throw std::invalid_argument("Probabilities must be between zero and one");
            auto begin=std::chrono::steady_clock::now(); SearchResult r;
            { py::gil_scoped_release release; r=solve(p,par,seed,threads,debug); }
            auto out=evaluate(p,r.schedule); out["evaluations"]=r.evaluations;
            out["runtime"]=std::chrono::duration<double>(std::chrono::steady_clock::now()-begin).count(); return out;
        },py::arg("parameters"),py::arg("seed"),py::arg("num_threads"),py::arg("debug")=false);
}
