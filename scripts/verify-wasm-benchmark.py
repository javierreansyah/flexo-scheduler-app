"""Independently rescore every result and summarize paired timing panels."""
import hashlib
import json
from pathlib import Path
import statistics
import sys
root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / 'packages/optimizer'))
from flexo import api
out = root / 'packages/optimizer/tmp/wasm-performance'
inputs = json.loads((out / 'input.json').read_text())
report = json.loads((out / 'report.json').read_text())
cases = {c['name']:c for c in inputs['rows']}
prepared = {name:api.prepare(c['snapshot']) for name,c in cases.items()}
keys = ('fitness', 'ink_changes', 'batch_flow_time', 'makespan')
def signature(result):
    return result['schedule']
baseline = {(r['name'],r['seed']):signature(r['result']) for r in report['rows'] if r['variant']=='baseline' and not r['app']}
expected = {(c['name'], s['seed']) for c in inputs['rows'] if c['panel']=='heldout' for s in c['samples']}
for variant in {r['variant'] for r in report['rows']}:
    for repeat in range(3):
        actual = [(r['name'],r['seed']) for r in report['rows'] if r['variant']==variant and r['round']==repeat and not r['app']]
        assert len(actual)==len(expected) and set(actual)==expected, ('Incomplete panel',variant,repeat)
for row in report['rows']:
    p = prepared[row['name']]
    result = row['result']
    if row['app']:
        checked = api.evaluate(p,result['schedule'])
        expected_schedule = api._format(p, dict(schedule=baseline[row['name'],row['seed']]))['schedule']
        assert result['schedule']==expected_schedule, ('App worker differs from kernel',row['variant'],row['name'],row['seed'])
    else:
        checked = p.core.evaluate([[e['job'] for e in lane] for lane in result['schedule']])
    for key in keys:
        assert abs(checked[key]-result[key])<1e-8, (row['variant'],row['name'],key)
    if not row['app']:
        assert signature(result)==baseline[row['name'],row['seed']], ('Changed schedule',row['variant'],row['name'],row['seed'])
summary = {}
for variant in dict.fromkeys(r['variant'] for r in report['rows']):
    rows = [r for r in report['rows'] if r['variant']==variant and not r['app']]
    totals = [sum(r['ms'] for r in rows if r['round']==i) for i in range(3)]
    native = sum(statistics.median(s['native_ms']) for c in inputs['rows'] if c['panel']=='heldout' for s in c['samples'])
    app = [r['ms'] for r in report['rows'] if r['variant']==variant and r['app']]
    summary[variant] = dict(panel_ms=totals, median_panel_ms=statistics.median(totals), native_panel_ms=native, fresh_worker_panel_ms=sum(app) if app else None,
        wasm_bytes=(out/variant/'engine.wasm').stat().st_size,
        engine_sha256=hashlib.sha256((out/variant/'engine.wasm').read_bytes()).hexdigest())
    native_matches = 0
    for row in rows:
        sample = next(s for s in cases[row['name']]['samples'] if s['seed']==row['seed'])
        native_matches += signature(row['result'])==signature(sample['native_result'])
    summary[variant]['native_schedule_matches'] = [native_matches,len(rows)]
for variant, s in summary.items():
    s['speedup_vs_shipped']=summary['shipped']['median_panel_ms']/s['median_panel_ms']
    s['speedup_vs_fresh']=summary['baseline']['median_panel_ms']/s['median_panel_ms']
    s['wasm_over_native']=s['median_panel_ms']/s['native_panel_ms']
report.update(independent_rescore_passed=True, identical_wasm_schedules=True, summary=summary)
(out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(summary,indent=2))
