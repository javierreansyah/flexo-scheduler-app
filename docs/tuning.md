# Quality-preserving tuning

Each size (10, 30, 50, 100 movable jobs) receives its own profile. Starts are tuned
from 1 to 4. All reference candidates share the same total proposal budget for
fairness, regardless of start count. Every evaluated instance runs three paired
optimizer seeds; this does not mean three independent SMAC campaigns.

## Stages

1. **Pilot:** use the prior tuned parameters, four starts, and two clean plus two
   carryover training snapshots. Test fractions/multiples of 400k/1m/4m/8m totals
   for N10/N30/N50/N100, capped at the reference. Retain a high-budget comparison.
   Pilot results guide starting points and never exclude a lower budget from
   subsequent joint tuning.
2. **Reference:** fix total proposals at 5m/5m/5m/8m and tune SA parameters and
   starts. SMAC's algorithm-configuration intensifier races candidates across
   instances, evaluating all three seeds whenever it evaluates an instance.
   Fully score the incumbent, up to five leading configurations, the baseline,
   and prior tuned settings before choosing the reference by mean normalized
   fitness across the complete training panel.
3. **Reduction:** jointly tune SA parameters, starts, and positive proposal
   budgets. Round budgets to at least one SA proposal per start and an integer
   number of proposals per start. Preserve the exact full-budget reference as a
   fallback even if rounding its budget would change it. Stop testing a candidate
   after its three-seed mean fails any training instance. Choose the lowest
   feasible total budget, breaking ties by normalized training fitness.
4. **Held-out acceptance:** evaluate only that winner and the reference on every
   held-out snapshot with independent paired seeds 142/143/144. Any per-instance
   regression exports the reference. Do not try more candidates against held-out
   data after a failure. Report case-type quality and runtime separately.

A candidate passes an instance when its mean fitness is at most
`reference + 1e-9 * max(1, abs(reference))`. Aggregate improvements cannot hide
another instance's regression. This is an empirical check over the specified
instances and seeds; it does not prove a global minimum budget or guarantee
future performance. Shorter budgets are actually rerun because their cooling
schedules differ; prefixes of a long run aren't substituted for shorter solves.

## Budget and controls

Defaults per size:

- `--reference-calls 1000`: at most 1,000 SMAC instance-level evaluations, each
  costing three optimizer solves. With 20 training snapshots, this is 50 full-panel
  equivalents. Baseline, pilot, and finalist verification are additional work;
  exact repeated solves come from the cache.
- `--reduction-trials 100`: at most 100 proposed parameter/budget configurations.
  Rejected configurations usually stop before reaching the full panel.
- `--seeds 42 43 44` and `--heldout-seeds 142 143 144`: exactly three unique seeds
  per panel, with no overlap between panels.
- `--threads 0`: SA starts use up to four workers; trials remain sequential.
- `--evaluations N`: optional uniform reference-budget override, minimum four,
  intended primarily for tests. Normal budgets vary by size.

`--stage pilot`, `--stage reference`, `--stage reduce`, or `--stage all` select the
work. Reference includes any missing pilots; reduction requires existing reference
results. Default `all` runs all stages per size. Separate pilot execution can
inspect all job sizes before committing to the longer campaigns.

## Persistence and resuming

```powershell
python -m flexo generate smac
python -u -m flexo tune --workdir results/my-tuning
# After stopping the process:
python -u -m flexo tune --resume --workdir results/my-tuning
```

Use exactly the same settings on resume. The manifest fingerprints input files,
native binary, Python tuning/API source, seed panels, and campaign settings. A
mismatch is refused rather than silently mixing measurements. Completing a
rebuild may change the binary fingerprint even if source code is unchanged.

`solves.sqlite3` commits each complete per-instance/per-seed measurement. Crashing
mid-panel loses only unfinished solves; completed solves are cached. SMAC's own
run history resumes unfinished searches, and completed `pilot.json`,
`reference.json`, and `profile.json` stages are reused. Only one process should
write a campaign directory at a time.

Logs in each size directory record instance reference evaluations and reduction
trials, including partial rejected candidates. All four verified profiles are
published together to `flexo/profiles.json` on completion. Old campaigns aren't
compatible with this workflow; keep them as historical results and start a new
work directory.
