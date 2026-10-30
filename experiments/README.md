# Experiment playground

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
