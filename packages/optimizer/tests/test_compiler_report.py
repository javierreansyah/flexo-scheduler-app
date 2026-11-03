import json

from experiments import compiler_report


def test_report_uses_panel_medians_and_compares_seeded_schedules(tmp_path, monkeypatch):
    work = tmp_path / 'measurements'
    work.mkdir()
    (tmp_path / 'docs').mkdir()
    monkeypatch.setattr(compiler_report, '__file__', str(tmp_path / 'experiments/compiler_report.py'))
    rows = [dict(instance=f'N{n}_{kind}_00.json', seed=seed, seconds=1., fitness=10.,
                 schedule_sha256='same')
            for n in (10, 30, 50, 100) for kind in ('clean', 'carryover')
            for seed in range(142, 147)]
    for name, times in [('baseline', [9., 10., 11.]), ('rng', [19., 20., 21.])]:
        for i, wall in enumerate(times):
            data = dict(wall_seconds=wall, average_busy_cpus=15., rows=rows,
                        core_sha256=name)
            (work / f'{name}-{i}.json').write_text(json.dumps(data))
    (work / 'installed-0.json').write_text((work / 'baseline-0.json').read_text())
    compiler_report.summarize(work)
    result = json.loads((tmp_path / 'docs/compiler-rng-measurements.json').read_text())
    assert result['rng']['speedup'] == .5
    assert result['rng']['matches'] == 40
    assert result['baseline']['seconds_by_size'] == dict.fromkeys(['10', '30', '50', '100'], 1.)
