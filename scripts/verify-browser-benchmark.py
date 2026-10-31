
import json,sys
from pathlib import Path
root=Path(__file__).resolve().parents[1];sys.path.insert(0,str(root/'packages/optimizer'))
from flexo import evaluate
p=root/'packages/optimizer/results/browser-benchmark/report.json';report=json.loads(p.read_text())
for row in report['rows']:
    for trace in row['traces']:
        check=evaluate(trace['snapshot'],trace['result']['schedule'])
        for key in ('fitness','ink_changes','batch_flow_time','makespan'):
            if abs(check[key]-trace['result'][key])>1e-8:raise AssertionError((row['instance'],key))
report['independent_rescore_passed']=True;p.write_text(json.dumps(report,indent=2)+'\n')
print('All browser benchmark horizons independently rescored successfully.')
