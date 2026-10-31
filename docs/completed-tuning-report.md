# Completed tuning run: 10m reference and constrained budget reduction

The completed campaign used 20 training and 20 held-out snapshots per size, three paired seeds per instance, and 1-4 starts. Each size had a 10m-proposal reference, 1,000 reference instance evaluations, and 100 efficiency trials. Lower fitness is better.

| Movable jobs | Selected proposals | Reduction | Held-out mean fitness | Passing efficiency trials |
| ---: | ---: | ---: | ---: | ---: |
| 10 | 1,700,000 | 83% | 3.45328 | 44/100 |
| 30 | 10,000,000 | 0% | 7.32456 | 1/100 |
| 50 | 10,000,000 | 0% | 12.00200 | 1/100 |
| 100 | 10,000,000 | 0% | 24.54357 | 1/100 |

N10 retained matching held-out mean fitness while reducing proposals by 83%. Summed measured held-out solve time fell from 13.32s to 3.42s (about 3.9x faster). Proposal savings and measured wall time are distinct: start counts and execution overhead also affect timing.

N30/N50/N100 retained the reference. Their strict per-instance gate rejected almost every efficiency candidate; early-rejected trials were not fully evaluated. These results do **not** establish that smaller budgets cannot provide useful tradeoffs or that 10m is optimal. They motivate measuring a Pareto frontier instead of treating every regression as disqualifying.

Only three seeds were tested. Matching these empirical means is not a guarantee for future instances. Original measurements remain in `results/tuning-10m-100k`; the exported legacy profiles are preserved.
