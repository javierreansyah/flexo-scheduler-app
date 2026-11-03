"""Summarize compiler_benchmark outputs without promoting a variant."""
import argparse
import json
from pathlib import Path
import statistics as st


def summarize(work):
    groups = {}
    for name in ('baseline', 'avx2', 'pgo', 'rng', 'clang', 'combined'):
        rounds = [json.loads(p.read_text()) for p in sorted(work.glob(f'{name}-[0-9].json'))]
        if rounds:
            groups[name] = rounds
    base = groups['baseline']
    ref = {(r['instance'], r['seed']): r for r in base[0]['rows']}
    lines = ['# Experimental optimizer: compiler and RNG benchmarks', '',
             'Native Python/C++ optimizer on an Intel Core i7-12700H, 20 logical CPUs. Production WASM and installed extension are unchanged.', '',
             '## Method', '',
             'Each panel runs eight frozen heldout snapshots: N10/N30/N50/N100, clean and carryover, replica 00, with seeds 142–146. Each of the 40 solves uses five million total proposals and four starts, serially within each solve. A 20-worker pool runs independent solves concurrently. Preparation and warmup are excluded; every schedule is independently rescored.', '',
             'Three rounds alternate variant order. Whole-panel wall time measures throughput. Busy CPUs means process CPU seconds divided by elapsed seconds. Per-size concurrent solve times include contention.', '',
             '## Results', '',
             '| Variant | Panel median s (min–max) | Speedup | Busy CPUs | Matching schedules |',
             '| --- | ---: | ---: | ---: | ---: |']
    compact = {}
    for name, rounds in groups.items():
        wall = [x['wall_seconds'] for x in rounds]
        speed = st.median(x['wall_seconds'] for x in base)/st.median(wall)
        matches = sum(r['schedule_sha256'] == ref[r['instance'], r['seed']]['schedule_sha256'] for r in rounds[0]['rows'])
        busy = st.mean(x['average_busy_cpus'] for x in rounds)
        lines.append(f'| {name} | {st.median(wall):.3f} ({min(wall):.3f}–{max(wall):.3f}) | {speed:.3f}x | {busy:.1f} | {matches}/40 |')
        compact[name] = dict(wall_seconds=wall, speedup=speed, matches=matches,
                             busy_cpus=busy, binary_sha256=rounds[0]['core_sha256'])
    lines += ['', 'Mean concurrent solve seconds by requested movable-job count:', '',
              '| Variant | N10 | N30 | N50 | N100 |', '| --- | ---: | ---: | ---: | ---: |']
    for name, rounds in groups.items():
        values = [st.mean(r['seconds'] for x in rounds for r in x['rows'] if r['instance'].startswith(f'N{n}_')) for n in (10, 30, 50, 100)]
        compact[name]['seconds_by_size'] = dict(zip((10, 30, 50, 100), values))
        lines.append('| '+name+' | '+' | '.join(f'{v:.3f}' for v in values)+' |')
    if 'pgo' in compact and compact['pgo']['speedup'] >= 1.05:
        speed = compact['pgo']['speedup']
        lines[2:2] = [f'**Recommendation:** keep xoshiro256++ and the current precise math settings. MSVC PGO is the worthwhile compilation option in this experiment: {(speed-1)*100:.1f}% higher throughput, or {(1-1/speed)*100:.1f}% less panel time. AVX2 and the alternate RNG did not show a reliable gain; this Clang build was slower. No default has been promoted.', '']
    installed = json.loads((work/'installed-0.json').read_text())
    matches = sum(r['schedule_sha256'] == ref[r['instance'],r['seed']]['schedule_sha256'] for r in installed['rows'])
    lines += ['', f'The initial installed-extension panel took {installed["wall_seconds"]:.3f}s; {matches}/40 schedules match the rebuilt baseline. This single initial pass is excluded from speedup calculations.', '',
              '## Build settings and checks', '',
              '- Baseline: MSVC 14.50.35717, /O2 /fp:precise /GL, linker /LTCG.',
              '- AVX2: baseline plus /arch:AVX2; specific to supported CPUs.',
              '- PGO: /LTCG /GENPROFILE:EXACT instrumented build; separate training snapshots and seeds 42–46 (10,000 proposals per solve, plus warmup), followed by /USEPROFILE relink of the same objects. Instrumentation training times are excluded.',
              '- RNG: baseline compiler; xoroshiro128++ recurrence, retaining SplitMix initialization, upper-53-bit doubles and unbiased Lemire bounded sampling.',
              '- Clang: existing Emscripten-distributed native Windows Clang 24.0.0git, revision 83ee07799c341b60965f07892f7bb3d175da05be. --driver-mode=cl /O2 /fp:precise /clang:-O3 /clang:-ffp-contract=off; MSVC linker, no LTO. This is a development compiler.', '']
    confirmation = {}
    for name in ('baseline', 'pgo'):
        confirmation[name] = [json.loads(p.read_text()) for p in sorted(work.glob(f'confirmation-{name}-*.json'))]
    if all(confirmation.values()):
        a, b = confirmation['baseline'], confirmation['pgo']
        ratio = st.median(x['wall_seconds'] for x in a)/st.median(x['wall_seconds'] for x in b)
        same = all(x['schedule_sha256'] == y['schedule_sha256']
                   for ar, br in zip(a, b) for x, y in zip(ar['rows'], br['rows']))
        lines += ['Independent replica-01, seeds-242–246 confirmation: '
                  f'PGO throughput {ratio:.3f}x baseline; all seeded schedules identical: {same}.', '']
        compact['pgo_confirmation'] = dict(speedup=ratio, identical=same,
                                           baseline_seconds=[x['wall_seconds'] for x in a],
                                           pgo_seconds=[x['wall_seconds'] for x in b])
    for name in groups:
        p = work/name/'tests.log'
        result = next((line for line in reversed(p.read_text().splitlines()) if ' passed' in line or ' failed' in line), 'No full-suite result') if p.exists() else 'No full-suite result'
        lines.append(f'- {name}: {result}')
    lines += ['', '## Independent RNG quality check', '']
    for mode in ('equal-proposals', 'calibrated-time'):
        a, b = work/f'quality-baseline-{mode}.json', work/f'quality-rng-{mode}.json'
        if a.exists() and b.exists():
            ar, br = json.loads(a.read_text()), json.loads(b.read_text())
            lookup = {(r['instance'],r['seed']):r for r in ar['rows']}
            ratio = st.mean(r['fitness']/lookup[r['instance'],r['seed']]['fitness'] for r in br['rows'])
            lines.append(f'- {mode}: mean per-solve RNG/baseline fitness ratio {ratio:.6f} (lower is better). Panel wall seconds: {ar["wall_seconds"]:.3f} baseline, {br["wall_seconds"]:.3f} RNG.')
            compact[mode] = dict(mean_fitness_ratio=ratio, baseline=ar, rng=br)
    lines += ['', 'Quality panels use replica 01 and independent seeds 242–246. Calibrated-time budgets estimate equal compute allowance using measured per-case speed ratios; they are not hard deadline runs. Forty solves cannot establish statistical equivalence or guarantee future quality.', '',
              '## Reproduction and limitations', '',
              'From packages/optimizer, use a fresh work directory:', '',
              '```powershell',
              'python experiments/compiler_benchmark.py --workdir results/compiler-benchmark-new --clang ../../.toolchains/emsdk/upstream/bin/clang.exe',
              'python experiments/compiler_report.py results/compiler-benchmark-new', '```', '',
              'Raw logs, binaries and rows from this run: results/compiler-benchmark-v2 (ignored). Compact measurements: [compiler-rng-measurements.json](compiler-rng-measurements.json). Existing tuning caches were preserved. No fast-math, objective changes, retuning, or reduced timed proposal budgets were used.', '',
              'PGO training was deliberately short after a larger instrumented run proved expensive; it does not establish the best achievable PGO result. Short timings remain sensitive to host activity, thermal drift, and hybrid CPU scheduling. A stable standalone LLVM download failed after a partial transfer; GitHub API discovery was rate-limited. GCC, Clang PGO and full preset retuning were not tested. Initial harness dependency issues were fixed before the reported measurements.', '']
    output = Path(__file__).resolve().parents[1]/'docs/compiler-rng-benchmark.md'
    output.write_text('\n'.join(lines), encoding='utf-8')
    output.with_name('compiler-rng-measurements.json').write_text(json.dumps(compact, indent=2), encoding='utf-8')
    print(output)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('workdir', type=Path)
    summarize(parser.parse_args().workdir)
