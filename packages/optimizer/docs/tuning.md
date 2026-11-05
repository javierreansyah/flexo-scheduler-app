# Fixed-budget preset tuning

From `packages/optimizer`, run `python experiments/run_tuning.py` in your terminal.
The play button (Run Python File in Terminal) works with no arguments. The runner
defaults to fixed-budget mode, all logical CPU workers and three independent
training seeds per instance. It does not start during installation.

| Jobs | Quick / low | Balanced / medium | High |
| ---: | ---: | ---: | ---: |
| 10 | 100k | 100k | 100k |
| 30 | 600k | 10m | 100m |
| 50 | 3m | 20m | 100m |
| 100 | 10m | 20m | 100m |

Budgets are total proposals shared across starts. SMAC minimizes normalized
training fitness separately at each budget, tuning all other SA parameters,
including 1-20 starts. The budget is a ConfigSpace constant, so the optimizer
cannot spend extra proposals to improve its objective. Equal budgets at the same
size share one search; this makes ten searches rather than twelve.

Default allowance is **400 additional trials per distinct size/budget**, beyond
exact-budget imported observations. This can cost more overall than the previous
400-trial-per-size multiobjective search, especially for the 100m tiers. N10 also
gets one focused search; it is not run three times. Configure `--trials` before
starting. Resume checks reject changed settings or optimizer builds.

## Reuse, progress and outputs

The runner automatically uses `results/pareto-tuning-100m-20starts` when available.
It checks matching native binary, dataset, and seed panels. Exact-budget candidate
scores initialize SMAC's model without consuming the additional trial allowance.
Strong and nearby-budget parameters provide warm proposals; their budgets are
changed and their old scores are never reused at those different budgets.

Each solve first checks the new SQLite cache, then the previous campaign cache
opened read-only. A key includes the exact snapshot, parameters (including total
proposals and starts), and seed. Exact hits avoid SA entirely. Misses add only
indexed lookups; source-cache reuse does not change search quality. A different
cooling trajectory or parameter value must be computed. Previous results are not
copied or modified. Do not delete/move the source while using it for resume.

The terminal shows size/budget, completed/imported configurations, panel progress,
cache hits and active workers. Ctrl+C cancels queued tasks, waits for active
native tasks, and saves completed solves. Restarting the same file resumes,
including a trial interrupted before SMAC received its score.

```powershell
python experiments/run_tuning.py --trials 400 --workers 20
python experiments/run_tuning.py --workdir results/my-fixed-run --reuse-from results/pareto-tuning-100m-20starts
python -m flexo tune-fixed --workdir results/my-fixed-run --reuse-from results/pareto-tuning-100m-20starts
```

The module CLI requires `--resume` on subsequent invocations; the foreground
runner adds it automatically. It also auto-detects the previous campaign, whereas
the module CLI uses only explicitly supplied `--reuse-from`.

Outputs default to `results/fixed-budget-tuning`: manifest, local solve cache,
`N<size>/budget-<proposals>/` candidates/SMAC checkpoints/winner, per-size profiles,
and final `profiles.json`. Existing native and browser application profiles stay
unchanged unless `--output` explicitly targets them. The export remains readable
by `select_parameters` and the app build. Its `frontier` retains all preset points
for ID lookup; `pareto_frontier` contains the actual nondominated subset.
The browser build uses the completed winners in `docs/fixed-budget-summary.json`
for its presets. Browser validation and workers support up to twenty starts,
matching the tuning campaign.

Training chooses winners; heldout seeds 142/143/144 only measure selected winners.
The exported validation records include overall, clean and carryover gaps to
high. There are **no quality-gate fallbacks**: these are compute tiers. A cheaper
tier may beat a more expensive one on sampled data; gaps can be negative. This
is reported, not used to search/reselect on heldout. Repeated use of this heldout
set is exploratory; reserve new instances for final acceptance.

## Legacy cost / quality Pareto tuning

Install and rebuild before starting a new campaign:

```powershell
python -m pip install -e ".[tuning]"
python -m flexo generate smac
python experiments/run_tuning.py --mode pareto --workers 20
```

The foreground runner shows job sizes, completed configurations, and panel solves
with cached/computed counts and active workers. It starts or automatically resumes
`results/pareto-tuning-100m-20starts`. If the original `results/pareto-tuning`
exists, its completed observations and solve cache are imported automatically.
The source directory is kept unchanged. Press **Ctrl+C** to cancel queued tasks, wait for active
native solves to finish and save them, then rerun the same command to resume.
Use `--workdir results/my-pareto-run` for a separate campaign. A full campaign is
never launched by installation or tests.

## One campaign per job size

Each size (10, 30, 50, 100 movable jobs) gets one SMAC **ParEGO** multiobjective
campaign. There are no reference/reduction stages. Each candidate jointly tunes:

- Total proposals: **100,000 through 100,000,000**, in exact **100,000** steps.
- Starts: **1 through 20** (ordinary API default remains four).
- Initial/final temperatures, cooling stage length, GRASP greediness, and
  inter-machine, insertion/swap, and block move probabilities.

`evaluations` is the **total** proposal budget across starts, equivalent to
starts times iterations per start, with remainder proposals distributed exactly.
It is never multiplied by starts again. Starts execute serially within each
tuning task. Shorter budgets use their own cooling schedule, not a prefix of a
longer run. The ordinary optimizer still permits arbitrary proposal counts.

