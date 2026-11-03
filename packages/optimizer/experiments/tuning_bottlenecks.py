"""Read saved tuning metrics; never submits a solve or modifies checkpoints."""
import argparse
import json
from pathlib import Path
import statistics as st


def summarize(root):
    result=[]
    for folder in sorted(root.glob('N*/budget-*')):
        history=json.loads((folder/'smac/fixed/42/runhistory.json').read_text())
        execution=[c['execution'] for p in (folder/'candidates').glob('*.json')
                   if (c:=json.loads(p.read_text())).get('execution',{}).get('computed',0)>=50]
        rows=sorted((x for x in history['data'] if x['endtime']>x['starttime']),key=lambda x:x['starttime'])
        gaps=[b['starttime']-a['endtime'] for a,b in zip(rows,rows[1:]) if 0<=b['starttime']-a['endtime']<300]
        wall=st.median(x['wall_seconds'] for x in execution) if execution else None
        scenario=json.loads((folder/'smac/fixed/42/scenario.json').read_text())
        remaining=max(0,scenario['n_trials']-history['stats']['finished'])
        result.append(dict(campaign=str(folder.relative_to(root)),finished=history['stats']['finished'],
                           remaining=remaining,panel_median_seconds=wall,
                           busy_cpus_median=st.median(x['cpu_seconds']/x['wall_seconds'] for x in execution) if execution else None,
                           intertrial_median_seconds=st.median(gaps) if gaps else None,
                           estimated_remaining_hours=remaining*wall/3600 if wall else None))
    return result


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('workdir',type=Path)
    print(json.dumps(summarize(p.parse_args().workdir),indent=2))
