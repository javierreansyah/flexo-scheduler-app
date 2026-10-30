# Flexo scheduling

For timeline charts, metrics, and repeatable timing runs, see
[the experiment playground](experiments/README.md).

C++17 simulated annealing, a Python API, single-horizon SMAC tuning, and
rolling-horizon validation. Website and WebAssembly integration are deferred.

## Build and run

Requires Python 3.10+ and a C++17 compiler (Visual Studio C++ tools on Windows).

```powershell
python -m pip install -e ".[tuning,test]"
python -m pytest -q
python -m flexo solve flexo/example.json --output results/schedule.json
```

Rebuild C++ edits with `python setup.py build_ext --inplace`. Header dependencies
are tracked. Release flags are portable and retain compiler safety checks.

```python
import json
from flexo import optimize, evaluate, prepare

snapshot = json.load(open("flexo/example.json"))
result = optimize(snapshot, seed=42, num_threads=3)
assert evaluate(snapshot, result["schedule"])["fitness"] == result["fitness"]

# Reuse native data for multiple configurations/seeds.
problem = prepare(snapshot)
result = optimize(problem, {"evaluations": 100_000, "starts": 3}, seed=43)
```

`num_threads=0` bounds workers by starts and available CPUs. Results are stable
across thread counts. Search releases the GIL and returns assignments, setup and
production timestamps, objective components, parameters, selected profile,
proposal count, native runtime, and total runtime.

## Snapshot input

```json
{
  "now": 0,
  "machines": {"Flexo A": 112, "Flexo B": 224, "Flexo C": 175},
  "jobs": [
    {"id": "order-1", "quantity": 16539, "inks": [6, 8], "arrival_time": 0}
  ],
  "setup_time": 0.75,
  "ink_weight": 0.4,
  "batch_flow_time_weight": 0.6
}
```

Rates are pieces/minute; timestamps and setup durations are production hours.
The clock has consecutive eight-hour shifts without overnight downtime. Jobs
remain whole: defer work that cannot fit in the remaining shift to the next one.
Exclude assignments that cannot fit in a fresh shift; reject a job by id when no
machine is feasible. Shift-end cleaning resets inks without objective cost.

Only arrivals at or before `now` are accepted. Movable work cannot start before
`now`; original arrivals remain unchanged for scoring. Equal arrivals define a
batch. Score all visible batches and fixed contributions using:

`ink_weight * total_ink_change_cost + batch_flow_time_weight * mean(batch_completion - batch_arrival)`

Ink order is irrelevant, while duplicates count. Retain common inks and find the
cheapest matching of the remaining inks. Default directed costs reproduce the old
behavior: downward replacement 1, upward replacement 0, removal 1, addition 0.
Optional `ink_costs` uses string ink ids and `"empty"` for additions/removals:

```json
{
  "empty": {"empty": 0, "1": 0, "6": 0},
  "1":     {"empty": 1, "1": 0, "6": 0},
  "6":     {"empty": 1, "1": 1, "6": 0}
}
```

Cover every ink used in jobs and machine states. Costs must be finite,
nonnegative, with zero diagonals. Pattern transitions are precomputed once.
Positive total transition cost triggers one static `setup_time` (default 0.75
hours): cleaning happens in parallel. Per-transition durations are omitted.

Carryover adds `locked: {machine: [job_entries...]}` for the prefix whose setup
or production started at or before `now`. Entries reference jobs in `jobs` and
provide `id`, `setup_start`, `start`, and `completion`. Previous optimizer output
entries work directly. Completed prefix jobs remain for objective accounting.
Unstarted previous jobs remain in `jobs` without being locked and may move.

Optional `machine_states: {machine: {available_time: 0, inks: []}}` describes each
machine **before** the locked prefix; defaults are empty machines at time zero.
Locked timestamps are checked and preserved. Generation and validation build
these inputs automatically.

`evaluate(snapshot, schedule)` accepts machine lists of movable ids or output
entries after the unchanged locked prefix, then recomputes movable timings and
metrics. Missing, repeated, unknown, and infeasible assignments are rejected.

## Instance collections

**SMAC:** frozen snapshots with exactly 10/30/50 movable jobs and three machines.
Each size mixes clean-start and carryover cases equally. Carryover solves one
previous horizon with fixed baseline parameters, advances time, freezes started
work, and adds current arrivals. Tuning candidates never rebuild this state or
observe later arrivals.

