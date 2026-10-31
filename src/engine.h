#pragma once
#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <exception>
#include <limits>
#include <mutex>
#include <numeric>
#include <stdexcept>
#include <thread>
#include <vector>
#ifdef _MSC_VER
#include <intrin.h>
#endif
#define FLEXO_FORCE_INLINE inline

namespace flexo {
using Schedule = std::vector<std::vector<int>>;

struct SAContext {
    int num_machines;
    double p_I, p_S, p_B;
    int B_max = 26;
};
struct SAWorkspace { std::vector<int> move_buf1, move_buf2; };
struct MoveUndo {
    int move_type = -1, m1 = 0, m2 = 0;
    size_t i1 = 0, i2 = 0, saved_len1 = 0, saved_len2 = 0;
};

// Minimum-cost assignment after cancelling identical inks. Dummy entries
// account for unmatched additions/removals without enumerating permutations.
inline double changeover(std::vector<int> a, std::vector<int> b,
                         const std::vector<std::vector<double>>& costs) {
    std::sort(a.begin(), a.end()); std::sort(b.begin(), b.end());
    std::vector<int> rem, add;
    std::set_difference(a.begin(), a.end(), b.begin(), b.end(), std::back_inserter(rem));
    std::set_difference(b.begin(), b.end(), a.begin(), a.end(), std::back_inserter(add));
    int n = (int)std::max(rem.size(), add.size());
    rem.resize(n, 0); add.resize(n, 0);
    std::vector<double> u(n+1), v(n+1);
    std::vector<int> p(n+1), way(n+1);
    for (int i=1; i<=n; ++i) {
        p[0]=i; int j0=0;
        std::vector<double> dist(n+1, std::numeric_limits<double>::infinity());
        std::vector<bool> used(n+1, false);
        do {
            used[j0]=true; int i0=p[j0], j1=0;
            double delta=std::numeric_limits<double>::infinity();
            for (int j=1; j<=n; ++j) if (!used[j]) {
                double cur=costs.at(rem[i0-1]).at(add[j-1])-u[i0]-v[j];
                if (cur<dist[j]) { dist[j]=cur; way[j]=j0; }
                if (dist[j]<delta) { delta=dist[j]; j1=j; }
            }
            for (int j=0; j<=n; ++j) {
                if (used[j]) { u[p[j]]+=delta; v[j]-=delta; }
                else dist[j]-=delta;
            }
            j0=j1;
        } while (p[j0]!=0);
        do { int j1=way[j0]; p[j0]=p[j1]; j0=j1; } while (j0);
    }
    return -v[0];
}

struct Step { double setup_start, start, completion, cost; int pattern; };
inline Step advance(double time, double arrival, double proc, double cost, double empty_cost, double setup) {
    double earliest=std::max(time,arrival);
    double shift=std::floor(earliest/8);
    // For time <= earliest, this tests every crossed/exact shift boundary
    // without a floating-point remainder or a second floor operation.
    if (earliest>=8 && time<=shift*8) cost=empty_cost;
    double duration=cost>0 ? setup:0;
    double end=(shift+1)*8;
    if (earliest+duration+proc>end+1e-10) { earliest=end; cost=empty_cost; duration=cost>0 ? setup:0; }
    if (duration+proc>8+1e-10) return {earliest,earliest,std::numeric_limits<double>::infinity(),cost,0};
    return {earliest,earliest+duration,earliest+duration+proc,cost,0};
}
struct Parameters {
    int evaluations=5000000, starts=4, stage_length=1000;
    double t_max=500, t_min=.001, rcl_alpha=.5;
    double p_inter=.5, p_shift=.5, p_block=.5;
};
struct Cache {
    std::vector<double> time, ink, batches;
    std::vector<int> pattern;
    Cache(int n, int b): time(n+1), ink(n+1), batches((n+1)*b), pattern(n+1) {}
};
struct Problem {
    int n, m, b, patterns;
    double setup, ink_weight, flow_weight;
    std::vector<double> arrivals, batch_arrivals, processing, transitions;
    std::vector<int> job_pattern, job_batch, initial_pattern;
    std::vector<double> initial_time, initial_ink, initial_batches;

    Step step(int machine, int job, double time, int prev) const {
        int next=job_pattern[job];
        double cost=transitions[prev*patterns+next];
        double proc=processing[machine*n+job];
        auto result=advance(time,arrivals[job],proc,cost,transitions[next],setup);
        result.pattern=next; return result;
    }

    void initialize(Cache& c, int machine) const {
        c.time[0]=initial_time[machine]; c.pattern[0]=initial_pattern[machine];
        c.ink[0]=initial_ink[machine];
        std::copy_n(initial_batches.data()+machine*b, b, c.batches.data());
    }
    template<int B>
    void suffix_impl(Cache& out, const Cache& old, const std::vector<int>& jobs, int machine, int first) const {
        const int groups=B ? B:b;
        out.time[first]=old.time[first]; out.pattern[first]=old.pattern[first]; out.ink[first]=old.ink[first];
        std::copy_n(old.batches.data()+first*groups,groups,out.batches.data()+first*groups);
        for (int i=first; i<(int)jobs.size(); ++i) {
            auto s=step(machine,jobs[i],out.time[i],out.pattern[i]);
            out.time[i+1]=s.completion; out.pattern[i+1]=s.pattern; out.ink[i+1]=out.ink[i]+s.cost;
            auto dest=out.batches.data()+(i+1)*groups;
            if constexpr (B==1) {
                // Completion times on one machine are nondecreasing.
                dest[0]=s.completion;
            } else {
                std::copy_n(out.batches.data()+i*groups,groups,dest);
                dest[job_batch[jobs[i]]]=std::max(dest[job_batch[jobs[i]]],s.completion);
            }
        }
    }
    void suffix(Cache& out, const Cache& old, const std::vector<int>& jobs, int machine, int first) const {
        switch (b) {
        case 1: suffix_impl<1>(out,old,jobs,machine,first); break;
        case 2: suffix_impl<2>(out,old,jobs,machine,first); break;
        case 3: suffix_impl<3>(out,old,jobs,machine,first); break;
        default: suffix_impl<0>(out,old,jobs,machine,first);
        }
    }
    double score(const Schedule& seq, const std::vector<Cache>& caches,
                 int m1=-1, const Cache* c1=nullptr, int m2=-1, const Cache* c2=nullptr) const {
        double ink=0, flow=0;
        for (int machine=0; machine<m; ++machine) {
            auto& c=machine==m1 ? *c1 : machine==m2 ? *c2 : caches[machine];
            if (!std::isfinite(c.time[seq[machine].size()])) return std::numeric_limits<double>::infinity();
            ink+=c.ink[seq[machine].size()];
        }
        int batches_seen=0;
        for (int batch=0; batch<b; ++batch) {
            double completion=-1;
            for (int machine=0; machine<m; ++machine) {
                auto& c=machine==m1 ? *c1 : machine==m2 ? *c2 : caches[machine];
                completion=std::max(completion,c.batches[seq[machine].size()*b+batch]);
            }
            if (completion>=0) { flow+=completion-batch_arrivals[batch]; ++batches_seen; }
        }
        return ink_weight*ink+flow_weight*(batches_seen ? flow/batches_seen : 0);
    }
};

struct SearchResult { Schedule schedule; double fitness; int evaluations=0; };
} // namespace flexo
