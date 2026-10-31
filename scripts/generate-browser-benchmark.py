
import json,sys
from pathlib import Path
root=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root/'packages/optimizer'))
from experiments.benchmark import cases,ORIGINAL_PARAMETERS
from flexo.validation import run_validation
rows=[]
for path,data in cases(root/'packages/optimizer/instances/validation'):
 result=run_validation(data,ORIGINAL_PARAMETERS,seed=42,num_threads=0)
 rows.append(dict(name=path.name,data=data,native_fitness=result['fitness'],native_seconds=result['total_runtime']))
out=root/'packages/optimizer/tmp/browser-benchmark-input.json';out.parent.mkdir(exist_ok=True)
out.write_text(json.dumps(dict(parameters=ORIGINAL_PARAMETERS,cases=rows)))
