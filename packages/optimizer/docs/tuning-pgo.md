# PGO installation and unfinished tuning bottlenecks

The experimental native optimizer now uses the verified MSVC PGO extension. The prepared continuation is results/fixed-budget-tuning-pgo. The original campaign and Pareto cache remain unchanged. No tuning trials were launched.

## Measured benefit

A saved N100/100m configuration was benchmarked on eight clean/carryover snapshots spanning N10/N30/N50/N100, with five seeds and 100 million total proposals per solve. Twenty independent workers each ran starts serially. The final uncontended pair measured **99.035 seconds baseline versus 83.168 seconds PGO**: **1.191x throughput**, or **16.0% less elapsed time**. Early measurements overlapping cache verification were excluded from this comparison. This long-budget confirmation is one clean paired panel; the earlier compiler study supplies additional repeated evidence at five million proposals.

All 60 training fitness samples for a completed N100/100m candidate matched the saved cache exactly. Baseline/PGO schedule hashes also matched in the repeated full-budget panels. Precise floating-point behavior, xoshiro256++, proposal budgets, trial counts, seed panels and configuration order are preserved.

## Bottlenecks in the actual campaign

| Stage | Median panel seconds | Median busy CPUs | Remaining trials |
| --- | ---: | ---: | ---: |
| N100 / 10m | 23.86 | 18.94 | 0 |
| N100 / 20m | 48.34 | 19.17 | 0 |
| N100 / 100m | 227.50 | 19.41 | 393 |

The remaining tier has 9 of 402 trials finished and one interrupted trial recorded as running. Its median inter-trial gap is 0.004 seconds. A profiled read of a complete 60-solve cached panel took 0.069 seconds, with no native solves submitted. This separates cheap cache/Python coordination from expensive native computation. The cache profile does not measure the cost of writing uncached results; the near-full CPU utilization and recorded panel times leave little scope for that overhead to dominate the remaining work.

N10 panels used only about 1.36 CPUs and had appreciable coordination overhead, but that tier is already complete. N30/N50 high-budget panels averaged above 19 busy CPUs and are also complete. No speculative scheduler, SMAC model, cache durability, or search-policy changes were made.

At the historical N100/100m panel rate, the remaining training work is about 24.84 hours. Extrapolating the measured 1.191x benefit gives **20.86 hours**, a potential saving of about four hours, plus final heldout verification. This is an estimate: configurations, sustained CPU frequency and system activity vary.

## Resume and verification

Run from packages/optimizer:

    python experiments/run_tuning.py --check-resume

This validates the binary, source, dataset, settings and cache-source compatibility without submitting trials. To start the long run yourself:

    python experiments/run_tuning.py

The runner selects the prepared continuation automatically. Explicit --workdir remains available. All 216,860 cache rows were verified equal by an ordered key/value digest, and saved per-tier JSON files match the original. Completed tiers remain available and the existing interrupted-trial recovery logic handles unfinished work.

The new build-transition record permits only the verified old/new binary pair and records the original manifest, source fingerprints and verification artifacts. Arbitrary binary/source/settings changes still fail resume checks. Historical solve durations remain historical; transition provenance identifies the new execution build.

## Build and rollback

For a fresh installation, with the source campaign stopped and fresh output directories:

    python experiments/build_pgo.py --source results/fixed-budget-tuning

The script builds in isolation, collects counters, verifies that the linker applied PGO, runs tests and full-budget/cache checks, copies the checkpoint with SQLite backup, then promotes the binary last. --use-build can reuse an isolated PGO package only after native-source and profile-application checks. Ordinary recompilation invalidates the verified binary identity; do not bypass resume guards.

To restore the saved binary while retaining the prepared checkpoint and updating its binary identity:

    python experiments/build_pgo.py --rollback

To inspect progress without running solves:

    python experiments/tuning_bottlenecks.py results/fixed-budget-tuning-pgo

Raw verification logs, rollback binary and profiling output are in results/pgo-install (ignored). [Compact measurements](tuning-pgo-measurements.json) are checked in. The original compiler/RNG study remains in [compiler-rng-benchmark.md](compiler-rng-benchmark.md).

## Validation

**57 tests passed** on the installed PGO build. It is covered by the optimizer suite and regressions for explicit proposal budgets, verified resume transitions, strict rejection of incompatible changes, and default checkpoint selection. The actual prepared checkpoint passed --check-resume; its SMAC history still reports 9 finished and one running trial.
