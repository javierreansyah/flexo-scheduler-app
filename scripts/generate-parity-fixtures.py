
"""Refresh browser reference fixtures using the native Python extension."""
import json,sys
from pathlib import Path
root=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root/'packages/optimizer'))
from flexo import optimize
from flexo.instances import production_example
base=production_example();base['jobs']=[dict(j,id=str(j['id'])) for j in base['jobs'][:10]]
parameters=dict(evaluations=2003,starts=3,stage_length=100,t_max=.5,t_min=.001,rcl_alpha=.4,p_inter=.5,p_shift=.5,p_block=.3)
first=optimize(base,parameters,seed=42,num_threads=1)
carry=json.loads(json.dumps(base));carry['now']=1.;carry['locked']={m:[j for j in jobs if j['setup_start']<=1] for m,jobs in first['schedule'].items()}
carry['jobs'].append(dict(id='new',quantity=7000,inks=[1,2],arrival_time=1.))
custom=dict(now=7,machines={'A':100,'B':150},jobs=[dict(id='a',quantity=6000,inks=[1],arrival_time=0),dict(id='b',quantity=12000,inks=[2],arrival_time=0)],setup_durations={'empty':{'1':.25,'2':.5},'1':{'2':1.5}},ink_costs={'empty':{'empty':0,'1':.2,'2':.3},'1':{'empty':.5,'1':0,'2':1.2},'2':{'empty':1.,'1':.7,'2':0}})
fixtures=[]
for name,s in [('clean',base),('carryover',carry),('custom',custom)]:
 result=optimize(s,parameters,seed=42,num_threads=1)
 fixtures.append(dict(name=name,snapshot=s,parameters=parameters,seed='42',expected={k:result[k] for k in ('fitness','ink_changes','batch_flow_time','makespan')}))
(root/'apps/web/e2e/native-fixtures.json').write_text(json.dumps(fixtures,indent=2)+'\n')
