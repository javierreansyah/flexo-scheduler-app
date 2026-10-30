from copy import deepcopy
import json
from pathlib import Path

import pytest

from flexo import optimize, prepare
from flexo.instances import generate_smac, generate_validation
from flexo.tuning import decode, load_dataset, normalized, tune
from flexo.validation import run_validation


def test_generated_snapshots_have_exact_sizes_and_no_future(tmp_path):
    paths = generate_smac(tmp_path/"smac", replicas=2, previous_evaluations=300)
    assert len(paths) == 24
    for path in paths:
        data = json.loads(path.read_text())
        p = prepare(data)
        assert len(p.machines) == 3
        assert len(p.movable) == data["meta"]["movable_jobs"]
        assert all(j["arrival_time"] <= data["now"] for j in p.jobs.values())
        if data["meta"]["kind"] == "carryover":
            assert any(p.locked.values())
            assert any(p.jobs[j]["arrival_time"] < data["now"] for j in p.movable)
        frozen = path.read_bytes()
        optimize(p, {"evaluations": 200, "starts": 2}, debug=True)
        assert path.read_bytes() == frozen
    _, first_hash = load_dataset(tmp_path/"smac")
    generated_again = generate_smac(tmp_path/"again", replicas=2, previous_evaluations=300)
    assert [p.read_bytes() for p in paths] == [p.read_bytes() for p in generated_again]
    assert load_dataset(tmp_path/"again")[1] == first_hash


def test_original_validation_is_preserved_and_capped():
    files = list(Path("instances/validation").glob("*.json"))
    assert len(files) == 200
    assert {len(json.loads(p.read_text())["orders_data"]) for p in files} == {15, 30, 50, 100}
    for path in [Path("instances/validation/N15_K3_rho1.5_rep00.json"), Path("instances/validation/N100_K2_rho1.0_rep00.json")]:
        data = json.loads(path.read_text())
        result = run_validation(data, {"evaluations": 700, "starts": 2}, num_threads=2)
        assert len(result["horizons"]) == data["meta"]["k"]
        assert sum(map(len, result["schedule"].values())) == len(data["orders_data"])
    invalid = deepcopy(data)
    invalid["orders_data"] = [{}]*101
    with pytest.raises(ValueError, match="100"):
        run_validation(invalid)


def test_validation_generator_never_generates_n200(tmp_path):
    paths = generate_validation(tmp_path, replicas=1)
    assert len(paths) == 20
    assert max(len(json.loads(p.read_text())["orders_data"]) for p in paths) == 100


def test_tuning_smoke_exports_three_profiles(tmp_path):
    pytest.importorskip("smac")
    generate_smac(tmp_path/"data", replicas=1, previous_evaluations=200)
    result = tune(tmp_path/"data", tmp_path/"profiles.json", tmp_path/"runs", trials=2,
                  evaluations=200, seeds=[42], num_threads=1)
    assert set(result["profiles"]) == {"10", "30", "50"}
    for n in (10, 30, 50):
        assert result["profiles"][str(n)]["parameters"]["evaluations"] == 200
        assert (tmp_path/f"runs/N{n}/evaluations.jsonl").exists()
    snapshot = json.loads((tmp_path/"data/heldout/N30_carryover_00.json").read_text())
    solved = optimize(snapshot, profiles=tmp_path/"profiles.json")
    assert solved["profile_size"] == 30 and solved["evaluations"] == 200
    with pytest.raises(ValueError, match="already"):
        tune(tmp_path/"data", tmp_path/"profiles.json", tmp_path/"runs", trials=1, evaluations=100, seeds=[42])


def test_zero_baselines_and_valid_temperatures():
    assert normalized({"a": {"fitness": 0.}}, {"a": {"fitness": 0.}}) == 0.
    assert normalized({"a": {"fitness": 1.}}, {"a": {"fitness": 0.}}) == 1e12
    config = dict(t_max=.01, temperature_ratio=.99, starts=2)
    assert 0 < decode(config, 17)["t_min"] < decode(config, 17)["t_max"]
