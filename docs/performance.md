# Refactoring measurements

Measured on the same Windows host on 2026-10-31 against the installed original
extension, whose source was captured in commit `81fb1fc`. Each variant solved the
same static workload using seeds 42–71, 60,000 proposals, three starts, one thread,
T=500 to 0.001, 1,000 proposals per temperature, GRASP alpha=0.5, and all three
move probabilities=0.5. Run order alternated. Timings include input preparation
and construction, and report the median of 30 runs.

| Jobs | Original ms | Refactored ms | Speedup | Original mean fitness | Refactored mean fitness |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 10 | 6.04 | 5.97 | 1.01x | 3.02375 | 3.01937 |
| 30 | 15.26 | 13.34 | 1.14x | 8.71149 | 8.74476 |
| 50 | 29.81 | 20.57 | 1.45x | 14.69245 | 14.69128 |
| 100 | 91.29 | 37.98 | 2.40x | 33.07419 | 33.04811 |

Fitness is lower-is-better. Original schedules were independently rescored with
the new evaluator; their reported scores agreed. Unretuned mean quality differs
by at most 0.39% in this sample. Incremental arithmetic and corrected state
handling can change seeded search paths; schedules are not promised to match
the old implementation bit for bit.

These are four representative static workloads, not a broad quality study or a
guarantee for every instance. N10 uses the first ten jobs of the original N15
static replica 00; N30/N50/N100 use their static replica 00. Larger gains include
removing the repeated full-schedule GRASP scoring. Full-budget SMAC calibration
and broader performance evaluation remain separate commands.
