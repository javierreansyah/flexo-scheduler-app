import json
import shutil

import pytest
from ConfigSpace import ConfigurationSpace, Float
from smac import Scenario

from flexo.smac_resume import check_resume_scenario


def test_relocated_scenario_preserves_history_and_rejects_changed_settings(tmp_path):
    space = ConfigurationSpace(seed=42)
    space.add(Float('x', (0., 1.)))
    original = Scenario(space, name='fixed', output_directory=tmp_path/'old', n_trials=10)
    object.__setattr__(original, '_meta', {'algorithm': 'unchanged'})
    original.save()
    history = original.output_directory/'runhistory.json'
    history.write_text('{"stats":{"finished":9,"running":1}}')
    destination = tmp_path/'copied'
    shutil.copytree(original.output_directory, destination/'fixed/0')
    current = Scenario(space, name='fixed', output_directory=destination, n_trials=10)
    object.__setattr__(current, '_meta', original._meta)
    check_resume_scenario(current)
    assert json.loads((current.output_directory/'scenario.json').read_text())['output_directory'] == str(current.output_directory)
    assert (current.output_directory/'runhistory.json').read_bytes() == history.read_bytes()
    assert json.loads((original.output_directory/'scenario.json').read_text())['output_directory'] == str(original.output_directory)
    object.__setattr__(current, 'n_trials', 11)
    before = (current.output_directory/'scenario.json').read_bytes()
    with pytest.raises(ValueError, match='refusing to overwrite'):
        check_resume_scenario(current)
    assert (current.output_directory/'scenario.json').read_bytes() == before
