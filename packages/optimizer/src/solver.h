#pragma once
#include "moves.h"
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
#ifdef __EMSCRIPTEN__
        if ((it&65535)==0) flexo_progress(it,budget);
#endif
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


}
