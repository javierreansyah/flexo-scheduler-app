import hashlib
import io
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from flexo import _core
from flexo.api import DEFAULT_PARAMETERS, select_parameters
from flexo.fixed_tuning import BUDGETS, fixed_space
from flexo.tuning import CachedEvaluator, PRIOR_PARAMETERS, decode, fingerprint, summarize
from flexo.instances import write_json


def test_fixed_budgets_and_search_space():
    assert BUDGETS[10] == dict(low=100_000, medium=100_000, high=100_000)
    assert BUDGETS[30] == dict(low=600_000, medium=10_000_000, high=100_000_000)
    assert BUDGETS[50] == dict(low=3_000_000, medium=20_000_000, high=100_000_000)
    assert BUDGETS[100] == dict(low=10_000_000, medium=20_000_000, high=100_000_000)
    assert sum(len(set(v.values())) for v in BUDGETS.values()) == 10
    for budgets in BUDGETS.values():
        for budget in set(budgets.values()):
            space = fixed_space(budget)
            assert space['starts'].lower == 1 and space['starts'].upper == 20
            for config in space.sample_configuration(5):
                assert decode(config)['evaluations'] == budget


@pytest.mark.parametrize("pgo", [False, True])
def test_play_button_defaults_to_fixed_without_launching_tuning(monkeypatch, tmp_path, pgo):
    import sys
    import flexo.__main__ as cli
    from experiments import run_tuning
    captured=[]
    monkeypatch.setattr(run_tuning, '__file__', str(tmp_path/'experiments/run_tuning.py'))
    if pgo:
        certificate = tmp_path/'results/fixed-budget-tuning-pgo/build-transition.json'
        certificate.parent.mkdir(parents=True)
        certificate.write_text('{}')
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(sys,'argv',['run_tuning.py'])
    monkeypatch.setattr(cli,'main',lambda: captured.extend(sys.argv[1:]))
    run_tuning.main()
    assert captured[0]=='tune-fixed'
    assert Path(captured[captured.index('--workdir')+1])==Path('results/fixed-budget-tuning-pgo' if pgo else 'results/fixed-budget-tuning')
    assert captured[captured.index('--trials')+1]=='400'


def test_cli_dispatches_fixed_options_without_running(monkeypatch, tmp_path):
    import sys
    import flexo.__main__ as cli
    import flexo.fixed_tuning as module
    captured={}
    monkeypatch.setattr(module,'tune_fixed',lambda *args,**kwargs: captured.update(kwargs))
    monkeypatch.setattr(sys,'argv',['flexo','tune-fixed','--workdir',str(tmp_path),
                                   '--workers','20','--trials','123','--resume'])
    cli.main()
    assert captured['workers']==20 and captured['trials']==123 and captured['resume']


def test_fixed_progress_tracks_budgets_without_completing_size_early(tmp_path):
    from experiments.run_tuning import TerminalProgress
    progress = TerminalProgress(tmp_path, stream=io.StringIO(), bar_stream=io.StringIO())
    try:
        progress.write('Fixed search: N30, budget=600000, total=410, finished=10, reused=10\n')
        progress.write('Fixed trial 11/410: quality=0.95\n')
        assert progress.phase.n == 11 and progress.completed == set()
        progress.write('Fixed search: N30, budget=10000000, total=400, finished=0, reused=0\n')
        assert progress.phase.n == 0 and progress.completed == set()
        progress.write('N30: presets ready, heldout gaps={}\n')
        assert progress.completed == {30}
    finally:
        progress.finish(False)


def test_fixed_campaign_cache_export_interrupt_and_resume(tmp_path, monkeypatch):
    pytest.importorskip('smac')
    import flexo.fixed_tuning as module
    import flexo.tuning as tuning
    dataset = {split: {n:[(f'{kind}.json',kind, SimpleNamespace(movable=range(n),
                   snapshot=dict(n=n,kind=kind,split=split))) for kind in ('clean','carryover')]
               for n in BUDGETS} for split in ('train','heldout')}
    monkeypatch.setattr(module, 'load_dataset', lambda _: (dataset,'synthetic-dataset'))
    tiny = {n:dict(low=100_000,medium=100_000 if n==10 else 200_000,
                   high=100_000 if n==10 else 300_000) for n in BUDGETS}
    monkeypatch.setattr(module, 'BUDGETS', tiny)
    calls=[]
    def fake(problem, parameters, seed, num_threads):
        # Tests never execute native SA or the real tuning datasets.
        assert parameters['evaluations'] <= 300_000
        calls.append((problem.snapshot,parameters,seed))
        return dict(fitness=10.+parameters['starts']/100+seed/100000, total_runtime=.001)
    monkeypatch.setattr(tuning, 'optimize', fake)
    source=tmp_path/'previous'
    source.mkdir()
    manifest=dict(mode='parego',schema_version=4,dataset_sha256='synthetic-dataset',
                  core_sha256=hashlib.sha256(Path(_core.__file__).read_bytes()).hexdigest(),
                  seeds=[42,43,44],heldout_seeds=[142,143,144])
    write_json(source/'manifest.json',manifest)
    params={**DEFAULT_PARAMETERS,**PRIOR_PARAMETERS,'evaluations':100_000}
    evaluator=CachedEvaluator(source/'solves.sqlite3',2)
    measured=evaluator.panel(dataset['train'][10],params,[42,43,44])
    evaluator.close()
    pid=fingerprint(params)
    point=dict(id=pid,parameters=params,measurements=measured,**summarize(measured,measured))
    write_json(source/f'N10/candidates/{pid}.json',point)
    source_bytes=(source/'solves.sqlite3').read_bytes()
    calls.clear()
    actual_write=module.write_json
    completed=0
    def interrupt(path,data):
        nonlocal completed
        actual_write(path,data)
        if Path(path).parent.name=='candidates' and 'execution' in data:
            completed+=1
            if completed==2: raise KeyboardInterrupt()
    monkeypatch.setattr(module,'write_json',interrupt)
    settings=dict(workdir=tmp_path/'new',reuse_from=source,trials=2,workers=2)
    with pytest.raises(KeyboardInterrupt): module.tune_fixed(**settings)
    monkeypatch.setattr(module,'write_json',actual_write)
    result=module.tune_fixed(resume=True,**settings)
    assert (source/'solves.sqlite3').read_bytes()==source_bytes
    assert result['mode']=='fixed-budget'
    assert (tmp_path/'new/profiles.json').exists()
    for n in tiny:
        profile=result['profiles'][str(n)]
        for name,budget in tiny[n].items():
            assert select_parameters(n,result,name)[0]['evaluations']==budget
        assert set(profile['validation']['gap_to_high_pct'])=={'low','medium','high'}
        assert len(list((tmp_path/f'new/N{n}').glob('budget-*')))==len(set(tiny[n].values()))
    assert not any(p==dataset['train'][10][0][2].snapshot and params==pars for p,pars,_ in calls)
    before=len(calls)
    assert module.tune_fixed(resume=True,**settings)['profiles']==result['profiles']
    assert len(calls)==before
    with pytest.raises(ValueError,match='differ'):
        module.tune_fixed(resume=True,**{**settings,'trials':3})
    manifest['core_sha256']='incompatible'
    write_json(source/'manifest.json',manifest)
    with pytest.raises(ValueError,match='core_sha256'):
        module.tune_fixed(workdir=tmp_path/'bad',reuse_from=source,trials=2)
