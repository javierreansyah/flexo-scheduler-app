# Quality-preserving tuning

## Run in your terminal

```powershell
python experiments/run_tuning.py
```

The runner starts or resumes `results/tuning-10m-100k` in the foreground with
`tqdm` progress bars. Press **Ctrl+C** to stop, then run the same command again
to resume. All normal `flexo tune` options are supported. For a separate run:

```powershell
python experiments/run_tuning.py --workdir results/another-run
```

Install dependencies with `python -m pip install -e ".[tuning]"`. The display
is separate from the engine, so progress-display changes do not invalidate
checkpoints. The older `results/quality-budget-run` is preserved, but its budget
settings are incompatible with this workflow. No campaign is launched for you.

## Exactly two tuning stages

Each size (10, 30, 50, 100 movable jobs) receives its own profile. Starts are
editable/tunable from **1 through 4**, defaulting to four. Each evaluated instance
runs three optimizer seeds. **There is no pilot stage.**

1. **Reference:** every candidate uses exactly **10,000,000 total proposals**,
   shared across its starts. Tune starts, temperatures, stage length, GRASP
   greediness and move probabilities. SMAC races candidates across training
   instances, always running all three seeds for an evaluated instance. Fully
   score the incumbent, up to five leading configurations, baseline and prior
   settings before selecting the reference by mean normalized training fitness.
2. **Efficiency:** jointly retune parameters and starts, choosing total proposals
   from **100,000, 200,000, ..., 10,000,000**. SMAC searches an integer number of
   100k units rather than rounding arbitrary iteration counts afterward. Budgets
   stay exact even with three starts: the core distributes remainder proposals
   across starts. Reject a candidate after any training instance's three-seed
   mean regresses. Choose the smallest feasible budget, breaking ties by fitness.

Finally, evaluate that winner and the reference on every untouched held-out
snapshot using paired seeds 142/143/144. A regression on any instance exports
the full 10m reference instead. Do not test successive candidates against held-out
results after a failure. Report clean/carryover quality and runtime separately.

An instance passes when candidate mean fitness is at most
`reference + 1e-9 * max(1, abs(reference))`. Improvements elsewhere cannot hide a
regression. This is an empirical check over the tested cases and seeds, not a
proof of a globally minimal budget or a guarantee for every future input.

## Settings and cost

- `--reference-calls 1000`: at most 1,000 instance-level SMAC evaluations per size,
  each with three optimizer solves. With 20 training instances this is 50 full
  panels. Baseline and finalist verification are additional work; repeated solves
  reuse the cache.
- `--reduction-trials 100`: at most 100 proposed configurations per size. Rejected
  configurations usually stop before reaching the full training panel.
- Training seeds: `--seeds 42 43 44`. Held-out seeds:
  `--heldout-seeds 142 143 144`. Exactly three distinct seeds per panel, with no
  overlap between training and held-out panels.
- `--threads 0`: parallelize SA starts across available CPUs, at most four workers.
  SMAC trials remain sequential.
- `--stage reference`, `--stage reduce`, or `--stage all` (default). Efficiency-only
  runs require completed reference results in the same work directory.
- `--evaluations N`: explicit uniform reference override for smoke tests; it must
  be a multiple of 100k, at least 100k. Normal runs omit it and use 10m for every
  size. The efficiency grid stops at the overridden reference when supplied.

Shorter SA budgets are rerun with their own cooling schedules; a prefix of a
longer solve is not substituted for an actual shorter run. The ordinary optimizer
API still permits arbitrary budgets for experiments; quantization applies to the
SMAC efficiency search and its exported profiles.

## Save and resume

```powershell
python -m flexo generate smac
python experiments/run_tuning.py
# After Ctrl+C, run the same command again.
```

Resume with the same inputs and settings. A manifest fingerprints the dataset,
optimizer binary, tuning/API source, seed panels and campaign settings. Mismatches
are refused. Rebuilding can change the binary fingerprint even with unchanged
source. Run only one process per work directory.

Each completed instance/seed solve is committed to `solves.sqlite3`. Interruption
loses only unfinished solves. Native SMAC history resumes searches, while
completed `reference.json` and `profile.json` stages are reused. Logs record
reference evaluations and efficiency trials, including partial rejected trials.

All four accepted profiles are atomically published to `flexo/profiles.json`
after completion. Old campaigns and their measurements are retained as history;
changing to the 10m reference and 100k grid starts a new campaign.
