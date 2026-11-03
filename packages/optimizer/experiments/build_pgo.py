"""Build and verify MSVC PGO, then prepare a stopped fixed-budget campaign.

python experiments/build_pgo.py --source results/fixed-budget-tuning
Never launches tuning. --use-build reuses a previously built isolated PGO package.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from experiments.compiler_benchmark import build, copy_variant, command


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def checkpoint_files(source):
    return {str(p.relative_to(source)): digest(p) for p in source.rglob('*.json')}


def prepare(args):
    source, target, work = args.source.resolve(), args.target.resolve(), args.workdir.resolve()
    if target.exists() or work.exists():
        raise ValueError('Use fresh target and build directories')
    old = json.loads((source/'manifest.json').read_text())
    if old.get('mode') != 'fixed-budget': raise ValueError('Expected fixed-budget campaign')
    installed = next((ROOT/'flexo').glob('_core.cp*-win_amd64.pyd'))
    if digest(installed) != old['core_sha256']: raise ValueError('Installed binary differs from saved campaign')
    dataset = hashlib.sha256()
    for split in ('train','heldout'):
        for p in sorted((ROOT/'instances/smac'/split).glob('*.json')):
            dataset.update(f'{split}/{p.name}\n'.encode()+p.read_bytes())
    if dataset.hexdigest()!=old['dataset_sha256']: raise ValueError('Dataset differs from saved campaign')
    snapshot = checkpoint_files(source)
    db_before = digest(source/'solves.sqlite3')
    work.mkdir(parents=True)
    backup = work/installed.name
    shutil.copy2(installed, backup)
    if args.use_build:
        package = args.use_build.resolve()
    else:
        package = copy_variant(work, 'pgo')
        build(package, link=['/LTCG', '/GENPROFILE:EXACT'])
        command([sys.executable,str(ROOT/'experiments/compiler_benchmark.py'),'--panel','--package',str(package),
                 '--dataset','train','--seed','42','--evaluations','10000','--output',str(work/'training.json')],ROOT,work/'training.log')
        profile = next((package/'build').glob('lib.*/flexo'))
        counters = list((package/'flexo').glob('*.pgc'))
        if not counters: raise ValueError('No PGO counters produced')
        for p in counters: shutil.copy2(p, profile/p.name)
        line = next(x for x in (package/'build.log').read_text().splitlines() if 'link.exe' in x and '/OUT:' in x)
        bat = package/'relink.cmd'
        bat.write_text('@echo off\ncall "C:/Program Files/Microsoft Visual Studio/18/Community/VC/Auxiliary/Build/vcvars64.bat" >nul\n'+line.replace('/GENPROFILE:EXACT','/USEPROFILE')+'\n')
        command(['cmd.exe','/c',str(bat)],package,package/'relink.log')
        shutil.copy2(next(profile.glob('*.pyd')), package/'flexo'/installed.name)
    log = (package/'relink.log').read_text()
    if 'optimized using profile data' not in log or 'optimizations disabled' in log:
        raise ValueError('Linker did not apply PGO')
    for p in (ROOT/'src').glob('*'):
        if p.is_file() and digest(p) != digest(package/'src'/p.name):
            raise ValueError('Native sources differ from PGO build')
    command([sys.executable,'-m','pytest','-q','tests'],package,work/'tests.log', {**os.environ,'PYTHONPATH':str(package)})
    # Use an actually completed configuration from the unfinished highest tier.
    folder = source/'N100/budget-100000000'
    candidate = next(json.loads(p.read_text()) for p in sorted((folder/'candidates').glob('*.json'))
                     if 'execution' in json.loads(p.read_text()))
    params = work/'parameters.json'
    params.write_text(json.dumps(candidate['parameters'],indent=2))
    measurements = {}
    for round_id in range(2):
        for name, pkg in ([('baseline',ROOT),('pgo',package)] if round_id%2 == 0 else [('pgo',package),('baseline',ROOT)]):
            out = work/f'{name}-{round_id}.json'
            command([sys.executable,str(ROOT/'experiments/compiler_benchmark.py'),'--panel','--package',str(pkg),
                     '--parameters',str(params),'--output',str(out)],ROOT,work/f'{name}-{round_id}.log')
            measurements[name,round_id] = json.loads(out.read_text())
            print(name, round_id, measurements[name,round_id]['wall_seconds'],flush=True)
    for r in range(2):
        assert all(row['evaluations']==candidate['parameters']['evaluations'] for name in ('baseline','pgo') for row in measurements[name,r]['rows'])
        a,b = measurements['baseline',r]['rows'],measurements['pgo',r]['rows']
        assert all(x['schedule_sha256']==y['schedule_sha256'] and x['fitness']==y['fitness'] for x,y in zip(a,b))
    # Full 60-solve training panel checks the old cache at the true remaining budget.
    verify = work/'verify.py'
    verify.write_text('''import sys,json
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0,sys.argv[1])
from flexo import optimize,prepare
c=json.loads(Path(sys.argv[2]).read_text()); root=Path(sys.argv[3])
tasks=[(name,s) for name,row in c['measurements'].items() for s in row['samples']]
def check(task):
 name,s=task
 p=prepare(json.loads((root/'instances/smac/train'/name).read_text()))
 r=optimize(p,c['parameters'],seed=s['seed'],num_threads=1)
 assert r['fitness']==s['fitness'],(name,s['seed'],r['fitness'],s['fitness'])
with ThreadPoolExecutor(max_workers=20) as pool: list(pool.map(check,tasks))
print('60 cached fitness values match exactly')
''')
    cfile = work/'cached-candidate.json'; cfile.write_text(json.dumps(candidate))
    command([sys.executable,str(verify),str(package),str(cfile),str(ROOT)],ROOT,work/'cache-verification.log')
    if checkpoint_files(source)!=snapshot or digest(source/'solves.sqlite3')!=db_before:
        raise ValueError('Source campaign changed during verification; stop tuning before preparation')
    target.mkdir()
    for p in source.iterdir():
        if p.is_dir(): shutil.copytree(p,target/p.name)
        elif p.suffix != '.sqlite3': shutil.copy2(p,target/p.name)
    with sqlite3.connect((source/'solves.sqlite3').as_uri()+'?mode=ro',uri=True) as src, sqlite3.connect(target/'solves.sqlite3') as dst:
        src.backup(dst)
    transition = dict(old_core_sha256=old['core_sha256'],new_core_sha256=digest(package/'flexo'/installed.name),
                      dataset_sha256=old['dataset_sha256'],source=str(source),source_manifest_sha256=digest(source/'manifest.json'),
                      old_source_sha256=old['source_sha256'],verification=str(work),native_sources={p.name:digest(p) for p in (ROOT/'src').glob('*') if p.is_file()},
                      timing_samples={f'{k[0]}-{k[1]}':v['wall_seconds'] for k,v in measurements.items()})
    def fingerprint(value):
        return hashlib.sha256(json.dumps(value,sort_keys=True,allow_nan=False).encode()).hexdigest()
    manifest = dict(old,core_sha256=transition['new_core_sha256'], source_sha256=fingerprint([
        (ROOT/'flexo/fixed_tuning.py').read_text(),(ROOT/'flexo/tuning.py').read_text(),(ROOT/'flexo/api.py').read_text(),
        (ROOT/'flexo/smac_resume.py').read_text()]),
        build_transition_sha256=fingerprint(transition))
    (target/'build-transition.json').write_text(json.dumps(transition,indent=2))
    (target/'manifest.json').write_text(json.dumps(manifest,indent=2))
    # Promotion is last; all expensive checks and the source snapshot check succeeded.
    staging = installed.with_suffix('.pgo-ready')
    shutil.copy2(package/'flexo'/installed.name,staging)
    try: os.replace(staging,installed)
    except BaseException:
        staging.unlink(missing_ok=True)
        raise
    print('Prepared and installed PGO. Tuning has NOT started.',flush=True)
    print('Resume: python experiments/run_tuning.py --workdir '+str(target),flush=True)
    print('Rollback binary: '+str(backup),flush=True)


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source',type=Path,default=ROOT/'results/fixed-budget-tuning')
    p.add_argument('--target',type=Path,default=ROOT/'results/fixed-budget-tuning-pgo')
    p.add_argument('--workdir',type=Path,default=ROOT/'results/pgo-install')
    p.add_argument('--use-build',type=Path)
    p.add_argument('--rollback',action='store_true',help='Restore the saved binary for the prepared continuation')
    args=p.parse_args()
    if args.rollback:
        target=args.target.resolve()
        transition=json.loads((target/'build-transition.json').read_text())
        backup=next(Path(transition['verification']).glob('_core.cp*-win_amd64.pyd'))
        if digest(backup)!=transition['old_core_sha256']: raise ValueError('Rollback binary hash mismatch')
        installed=ROOT/'flexo'/backup.name
        shutil.copy2(backup,installed)
        transition['new_core_sha256']=transition['old_core_sha256']
        transition['rollback']=True
        (target/'build-transition.json').write_text(json.dumps(transition,indent=2))
        manifest=json.loads((target/'manifest.json').read_text())
        manifest['core_sha256']=transition['new_core_sha256']
        manifest['build_transition_sha256']=hashlib.sha256(json.dumps(transition,sort_keys=True,allow_nan=False).encode()).hexdigest()
        (target/'manifest.json').write_text(json.dumps(manifest,indent=2))
        print('Original binary restored; prepared checkpoint retained. Tuning has not started.')
    else:
        prepare(args)
