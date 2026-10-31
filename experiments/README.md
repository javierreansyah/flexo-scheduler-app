# Experiment playground

## Runtime benchmark

```powershell
python -m experiments.benchmark --output results/my-benchmark
python -m experiments.benchmark --repeats 3 --output results/my-repeated-benchmark
python -m experiments.benchmark --compare results/five-before/report.json results/five-after/report.json
```

One pass runs **five cases**, not the full validation suite: static 10/50/100
jobs, then 50 jobs with two horizons and 100 jobs with three horizons (rho=1.5,
replica 00). N10 is derived from the first ten orders of N15 static replica 00;
the checked-in instance is unchanged.

The benchmark uses the original tuned `industry.py` SA settings with four starts: **833,333 proposals
per start, four starts** (3,333,332 total proposals per horizon), original cooling,
GRASP and move probabilities. Automatic profiles are bypassed. Four starts run
on up to four CPU workers; no additional parallelism across cases competes with
the starts. Seed defaults to 42. Each output directory must be fresh.

`runs.csv` and `report.json` record wall time, quality metrics, schedule hashes,
native binary hash, input digest, settings and machine information. Comparison
checks compatible inputs/settings and reports schedule equality and speedups.
Timing covers optimization, preparation, and every horizon, excluding input-file
loading and report writing. Repeat passes if small timing differences matter;
the first case can include CPU warm-up effects.

`--repeats 3` measures each of the same five cases three times; it does not expand
the instance collection. Comparisons print per-case median times and check every
recorded schedule hash. Keep seed, parameters, and CPU worker counts unchanged
when comparing builds. For close results, alternate build order across passes.

## Timeline and notebook playground

Run from the repository root. Install optional plotting/notebook dependencies:

```powershell
python -m pip install -e ".[experiments]"
python -m experiments.playground
```

The default is the original 15-order example. The runner automatically detects
single-horizon snapshots versus rolling-horizon validation instances.

```powershell
python -m experiments.playground instances/validation/N30_K3_rho1.5_rep00.json --seeds 42 43 44 --threads 3 --show
python -m experiments.playground instances/smac/heldout/N50_carryover_00.json --evaluations 100000 --starts 3 --output results/carryover
```

`--show` opens the chart window; without it the chart is saved without opening a
window. Outputs default to `results/playground` and are overwritten on another
run there. Use separate `--output` directories to retain experiments.

Outputs: `metrics.csv` (one row per seed), `best.json` (instance path, parameters,
seed, best schedule and horizon trace), `schedule.csv` (individual job timings),
and `timeline.png` / `timeline.svg` (best seed's final schedule).

The timeline retains the original viridis batch colors, order/ink labels,
changeover hatching and arrival/shift lines. Gray intervals show setup; black
outlines identify locked work. Short bars omit labels to keep large instances
readable; all details remain in the schedule CSV. Charts use the optimizer's
actual timestamps without reconstructing scheduling logic.

Metrics include weighted fitness, ink cost, batch flow time, makespan, wall time,
and optimizer time. Validation timing includes all horizons; its chart shows the
final schedule and `best.json` includes per-horizon metrics. Chart rendering and
file writing are excluded from solve timings. Compare speeds with the same
instance, budget, seeds and thread count; the first run may include warm-up costs.

`--parameters file.json` accepts the optimizer parameter object. Explicit budgets
use baseline parameters for unspecified fields. Omit overrides to use automatic
size profiles, or supply `--profiles path/to/profiles.json`.

For notebook exploration, open `experiments/playground.ipynb`. Edit the input,
seed panel and parameters in its first code cell, run the experiment, then display
the chart inline. It runs with an ordinary Python Jupyter kernel.

## Pareto presets and worker throughput

After Pareto tuning exports profiles, select `--preset low`, `medium` (default),
or `high` in the playground. Existing flat profiles use the same parameters for
all three until retuned. Explicit parameters take precedence.

```powershell
python -m experiments.playground --preset low --output results/low-quality
python -m experiments.benchmark_parallel --workers 20 --output results/my-workers
```

The worker benchmark compares serial execution with a bounded pool across the
same five representative cases, three seeds and two repeats (30 tasks in each
mode). It uses the original parameters, including four starts and 833,333
iterations per start. Each task runs its starts serially. It verifies exact
schedule and fitness equality, and saves wall time, CPU time, peak workers and
per-run results. This measures solve throughput; it does not include SMAC model
fitting or claim all logical processors remain busy throughout a campaign.

Notebook calls can use `run(..., preset="low")`; the existing notebook and
original timeline rendering remain compatible. For tuning instructions see
[the tuning guide](../docs/tuning.md).

Measured on the local 20-logical-CPU Windows machine: 30 solves took 33.99s
serially and 4.57s with 20 workers (7.44x throughput), with identical schedules
and scores. This is a single timing comparison, not a universal speedup claim.
The saved local artifact is `results/pareto-worker-benchmark/report.json`.
