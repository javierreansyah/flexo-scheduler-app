from copy import deepcopy
import json
from pathlib import Path

import pytest

from flexo import optimize, prepare
from flexo.instances import generate_smac, generate_validation
from flexo.tuning import load_dataset, tune
from flexo.validation import run_validation


def test_generated_snapshots_have_exact_sizes_and_no_future(tmp_path):
    paths = generate_smac(tmp_path/"smac", replicas=2, previous_evaluations=300)
    assert len(paths) == 32
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


def test_pareto_smoke_exports_four_profiles_and_resumes(tmp_path):
    pytest.importorskip("smac")
    generate_smac(tmp_path/"data", replicas=1, previous_evaluations=100)
    settings = dict(trials=8, max_evaluations=200_000, workers=3)
    result = tune(tmp_path/"data", tmp_path/"profiles.json", tmp_path/"runs", **settings)
    assert result["mode"] == "parego"
    assert set(result["profiles"]) == {"10", "30", "50", "100"}
    for n in (10, 30, 50, 100):
        profile = result["profiles"][str(n)]
        assert set(profile["presets"]) == {"low", "medium", "high"}
        for point in profile["frontier"]:
            assert 100_000 <= point["parameters"]["evaluations"] <= 200_000
            assert point["parameters"]["evaluations"] % 100_000 == 0
            assert 1 <= point["parameters"]["starts"] <= 10
            assert all(len(r["samples"]) == 3 for r in point["measurements"].values())
        assert (tmp_path/f"runs/N{n}/frontier.png").exists()
        assert (tmp_path/f"runs/N{n}/frontier.csv").exists()
        history = json.loads((tmp_path/f"runs/N{n}/smac/pareto/42/runhistory.json").read_text())
        assert any("Search" in origin for origin in history["config_origins"].values())
    snapshot = json.loads((tmp_path/"data/heldout/N30_carryover_00.json").read_text())
    solved = optimize(snapshot, profiles=tmp_path/"profiles.json", preset="low")
    assert solved["profile_size"] == 30 and solved["preset"] == "low"
    with pytest.raises(ValueError, match="already"):
        tune(tmp_path/"data", tmp_path/"profiles.json", tmp_path/"runs", **settings)
    resumed = tune(tmp_path/"data", tmp_path/"profiles.json", tmp_path/"runs", resume=True, **settings)
    assert resumed["profiles"] == result["profiles"]
    with pytest.raises(ValueError, match="differ"):
        tune(tmp_path/"data", tmp_path/"profiles.json", tmp_path/"runs", resume=True, **{**settings, "trials": 9})
    old = tmp_path/"old"
    old.mkdir()
    (old/"manifest.json").write_text(json.dumps(dict(schema_version=3)))
    with pytest.raises(ValueError, match="older tuning format"):
        tune(tmp_path/"data", tmp_path/"profiles.json", old, resume=True, **settings)
