
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
