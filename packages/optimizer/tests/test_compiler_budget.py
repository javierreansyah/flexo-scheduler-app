import json
from types import SimpleNamespace

from experiments import compiler_benchmark as module
from flexo.instances import generate_smac


def test_saved_parameter_budget_is_not_replaced_by_cli_default(tmp_path, monkeypatch):
    generate_smac(tmp_path/'instances/smac', replicas=1, previous_evaluations=100)
    monkeypatch.setattr(module, 'ROOT', tmp_path)
    parameters = tmp_path/'parameters.json'
    parameters.write_text(json.dumps(dict(evaluations=101)))
    output = tmp_path/'panel.json'
    module.panel(SimpleNamespace(package=str(tmp_path), replica=0, dataset='heldout',
                                evaluations=5_000_000, parameters=str(parameters),
                                budget_file=None, seed=142, workers=2, output=str(output)))
    result = json.loads(output.read_text())
    assert result['parameters']['evaluations'] == 101
    assert len(result['rows']) == 40
    assert all(row['evaluations'] == 101 for row in result['rows'])
