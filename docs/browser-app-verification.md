# Browser app verification

The original optimizer project is preserved in `packages/optimizer`, including all results and instance collections. The existing notebook edits remain separate from the migration commit. The completed tuning profiles are versioned as the browser preset source; the compact app projection repairs N30 Quick/ Balanced cost ordering without altering raw campaign results.

## Checked locally

- Native suite: 46 tests passed, including new directed setup durations, fresh-shift reset behavior and locked timestamps.
- Project model: five tests for persistence formats, generation, presets and time advancement.
- Browser suite: Chromium, Firefox and WebKit exercise the real WASM engine, clean/carryover/custom transitions, a 150-job run, deterministic repeat runs, scheduling history, reload recovery, cancellation, mobile sizing, clipboard paste and ink editing.
- Static Next.js production export succeeds. WASM and worker assets have content-based version paths and immutable caching headers.
- The five original-parameter native benchmark schedules have identical hashes to the prior benchmark. One timing pass was 1.707s versus 1.665s previously, a 2.6% difference; this is too small a sample to establish a speed regression.

## Browser timing sample

Chromium, same five representative cases, original four starts and 833,333 proposals per start, seed 42. Timings include worker startup and all rolling horizons:

| Case | Browser wall time | Browser fitness | Native fitness |
| --- | ---: | ---: | ---: |
| Static 10 jobs | 0.225s | 3.014554 | 3.014554 |
| Static 50 jobs | 0.365s | 12.024571 | 12.024571 |
| Static 100 jobs | 0.511s | 23.512229 | 23.512229 |
| 50 jobs / two horizons | 0.582s | 8.204553 | 8.204553 |
| 100 jobs / three horizons | 1.016s | 11.036277 | 10.919512 |

Every browser horizon was independently rescored using the native evaluator, including fixed prefixes. The final case differs by approximately 1.07% in quality. Cross-compiler stochastic paths are not guaranteed identical; the experiment does not establish the exact source of the divergence. Native-calibrated preset quality is not a browser-specific performance guarantee.

Reproduce with `pnpm build`, install Playwright Chromium, then `pnpm benchmark:browser`. The script starts its own local static server, generates native references, runs the five cases and verifies browser scores. The detailed report is saved under `packages/optimizer/results/browser-benchmark`.

No production deployment or new tuning campaign was run. Fresh browser-side quality validation on more diverse inputs remains appropriate before a public quality claim. Older SMAC campaigns remain archived; native/source changes invalidate their resume manifests, so future tuning should use a new work directory.
