
import pytest
from flexo import optimize,evaluate

def test_directed_setup_duration_and_empty_reset():
    s=dict(now=0,machines={'A':100},jobs=[dict(id='a',quantity=6000,inks=[1],arrival_time=0),dict(id='b',quantity=6000,inks=[2],arrival_time=0)],setup_durations={'empty':{'1':.25,'2':.5},'1':{'2':1.5},'2':{'1':.125}})
    a=evaluate(s,{'A':['a','b']})
    assert a['schedule']['A'][0]['start']==.25
    assert a['schedule']['A'][1]['start']==2.75
    assert evaluate(s,{'A':['b','a']})['makespan']==2.625
    out=optimize(s,{'evaluations':100,'starts':2},debug=True)
    assert evaluate(s,out['schedule'])['fitness']==out['fitness']
    s['now']=.5;s['locked']={'A':[a['schedule']['A'][0]]}
    assert optimize(s,{'evaluations':100})['schedule']['A'][0]['completion']==1.25

def test_duration_shift_deferral_and_validation():
    s=dict(now=7,machines={'A':100},jobs=[dict(id='a',quantity=6000,inks=[1],arrival_time=0)],setup_durations={'empty':{'1':.5}})
    out=optimize(s,{'evaluations':10})
    assert out['schedule']['A'][0]['setup_start']==8
    assert out['schedule']['A'][0]['start']==8.5
    s['setup_durations']={'empty':{'1':9}}
    with pytest.raises(ValueError):optimize(s)
    s['setup_durations']={'unknown':{'1':0}}
    with pytest.raises(ValueError):optimize(s)


def test_industry_matrix_catalog_and_custom_cost_reach_evaluator():
    labels=['empty']+list(map(str,range(1,10)))
    matrix={a:{b:float(int(a if a!='empty' else 0)>int(b if b!='empty' else 0)) for b in labels} for a in labels}
    s=dict(now=0,machines={'A':100},machine_states={'A':dict(available_time=0,inks=[9])},jobs=[dict(id='probe',quantity=6000,inks=[1],arrival_time=0)])
    legacy=evaluate(s,{'A':['probe']})
    s['ink_costs']=matrix
    assert evaluate(s,{'A':['probe']})==legacy
    matrix['9']['1']=3
    out=optimize(s,{'evaluations':100})
    assert out['ink_changes']==3
    assert out['fitness']==pytest.approx(2.25)
    matrix['8']['8']=-1
    with pytest.raises(ValueError):optimize(s)
