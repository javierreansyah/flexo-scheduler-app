"""Isolated Windows compiler/RNG trials; run from packages/optimizer.

python experiments/compiler_benchmark.py --workdir results/compiler-benchmark
Never replaces the installed extension or changes production compiler defaults.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
import platform
from pathlib import Path
import shutil
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
PARAMS = dict(evaluations=5_000_000, starts=4, stage_length=4908,
              t_max=.1603194019, t_min=.0116169910, rcl_alpha=.2746914740,
              p_inter=.6647498733, p_shift=.5008078735, p_block=.2693767726)


def panel(args):
    sys.path.insert(0, str(Path(args.package).resolve()))
    from flexo import prepare, optimize, evaluate, _core
    jobs = []
    for n in (10, 30, 50, 100):
        for kind in ('clean', 'carryover'):
            name = f'N{n}_{kind}_{args.replica:02}.json'
            raw = json.loads((ROOT/'instances/smac'/args.dataset/name).read_text())
            jobs.append((name, prepare(raw)))
    params = {**PARAMS, 'evaluations': args.evaluations}
    if args.parameters: params.update(json.loads(Path(args.parameters).read_text()))
    budgets = json.loads(Path(args.budget_file).read_text()) if args.budget_file else {}
    # Preparation and warmup are outside the measured interval.
    for _, problem in jobs:
        optimize(problem, {**params, 'evaluations': 10000}, seed=99, num_threads=1)
    tasks = [(name, problem, seed) for name, problem in jobs for seed in range(args.seed, args.seed+5)]
    def solve(task):
        name, problem, seed = task
        start = time.perf_counter()
        r = optimize(problem, {**params, 'evaluations': budgets.get(name, params['evaluations'])}, seed=seed, num_threads=1)
        elapsed = time.perf_counter()-start
        checked = evaluate(problem, r['schedule'])
        assert abs(checked['fitness']-r['fitness']) < 1e-8
        return dict(instance=name, seed=seed, seconds=elapsed, evaluations=r['parameters']['evaluations'], fitness=r['fitness'],
                    schedule_sha256=hashlib.sha256(json.dumps(r['schedule'], sort_keys=True).encode()).hexdigest())
    start, cpu = time.perf_counter(), time.process_time()
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        rows = list(pool.map(solve, tasks))
    wall, cpu = time.perf_counter()-start, time.process_time()-cpu
    result = dict(wall_seconds=wall, cpu_seconds=cpu, average_busy_cpus=cpu/wall,
                  workers=args.workers, parameters=params, rows=rows,
                  core_sha256=hashlib.sha256(Path(_core.__file__).read_bytes()).hexdigest())
    Path(args.output).write_text(json.dumps(result, indent=2))
    print(f'{args.output}: {wall:.3f}s, {cpu/wall:.1f} busy CPUs', flush=True)


def command(cmd, cwd, log, env=None):
    with Path(log).open('w') as stream:
        p = subprocess.run(cmd, cwd=cwd, stdout=stream, stderr=subprocess.STDOUT, env=env)
    if p.returncode:
        raise RuntimeError(f'Command failed ({p.returncode}); see {log}')


def copy_variant(work, name):
    dest = work/name
    dest.mkdir()
    for folder in ('src', 'flexo', 'tests', 'experiments', 'instances/validation'):
        shutil.copytree(ROOT/folder, dest/folder, ignore=shutil.ignore_patterns('__pycache__', '*.pyd'))
    shutil.copy2(ROOT/'setup.py', dest/'setup.py')
    shutil.copy2('C:/Program Files/Microsoft Visual Studio/18/Community/VC/Tools/MSVC/14.50.35717/bin/Hostx64/x64/pgort140.dll', dest/'flexo/pgort140.dll')
    return dest


def build(dest, flags=(), link=(), clang=None):
    setup = (dest/'setup.py').read_text()
    setup = setup.replace('["/O2", "/fp:precise"]', repr(['/O2', '/fp:precise', *(['--driver-mode=cl'] if clang and clang.name == 'clang.exe' else []), *flags]))
    setup = setup.replace('extra_link_args=[]', 'extra_link_args='+repr(list(link)))
    if clang:
        setup = setup.replace('setup(\n', '''class ClangBuild(build_ext):
    def build_extensions(self):
        self.compiler.initialize()
        self.compiler.cc = CLANG
        self.compiler.compile_options = [x for x in self.compiler.compile_options if x != '/GL']
        self.compiler.ldflags_shared[:] = [x for x in self.compiler.ldflags_shared if x != '/LTCG']
        super().build_extensions()

setup(\n'''.replace('CLANG', repr(str(clang))))
        setup = setup.replace('"build_ext": build_ext', '"build_ext": ClangBuild')
    (dest/'setup.py').write_text(setup)
    vcvars = Path('C:/Program Files/Microsoft Visual Studio/18/Community/VC/Auxiliary/Build/vcvars64.bat')
    bat = dest/'build.cmd'
    bat.write_text(f'@echo off\ncall "{vcvars}" >nul\n"{sys.executable}" setup.py build_ext --inplace --force\n')
    command(['cmd.exe', '/c', str(bat)], dest, dest/'build.log')


def orchestrate(args):
    work = Path(args.workdir).resolve()
    work.mkdir(parents=True, exist_ok=False)
    (work/'metadata.json').write_text(json.dumps(dict(parameters=PARAMS, workers=args.workers,
        python=sys.version, cpu=platform.processor(), logical_cpus=os.cpu_count(),
        dataset_sha256=hashlib.sha256(b''.join(p.read_bytes() for p in sorted((ROOT/'instances/smac').glob('*/*.json')))).hexdigest(), commit=subprocess.check_output(['git','rev-parse','HEAD'], cwd=ROOT, text=True).strip()), indent=2))
    def measure(label, package, round_id, training=False, evaluations=5_000_000):
        output = work/f'{label}-{round_id}.json'
        cmd = [sys.executable, str(Path(__file__).resolve()), '--panel', '--package', str(package),
               '--output', str(output), '--workers', str(args.workers), '--evaluations', str(evaluations),
               '--seed', '42' if training else '142', '--dataset', 'train' if training else 'heldout']
        command(cmd, ROOT, work/f'{label}-{round_id}.log')
        print(output.name+': '+str(json.loads(output.read_text())['wall_seconds']), flush=True)
    measure('installed', ROOT, 0)
    variants = {}
    for name, flags, link in [('baseline', [], []), ('avx2', ['/arch:AVX2'], []),
                              ('pgo', [], ['/LTCG', '/GENPROFILE:EXACT']), ('rng', [], [])]:
        dest = copy_variant(work, name)
        if name == 'rng':
            p = dest/'src/moves.h'
            s = p.read_text()
            begin = s.index('        const uint64_t result = rotl(s[0] + s[3], 23)')
            end = s.index('        return result;', begin)
            s = s[:begin]+'''        const uint64_t result = rotl(s[0] + s[1], 17) + s[0];
        const uint64_t a = s[0], b = s[1] ^ a;
        s[0] = rotl(a, 49) ^ b ^ (b << 21);
        s[1] = rotl(b, 28);
'''+s[end:]
            p.write_text(s)
        try:
            build(dest, flags, link)
            if name == 'pgo':
                measure('pgo-training', dest, 0, training=True, evaluations=10_000)
                profile_dir = next((dest/'build').glob('lib.*/flexo'))
                counters = list((dest/'flexo').glob('*.pgc'))
                if not counters: raise RuntimeError('PGO training produced no counters')
                for counter in counters: shutil.copy2(counter, profile_dir/counter.name)
                # Reuse the exact instrumented objects and profile database at link time.
                log = (dest/'build.log').read_text()
                line = next(x for x in log.splitlines() if 'link.exe' in x and '/OUT:' in x)
                line = line.replace('/GENPROFILE:EXACT', '/USEPROFILE')
                bat = dest/'relink.cmd'
                bat.write_text('@echo off\ncall "C:/Program Files/Microsoft Visual Studio/18/Community/VC/Auxiliary/Build/vcvars64.bat" >nul\n'+line+'\n')
                command(['cmd.exe','/c',str(bat)], dest, dest/'relink.log')
                if 'optimizations disabled' in (dest/'relink.log').read_text():
                    raise RuntimeError('PGO linker disabled profile optimization')
                binary = next((dest/'build').glob('lib.*/flexo/*.pyd'))
                shutil.copy2(binary, dest/'flexo'/binary.name)
            command([sys.executable, '-m', 'pytest', '-q', 'tests'], dest, dest/'tests.log',
                    {**os.environ, 'PYTHONPATH':str(dest)})
            variants[name] = dest
        except Exception as e:
            (work/f'{name}-failed.txt').write_text(str(e))
            print(name+': '+str(e), flush=True)
    if args.clang:
        dest = copy_variant(work, 'clang')
        try:
            build(dest, ['/clang:-O3', '/clang:-ffp-contract=off'], clang=Path(args.clang).resolve())
            command([sys.executable,'-m','pytest','-q','tests'], dest, dest/'tests.log', {**os.environ,'PYTHONPATH':str(dest)})
            variants['clang'] = dest
        except Exception as e:
            (work/'clang-failed.txt').write_text(str(e))
    for r in range(3):
        order = list(variants.items())
        if r % 2: order.reverse()
        for name, dest in order:
            measure(name, dest, r)
    if 'rng' in variants and 'baseline' in variants:
        def quality(name, mode, budgets=None):
            cmd = [sys.executable, str(Path(__file__).resolve()), '--panel', '--package', str(variants[name]),
                   '--output', str(work/f'quality-{name}-{mode}.json'), '--workers', str(args.workers),
                   '--seed', '242', '--replica', '1']
            if budgets: cmd += ['--budget-file', str(budgets)]
            command(cmd, ROOT, work/f'quality-{name}-{mode}.log')
        for name in ('baseline', 'rng'): quality(name, 'equal-proposals')
        import statistics
        a = json.loads((work/'baseline-0.json').read_text())
        b = json.loads((work/'rng-0.json').read_text())
        budgets = {}
        for instance in {r['instance'] for r in a['rows']}:
            at = statistics.mean(r['seconds'] for r in a['rows'] if r['instance']==instance)
            bt = statistics.mean(r['seconds'] for r in b['rows'] if r['instance']==instance)
            budgets[instance.replace('_00.json','_01.json')] = int(5_000_000*at/bt)
        budget_path = work/'rng-time-budgets.json'
        budget_path.write_text(json.dumps(budgets, indent=2))
        shutil.copy2(work/'quality-baseline-equal-proposals.json', work/'quality-baseline-calibrated-time.json')
        quality('rng', 'calibrated-time', budget_path)
    if 'pgo' in variants and 'baseline' in variants:
        for r in range(3):
            for name in (('baseline', 'pgo') if r%2==0 else ('pgo', 'baseline')):
                cmd = [sys.executable, str(Path(__file__).resolve()), '--panel', '--package', str(variants[name]),
                       '--output', str(work/f'confirmation-{name}-{r}.json'), '--workers', str(args.workers),
                       '--seed', '242', '--replica', '1']
                command(cmd, ROOT, work/f'confirmation-{name}-{r}.log')
    if 'baseline' in variants:
        from compiler_report import summarize
        summarize(work)
    print('Completed: '+str(work), flush=True)


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--workdir', default='results/compiler-benchmark')
    p.add_argument('--workers', type=int, default=20)
    p.add_argument('--clang')
    p.add_argument('--panel', action='store_true')
    p.add_argument('--budget-file')
    p.add_argument('--parameters')
    p.add_argument('--package', default=str(ROOT))
    p.add_argument('--output')
    p.add_argument('--dataset', default='heldout')
    p.add_argument('--replica', type=int, default=0)
    p.add_argument('--seed', type=int, default=142)
    p.add_argument('--evaluations', type=int, default=5_000_000)
    args = p.parse_args()
    if args.workers < 1 or args.evaluations < 1: p.error('workers and evaluations must be positive')
    panel(args) if args.panel else orchestrate(args)
