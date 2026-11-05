
#include <emscripten.h>
#include <emscripten/bind.h>
EM_JS(void, flexo_progress, (int it, int total), {
  if (!self.lastProgress || performance.now() - self.lastProgress > 100) {
    self.lastProgress = performance.now();
    self.postMessage({progress : it / total});
  }
});
#include "src/solver.h"
using namespace emscripten;
using namespace flexo;
template <class T> std::vector<T> vec(val v) {
  std::vector<T> a;
  for (unsigned i = 0; i < v["length"].as<unsigned>(); i++)
    a.push_back(v[i].as<T>());
  return a;
}
val arr(const std::vector<double> &a) {
  val r = val::array();
  for (auto x : a)
    r.call<void>("push", x);
  return r;
}
Problem problem(val d) {
  Problem p;
  p.arrivals = vec<double>(d["arrivals"]);
  p.n = p.arrivals.size();
  p.batch_arrivals = vec<double>(d["batch_arrivals"]);
  p.b = p.batch_arrivals.size();
  p.initial_time = vec<double>(d["initial_time"]);
  p.m = p.initial_time.size();
  p.patterns = d["patterns"].as<int>();
  p.setup = d["setup"].as<double>();
  p.ink_weight = d["ink_weight"].as<double>();
  p.flow_weight = d["flow_weight"].as<double>();
  p.processing = vec<double>(d["processing"]);
  p.transitions = vec<double>(d["transitions"]);
  p.durations = vec<double>(d["durations"]);
  p.job_pattern = vec<int>(d["job_pattern"]);
  p.job_batch = vec<int>(d["job_batch"]);
  p.initial_pattern = vec<int>(d["initial_pattern"]);
  p.initial_ink = vec<double>(d["initial_ink"]);
  p.initial_batches = vec<double>(d["initial_batches"]);
  return p;
}
val run(val data, val config, unsigned seed) {
  auto p = problem(data);
  Parameters par;
  par.evaluations = config["evaluations"].as<int>();
  par.starts = 1;
  par.stage_length = config["stage_length"].as<int>();
  par.t_max = config["t_max"].as<double>();
  par.t_min = config["t_min"].as<double>();
  par.rcl_alpha = config["rcl_alpha"].as<double>();
  par.p_inter = config["p_inter"].as<double>();
  par.p_shift = config["p_shift"].as<double>();
  par.p_block = config["p_block"].as<double>();
  auto result = search(p, par, seed, par.evaluations, false);
  val out = val::object(), lanes = val::array();
  std::vector<Cache> caches;
  double ink = 0, flow = 0, end = 0;
  for (int m = 0; m < p.m; m++) {
    caches.emplace_back(p.n, p.b);
    auto &c = caches.back();
    p.initialize(c, m);
    p.suffix(c, c, result.schedule[m], m, 0);
    val lane = val::array();
    double t = p.initial_time[m];
    int pat = p.initial_pattern[m];
    for (int j : result.schedule[m]) {
      auto s = p.step(m, j, t, pat);
      val e = val::object();
      e.set("job", j);
      e.set("setup_start", s.setup_start);
      e.set("start", s.start);
      e.set("completion", s.completion);
      e.set("ink_change_cost", s.cost);
      lane.call<void>("push", e);
      t = s.completion;
      pat = s.pattern;
    }
    ink += c.ink[result.schedule[m].size()];
    lanes.call<void>("push", lane);
  }
  for (int b = 0; b < p.b; b++) {
    double done = -1;
    for (int m = 0; m < p.m; m++)
      done = std::max(done,
                      caches[m].batches[result.schedule[m].size() * p.b + b]);
    flow += done - p.batch_arrivals[b];
    end = std::max(end, done);
  }
  out.set("schedule", lanes);
  out.set("fitness", result.fitness);
  out.set("ink_changes", ink);
  out.set("batch_flow_time", p.b ? flow / p.b : 0);
  out.set("makespan", end);
  return out;
}
EMSCRIPTEN_BINDINGS(flexo) {
  function("run", &run);
  function(
      "seeds", +[](std::string seed, int count) {
        Xoshiro256pp rng(std::stoull(seed));
        val a = val::array();
        for (int i = 0; i < count; i++)
          a.call<void>("push", static_cast<uint32_t>(rng()));
        return a;
      });
  function(
      "changeover", +[](val a, val b, val costs) {
        std::vector<std::vector<double>> c;
        for (unsigned i = 0; i < costs["length"].as<unsigned>(); i++)
          c.push_back(vec<double>(costs[i]));
        return changeover(vec<int>(a), vec<int>(b), c);
      });
  function(
      "step", +[](double t, double a, double p, double c, double e, double d,
                  double ed) {
        auto s = advance(t, a, p, c, e, d, ed);
        return arr({s.setup_start, s.start, s.completion, s.cost});
      });
}
