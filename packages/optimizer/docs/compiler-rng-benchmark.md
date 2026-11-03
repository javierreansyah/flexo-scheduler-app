# Experimental optimizer: compiler and RNG benchmarks

**Recommendation:** keep xoshiro256++ and the current precise math settings. MSVC PGO is the worthwhile compilation option in this experiment: 16.2% higher throughput, or 14.0% less panel time. AVX2 and the alternate RNG did not show a reliable gain; this Clang build was slower. No default has been promoted.

Native Python/C++ optimizer on an Intel Core i7-12700H, 20 logical CPUs. Production WASM and installed extension are unchanged.

## Method

Each panel runs eight frozen heldout snapshots: N10/N30/N50/N100, clean and carryover, replica 00, with seeds 142–146. Each of the 40 solves uses five million total proposals and four starts, serially within each solve. A 20-worker pool runs independent solves concurrently. Preparation and warmup are excluded; every schedule is independently rescored.

Three rounds alternate variant order. Whole-panel wall time measures throughput. Busy CPUs means process CPU seconds divided by elapsed seconds. Per-size concurrent solve times include contention.

## Results

| Variant | Panel median s (min–max) | Speedup | Busy CPUs | Matching schedules |
| --- | ---: | ---: | ---: | ---: |
| baseline | 5.610 (5.502–5.667) | 1.000x | 14.8 | 40/40 |
| avx2 | 5.623 (5.547–5.642) | 0.998x | 15.0 | 40/40 |
| pgo | 4.826 (4.817–5.077) | 1.162x | 14.5 | 40/40 |
| rng | 5.621 (5.525–5.851) | 0.998x | 14.9 | 2/40 |
| clang | 6.364 (6.077–6.481) | 0.881x | 14.4 | 40/40 |

Mean concurrent solve seconds by requested movable-job count:

| Variant | N10 | N30 | N50 | N100 |
| --- | ---: | ---: | ---: | ---: |
| baseline | 0.968 | 1.894 | 2.522 | 3.425 |
| avx2 | 0.943 | 1.865 | 2.501 | 3.435 |
| pgo | 0.917 | 1.693 | 2.186 | 2.826 |
| rng | 0.979 | 1.878 | 2.551 | 3.533 |
| clang | 0.984 | 1.974 | 2.698 | 3.857 |

The initial installed-extension panel took 5.272s; 40/40 schedules match the rebuilt baseline. This single initial pass is excluded from speedup calculations.

## Build settings and checks

- Baseline: MSVC 14.50.35717, /O2 /fp:precise /GL, linker /LTCG.
- AVX2: baseline plus /arch:AVX2; specific to supported CPUs.
- PGO: /LTCG /GENPROFILE:EXACT instrumented build; separate training snapshots and seeds 42–46 (10,000 proposals per solve, plus warmup), followed by /USEPROFILE relink of the same objects. Instrumentation training times are excluded.
- RNG: baseline compiler; xoroshiro128++ recurrence, retaining SplitMix initialization, upper-53-bit doubles and unbiased Lemire bounded sampling.
- Clang: existing Emscripten-distributed native Windows Clang 24.0.0git, revision 83ee07799c341b60965f07892f7bb3d175da05be. --driver-mode=cl /O2 /fp:precise /clang:-O3 /clang:-ffp-contract=off; MSVC linker, no LTO. This is a development compiler.

Independent replica-01, seeds-242–246 confirmation: PGO throughput 1.189x baseline; all seeded schedules identical: True.

- baseline: 53 passed, 209 warnings in 54.51s
- avx2: 53 passed, 209 warnings in 50.65s
- pgo: 53 passed, 209 warnings in 43.72s
- rng: 53 passed, 209 warnings in 46.03s
- clang: 53 passed, 209 warnings in 186.43s (0:03:06)

## Independent RNG quality check

- equal-proposals: mean per-solve RNG/baseline fitness ratio 1.002192 (lower is better). Panel wall seconds: 5.714 baseline, 5.905 RNG.
- calibrated-time: mean per-solve RNG/baseline fitness ratio 1.000642 (lower is better). Panel wall seconds: 5.714 baseline, 5.490 RNG.

Quality panels use replica 01 and independent seeds 242–246. Calibrated-time budgets estimate equal compute allowance using measured per-case speed ratios; they are not hard deadline runs. Forty solves cannot establish statistical equivalence or guarantee future quality.

## Reproduction and limitations

From packages/optimizer, use a fresh work directory:

```powershell
python experiments/compiler_benchmark.py --workdir results/compiler-benchmark-new --clang ../../.toolchains/emsdk/upstream/bin/clang.exe
python experiments/compiler_report.py results/compiler-benchmark-new
```

Raw logs, binaries and rows from this run: results/compiler-benchmark-v2 (ignored). Compact measurements: [compiler-rng-measurements.json](compiler-rng-measurements.json). Existing tuning caches were preserved. No fast-math, objective changes, retuning, or reduced timed proposal budgets were used.

PGO training was deliberately short after a larger instrumented run proved expensive; it does not establish the best achievable PGO result. Short timings remain sensitive to host activity, thermal drift, and hybrid CPU scheduling. A stable standalone LLVM download failed after a partial transfer; GitHub API discovery was rate-limited. GCC, Clang PGO and full preset retuning were not tested. Initial harness dependency issues were fixed before the reported measurements.
