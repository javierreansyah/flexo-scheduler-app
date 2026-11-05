# Browser optimizer compilation

The app now builds the shared C++ solver with `-O3 -flto -fwasm-exceptions` using the pinned Emscripten 6.0.13 SDK. The verified app asset is `44ca0d78c0646700`. Search parameters, RNG, proposal counts and objective arithmetic are unchanged. No fast math is enabled.

The previous shipped WASM, `dac50b62282a2711`, was byte-identical to a fresh baseline WASM build from the current sources. It was missing compiler optimizations rather than solver source updates.

## Measurements

Chromium 156 on the same Windows host as the installed MSVC PGO extension. Eight heldout snapshots cover N10/N30/N50/N100 and clean/carryover state, with seeds 142–144. Each solve uses one million proposals, one start and one worker/thread. Three rounds alternate variant order. The table gives the median total time for a 24-solve panel; it excludes worker startup and message transfer. Native timing includes C++ result formatting; WASM timing includes conversion through Embind and result formatting.

| Variant                          | Panel seconds | Speedup over shipped | WASM bytes |
| -------------------------------- | ------------: | -------------------: | ---------: |
| Shipped                          |         7.991 |               1.000x |     92,058 |
| Fresh baseline                   |         8.003 |               0.999x |     92,058 |
| LTO                              |         7.037 |               1.136x |     85,791 |
| WASM exceptions                  |         6.945 |               1.151x |     75,436 |
| LTO + WASM exceptions (selected) |         6.661 |               1.200x |     74,008 |
| LTO + WASM exceptions + SIMD     |         6.793 |               1.176x |     75,140 |
| Installed native MSVC PGO        |         4.568 |                    — |          — |

The selected build reduces solver time by **16.6%** and WASM size by **19.6%**. Its panel time is **1.46x native PGO**, versus 1.75x previously. Native timings were collected separately, not interleaved with browser timings, so this is an approximate cross-runtime comparison. CPU frequency, thermal state and system activity affect results.

A separate single panel through the actual app worker, creating a fresh worker per solve, took 8.270 seconds shipped and 7.166 seconds selected (13.4% less time). This includes worker startup, snapshot preparation, serialization and result transfer, with browser download/compiled-code caches already warm. It does not measure a first visit over a real network or the UI's multistart concurrency.

All **432** timed kernel results and **72** app-worker results passed independent native rescoring. All six WASM variants produced identical schedules for each seed, including all repeated rounds. Native and WASM schedules matched for 23 of 24 distinct heldout solves. N100 clean, seed 143, already differs between baseline WASM and native (fitness 22.374514 versus 22.255714); the compiler changes preserve the existing WASM result exactly. Cross-platform math is not guaranteed to preserve every seeded search path.

[Compact measurements](wasm-performance-measurements.json) include raw panel times, binary hashes and profile samples. The native hash matches the verified PGO binary in [tuning-pgo-measurements.json](tuning-pgo-measurements.json).

## PGO status

The benchmark builds instrumented WASM, runs separate training snapshots (replica 00, seeds 42–43, 100,000 proposals), and exports actual counters from memory without adding a browser filesystem. Evaluation uses heldout replica 01 and separate seeds.

The pinned SDK is internally incompatible for this workflow: its compiler runtime writes raw profile **version 10**, while its bundled `llvm-profdata` requires **version 11**. The merge fails, so **production WASM does not use PGO**. The benchmark records the failure and continues the ordinary compiler matrix. Do not edit profile headers or assume an older merger fixes the runtime/compiler ABI. A matched compiler, profiling runtime and profile tool must be installed and verified before enabling PGO. `LLVM_PROFDATA` can select a tool when using a compatible SDK.

With compatible tools, the same benchmark merges exported counters and builds the PGO candidate using `-fprofile-instr-use`. Outdated or missing source profiles are treated as compiler errors. A PGO candidate still needs heldout correctness and speed checks before promotion; native MSVC profiles cannot be reused.

## Remaining hot spots

A separate Chromium CPU profile of five million proposals on N100 carryover collected 1,598 samples. Schedule timing (`Problem::step`) and two-batch suffix simulation account for roughly 76% of self samples; search coordination and fitness scoring follow. These are sampled locations in an inlined optimized build, not exact per-function costs or a broad workload profile. Embind, progress callbacks and 128-bit multiplication were minor in this case. No speculative hot-loop or RNG rewrite was promoted. SIMD did not beat the selected build.

## Reproduction

From the repository root, with workspace dependencies, the Python optimizer extension and Playwright browsers installed:

```powershell
pnpm wasm:setup
pnpm wasm:build
pnpm benchmark:wasm
node scripts/profile-wasm.mjs
```

The benchmark generates missing SMAC fixtures without overwriting existing ones, builds isolated variants, trains PGO where supported, runs heldout panels, and independently rescores results. It does not promote a candidate. The normal build uses the selected production flags and refreshes the content-addressed assets and engine manifest.

Detailed inputs, builds, profiles and reports live in ignored `packages/optimizer/tmp/wasm-performance/`. `--reuse-input` and `--reuse-builds` are local experiment shortcuts; omit them for a clean rerun. `--browser=firefox` or `--browser=webkit` selects another runtime. Saved timings above are Chromium measurements.

## Validation

The production app builds successfully. Thirty unit tests, type checking, UI lint, CSS lint and formatting checks pass. Existing formatting warnings were resolved with formatting-only edits. Optimizer parity, large-input determinism, transition-time scheduling and 20-start preset checks pass in Chromium and WebKit (12 browser tests).

Firefox checks could not run: its content process crashes at `browserContext.newPage`, before app navigation. A separate blank-page probe reproduces the host failure (`Failed to launch tab subprocess @SB::LA::SpawnTarget`). Firefox compatibility remains unverified in this environment. Native WASM exceptions require browser support; no legacy-browser fallback was added.