Two objectives are minimized: normalized fitness and total proposals. Per-instance
mean fitness across three seeds is divided by that instance's fixed baseline
mean, then averaged equally over training instances. The baseline uses the prior
SA parameters, four starts and 100k proposals; it supplies normalization, not a
quality gate. SMAC receives proposal cost scaled by the configured maximum.
Raw fitness, clean/carryover means, three seed-panel means and their standard
deviation are recorded too.

Defaults are **400 additional trials per size** when importing an earlier campaign
(800 total observations when importing 400), or 400 for a fresh campaign, each fully evaluated on
20 training snapshots (10 clean, 10 carryover) and seeds **42/43/44**. That is up
to 24,000 training solves per size, plus normalization and heldout verification;
cached repeats are free. Existing profiles supply warm-start configurations,
which are measured afresh. Their old scores are never imported. Initial design
also includes the prior 100k and maximum-budget settings when the trial allowance
permits. Imported candidates are supplied to the new SMAC model as observations,
with proposal costs rescaled to the new maximum. They do not consume the additional
trial allowance. Pareto points are recomputed from all completed candidate panels rather
than relying only on SMAC's final incumbent list.

For an explicit import, use a new directory:

```powershell
python experiments/run_tuning.py --mode pareto --workdir results/expanded --reuse-from results/pareto-tuning --trials 400
```

Imports require identical datasets, seed panels, normalization steps, and quality
tolerances. Before copying the SQLite cache, the current solver recomputes every
training baseline solve and short/long frontier samples for each size. A fitness
mismatch rejects reuse. These checks provide regression evidence across native
rebuilds, not a proof of equivalence for every cached trajectory. Exact repeated
snapshot/parameter/seed keys then hit the cache; different budgets are new solves,
because they use different cooling schedules. The old SMAC checkpoint itself is
not resumed across a changed search space. New checkpoints resume normally.

## Presets and heldout verification

The training frontier contains candidates where improving fitness requires more
proposals. Select presets relative to the best observed training quality:

| Preset | Selection |
| --- | --- |
| high | Best normalized fitness; cheaper wins quality ties |
| medium | Cheapest point within 0.5% of high |
| low | Cheapest point within 2% of high |

The medium/low limits must hold for the overall mean **and separately for clean
and carryover means**. Presets may share a configuration when no cheaper point
qualifies. These are empirical quality tolerances, not confidence bounds or a
proof that the search found the global optimum.

Only the unique selected configurations and normalization baseline are evaluated
on untouched heldout snapshots with seeds **142/143/144**. If low or medium fails
its corresponding overall or case-type limit against high on that panel, it maps
to high. No replacement search uses heldout scores. Three distinct seeds are
required for each panel, with no overlap; five-seed evaluation is not enabled.

After all sizes finish, `flexo/profiles.json` is atomically replaced. Selection
uses the nearest movable-job count, larger on ties, clamping outside the range.
Legacy flat profiles remain readable and give identical settings for all presets
until a new campaign exports presets. Explicit parameters override profiles.

```powershell
python -m flexo solve flexo/example.json --preset low --output results/schedule.json
python -m flexo validate instances/validation/N100_K3_rho1.5_rep00.json --preset high --output results/validation.json
python -m experiments.playground --preset medium
```

Python callers use `optimize(snapshot, preset="low")` or
`run_validation(instance, preset="high")`. Playground notebooks can call
`experiments.playground.run(..., preset="medium")`; existing calls still work.

## CPU scheduling and saved files

`--workers 0` (default) uses the available logical CPU count. One shared bounded
thread pool schedules independent instance/seed solves as workers become free.
Native SA releases the Python GIL; every task uses `num_threads=1` to avoid
nested start pools. Only the coordinator reads/writes SQLite and aggregates
results. With the normal dataset, each candidate supplies 60 independent tasks.
SMAC chooses the next candidate sequentially: fitting its model, short panels,
cached panels, and the final tail can leave CPUs idle. Twenty logical processors
also do not imply a 20x throughput improvement.

The work directory contains a manifest, `solves.sqlite3`, SMAC checkpoints, and
per-size `candidates/*.json`, `profile.json`, plus `frontier.json`, `.csv`, `.png`
and `.svg`. Charts show the training frontier and final preset mappings; the
profile includes heldout measurements and fallback reasons.

Resume requires the same dataset, optimizer binary, tuning/API source, settings
and seed panels. Rebuilding may change the binary fingerprint. Old two-stage
work directories are incompatible and remain untouched. Only one process may
write a work directory. Completed solves survive interruptions, including those
that finish while stopping; unfinished or failed solves are rerun. Workers may
need time to finish long active solves after Ctrl+C.

For a small integration run in separate directories:

```powershell
python -m flexo generate smac --replicas 1 --previous-evaluations 100 --directory tmp/smac
python experiments/run_tuning.py --mode pareto --directory tmp/smac --trials 4 --max-evaluations 200000 --workers 4 --workdir tmp/pareto-check --output tmp/pareto-profiles.json
```

Smoke profiles verify integration, not production quality. For the five-case
serial/parallel throughput comparison, run
`python -m experiments.benchmark_parallel --workers 20 --output results/my-workers`.
It retains the original four-start, 833,333-proposal-per-start parameters,
compares exact schedules/scores and saves wall/CPU times.

See [the completed old campaign report](completed-tuning-report.md) for the
results that motivated replacing the strict two-stage budget gate.