```powershell
python -m flexo generate smac
```

Defaults produce 120 JSONs in `instances/smac`: ten replicas per size, case type,
and split (`train`/`heldout`). Seeds are independent and reproducible. Prior solves
use 50,000 proposals. Generated SMAC files are ignored by Git. Options include
`--replicas`, `--seed`, `--previous-evaluations`, `--directory`, and `--template`.
The packaged example supplies the default order templates and machine rates.

**Validation:** all 200 original instances are preserved unchanged under
`instances/validation`: 15/30/50/100 jobs, static/K2/K3 arrivals, rho 1/1.5, ten
replicas. N200 variants are removed. Validation replays arrivals, optimizes only
visible work, freezes started jobs, and returns a per-horizon trace.

```powershell
python -m flexo validate instances/validation/N100_K3_rho1.5_rep00.json --output results/validation.json
```

The runner rejects more than 100 jobs. `python -m flexo generate validation`
generates the same scenario families/distributions through 100 jobs, using Python
random rather than reproducing the original NumPy seed sequence. Supply another
`--directory` to retain the checked-in originals when generating new replicas.

## Tune and select parameters by size

```powershell
python -m flexo tune --threads 3
```

Independent campaigns tune 10/30/50 **movable** jobs. Defaults are 200 trials per
size, optimizer seeds 42 through 71, and five million search proposals per solve,
distributed exactly across starts. Construction is extra work included in runtime.
No-op/infeasible proposals consume budget, matching the old iteration convention.

Tune starts, temperatures, stage length, GRASP greediness, and inter-machine,
shift, and block probabilities. A temperature ratio enforces valid cooling.
Every target scores the same frozen training panel, normalized by a fixed
per-instance baseline. Zero baselines use denominator `1e-12`. Held-out data is
evaluated only after incumbent selection.

History and reports go to `results/tuning`; existing campaigns are refused, so
choose another `--workdir` for a new run. Successful completion atomically exports
all profiles to `flexo/profiles.json`, including dataset hash, budgets, seeds,
parameters, and held-out metrics by case type.

`optimize()` loads that file from the working directory (or a packaged profile
file if absent) automatically and selects the nearest movable-job
count, choosing the larger profile on ties and clamping outside the range.
Absent profiles use baseline settings; explicit parameters override selection.
Use `profiles="path/to/profiles.json"` or CLI `--profiles` for another export.

A full campaign is substantial. A quick integration check is:

```powershell
python -m flexo generate smac --replicas 1 --previous-evaluations 2000 --directory tmp/smac
python -m flexo tune --directory tmp/smac --trials 3 --evaluations 1500 --seeds 42 --threads 1 --workdir tmp/tuning --output tmp/profiles.json
python -m flexo solve tmp/smac/heldout/N30_carryover_00.json --profiles tmp/profiles.json --output tmp/solved.json
```

Smoke profiles verify integration and are not production-calibrated profiles.

## Design and verification

Retained: direct machine lists, GRASP construction, geometric cooling, and
single/block insertion and swap moves within/between machines. Immutable tables
are shared across starts. Construction scores appends incrementally; search
replays only affected suffixes. Workspaces are independent and hash-only cache
keys are gone.

Rolim and Nagano's 2025 paper, *Designing state-of-the-art metaheuristics: What
have we learned from the parallel-machine scheduling problem with setups?*
(DOI `10.1016/j.cor.2025.107110`), supports simple SA, complete representations,
diverse neighborhoods, and accelerated evaluation. Its makespan delta formulas
and critical-machine pruning do not directly apply to batch flow time with shift
resets. The PDF and research artifacts were removed after review.

Tests cover exhaustive ink matching, every move family, suffix/full-score
agreement and undo, threading, budgets, frozen prefixes, shift boundaries,
infeasible jobs, profiles, isolated datasets, validation, and SMAC smoke campaigns.
`optimize(..., debug=True)` checks proposals and rejected undos against full
evaluation. The first Git commit preserves the old optimizer and input data.

Full production-length tuning and cross-platform execution are not claimed by
the smoke tests. No website, CP-SAT, dispatch, ablation, or paper tooling remains.
