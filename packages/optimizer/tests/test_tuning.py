from copy import deepcopy
import json
from pathlib import Path
import threading
import time

import pytest

from flexo import DEFAULT_PARAMETERS, optimize, prepare, select_parameters
from flexo.api import parameters_checked
from flexo.instances import generate_smac
from flexo.tuning import (CachedEvaluator, configuration_space, decode, as_config,
                          pareto_front, select_presets, summarize, tolerance_failures,
                          validate_presets, tune)


def point(name, cost, quality, clean=None, carry=None, starts=4):
    return dict(id=name, parameters={**DEFAULT_PARAMETERS, "evaluations": cost, "starts": starts},
                quality=quality, by_kind=dict(clean=quality if clean is None else clean,
                                             carryover=quality if carry is None else carry))


def test_search_bounds_and_exact_budget_with_twenty_starts():
    assert DEFAULT_PARAMETERS["starts"] == 4
    space = configuration_space()
    for starts in range(1, 21):
        assert parameters_checked({"starts": starts})["starts"] == starts
        for steps in (1, 2, 16, 200, 1000):
            result = decode(dict(t_max=1., temperature_ratio=.1, starts=starts, evaluation_steps=steps))
            assert result["evaluations"] == steps*100_000
            assert decode(as_config(space, result))["evaluations"] == result["evaluations"]
    with pytest.raises(ValueError, match="1 and 20"):
        parameters_checked({"starts": 21})
    for config in space.sample_configuration(30):
        result = decode(config)
        assert 100_000 <= result["evaluations"] <= 100_000_000
        assert result["evaluations"] % 100_000 == 0
    assert decode(configuration_space(max_evaluations=100_000).get_default_configuration())["evaluations"] == 100_000
    for bad in (18_837, 250_000, 100_100_000):
        with pytest.raises(ValueError): configuration_space(max_evaluations=bad)


def test_dominance_ties_and_preset_guards():
    high = point("high", 1_000_000, 1.)
    medium = point("medium", 400_000, 1.004)
    low = point("low", 100_000, 1.019)
    dominated = point("dominated", 500_000, 1.01)
    duplicate = point("duplicate", 1_000_000, 1., starts=8)
    frontier = pareto_front([high, medium, low, dominated, duplicate])
    assert [p["id"] for p in frontier] == ["low", "medium", "high"]
    assert select_presets(frontier) == dict(low="low", medium="medium", high="high")
    # Aggregate quality is within 2%, but carryover is not.
    unsafe = point("unsafe", 100_000, 1.01, clean=.99, carry=1.03)
    assert tolerance_failures(unsafe, high, .02) == ["carryover"]
    assert select_presets([unsafe, high])["low"] == "high"
    assert select_presets([high]) == dict(low="high", medium="high", high="high")


def test_panel_quality_normalizes_each_instance_before_averaging():
    def row(kind, values):
        return dict(kind=kind, fitness=sum(values)/3,
                    samples=[dict(seed=s, fitness=v) for s, v in zip((42, 43, 44), values)])
    baseline = dict(a=row("clean", [10., 10., 10.]), b=row("carryover", [100., 100., 100.]))
    measured = dict(a=row("clean", [8., 10., 12.]), b=row("carryover", [40., 50., 60.]))
    result = summarize(measured, baseline)
    assert result["quality"] == .75
    assert result["by_kind"] == dict(clean=1., carryover=.5)
    assert result["seed_quality"] == pytest.approx([.6, .75, .9])
    assert result["seed_std"] == pytest.approx(.15)


def test_parallel_pool_is_bounded_and_cache_is_persistent(tmp_path, monkeypatch):
    import flexo.tuning as module
    barrier = threading.Barrier(3)
    calls, active, peak = [], 0, 0
    lock = threading.Lock()
    def fake(problem, parameters, seed, num_threads):
        nonlocal active, peak
        assert num_threads == 1
        with lock:
            calls.append(seed); active += 1; peak = max(peak, active)
        if len(calls) <= 3: barrier.wait(timeout=5)
        time.sleep(.01)
        with lock: active -= 1
        return dict(fitness=float(seed), total_runtime=.01)
    monkeypatch.setattr(module, "optimize", fake)
    problem = prepare(dict(now=0, machines={"A": 100}, jobs=[]))
    rows = [("example", "clean", problem)]
    evaluator = CachedEvaluator(tmp_path/"cache.sqlite3", workers=3)
    first = evaluator.panel(rows, DEFAULT_PARAMETERS, [42, 43, 44])
    assert peak == 3 and evaluator.last_panel_stats["peak_workers"] == 3
    assert [r["seed"] for r in first["example"]["samples"]] == [42, 43, 44]
    evaluator.close()
    evaluator = CachedEvaluator(tmp_path/"cache.sqlite3", workers=1)
    assert evaluator.panel(rows, DEFAULT_PARAMETERS, [42, 43, 44]) == first
    assert len(calls) == 3 and evaluator.hits == 3
    evaluator.close()


def test_serial_parallel_native_results_match(tmp_path):
    from flexo.instances import production_example
    clean = prepare(production_example())
    other = deepcopy(production_example()); other["now"] = 3
    rows = [("clean", "clean", clean), ("other", "carryover", prepare(other))]
    parameters = parameters_checked({"evaluations": 10_001, "starts": 20})
    serial = CachedEvaluator(tmp_path/"serial.sqlite3", 1)
    parallel = CachedEvaluator(tmp_path/"parallel.sqlite3", 6)
    try:
        a = serial.panel(rows, parameters, [42, 43, 44])
        b = parallel.panel(rows, parameters, [42, 43, 44])
        assert {k: [r["fitness"] for r in v["samples"]] for k, v in a.items()} == {k: [r["fitness"] for r in v["samples"]] for k, v in b.items()}
        s = optimize(clean, parameters, seed=42, num_threads=1)
        p = optimize(clean, parameters, seed=42, num_threads=20)
        assert s["schedule"] == p["schedule"]
        assert s["evaluations"] == p["evaluations"] == 10_001
    finally:
        serial.close(); parallel.close()


def test_heldout_failure_maps_to_high_without_reselection():
    frontier = [point("low", 100_000, 1.01), point("high", 1_000_000, 1.)]
    class Evaluator:
        def __init__(self): self.calls = []
        def panel(self, rows, parameters, seeds):
            self.calls.append(parameters["evaluations"])
            value = 1.1 if parameters["evaluations"] == 100_000 else 1.
            return {name: dict(kind=kind, fitness=value, seconds=.1,
                               samples=[dict(seed=s, fitness=value, seconds=.1) for s in seeds]) for name, kind, _ in rows}
    evaluator = Evaluator()
    chosen = dict(low="low", medium="high", high="high")
    selected, report = validate_presets(frontier, chosen, [("a", "clean", None), ("b", "carryover", None)], evaluator, [142, 143, 144])
    assert selected == dict(low="high", medium="high", high="high")
    assert "low" in report["fallback_reasons"]
    assert len(evaluator.calls) == 3  # Baseline and the two unique presets only.


def test_new_and_legacy_profile_selection():
    low, high = point("low", 100_000, 1.01), point("high", 1_000_000, 1.)
    profiles = dict(profiles={"100": dict(parameters=high["parameters"], frontier=[low, high],
                                          presets=dict(low="low", medium="high", high="high"))})
    assert select_parameters(90, profiles, "low")[0]["evaluations"] == 100_000
    legacy = dict(profiles={"10": dict(parameters=low["parameters"])})
    assert select_parameters(10, legacy, "low") == select_parameters(10, legacy, "high")
    with pytest.raises(ValueError): select_parameters(10, legacy, "invalid")


def test_seed_panels_require_three_independent_runs(tmp_path):
    for seeds in ([42], [42, 42, 43], [142, 43, 44]):
        with pytest.raises(ValueError, match="three distinct|disjoint"):
            tune(tmp_path, seeds=seeds)


def test_interrupted_partial_panels_preserve_completed_solves(tmp_path, monkeypatch):
    import flexo.tuning as module
    def fake(problem, parameters, seed, num_threads):
        if seed == 43: raise KeyboardInterrupt()
        return dict(fitness=1., total_runtime=.01)
    monkeypatch.setattr(module, "optimize", fake)
    problem = prepare(dict(now=0, machines={"A": 100}, jobs=[]))
    evaluator = CachedEvaluator(tmp_path/"cache.sqlite3", 1)
    with pytest.raises(KeyboardInterrupt):
        evaluator.panel([("a", "clean", problem)], DEFAULT_PARAMETERS, [42, 43, 44])
    evaluator.close()
    calls = []
    def resume(problem, parameters, seed, num_threads):
        calls.append(seed); return dict(fitness=1., total_runtime=.01)
    monkeypatch.setattr(module, "optimize", resume)
    evaluator = CachedEvaluator(tmp_path/"cache.sqlite3", 1)
    try:
        evaluator.panel([("a", "clean", problem)], DEFAULT_PARAMETERS, [42, 43, 44])
        assert 42 not in calls and 43 in calls
    finally: evaluator.close()


def test_interrupted_smac_campaign_resumes(tmp_path, monkeypatch):
    pytest.importorskip("smac")
    import flexo.tuning as module
    generate_smac(tmp_path/"data", replicas=1, previous_evaluations=100)
    settings = dict(trials=4, max_evaluations=100_000, workers=2)
    original = module.write_json
    completed = 0
    def interrupt(path, data):
        nonlocal completed
        original(path, data)
        if Path(path).parent.name == "candidates":
            completed += 1
            if completed == 2:
                raise KeyboardInterrupt()
    monkeypatch.setattr(module, "write_json", interrupt)
    with pytest.raises(KeyboardInterrupt):
        tune(tmp_path/"data", tmp_path/"profiles.json", tmp_path/"runs", **settings)
    history_path = tmp_path/"runs/N10/smac/pareto/42/runhistory.json"
    history = json.loads(history_path.read_text())
    assert history["stats"]["finished"] >= 1
    assert any(row["status"] == 0 and isinstance(row["cost"], (float, int)) for row in history["data"])
    monkeypatch.setattr(module, "write_json", original)
    result = tune(tmp_path/"data", tmp_path/"profiles.json", tmp_path/"runs", resume=True, **settings)
    assert set(result["profiles"]) == {"10", "30", "50", "100"}
    history = json.loads(history_path.read_text())
    assert history["stats"]["finished"] == 4 and history["stats"]["running"] == 0
    assert history_path.with_suffix(".before-running-cost-fix.json").exists()


def test_expanded_campaign_reuses_observations_and_cache(tmp_path, monkeypatch):
    pytest.importorskip("smac")
    import flexo.tuning as module
    generate_smac(tmp_path/"data", replicas=1, previous_evaluations=100)
    calls = []
    def solve(self, problem, parameters, seed):
        calls.append((parameters, seed))
        return dict(seed=seed, fitness=1., seconds=.01)
    monkeypatch.setattr(CachedEvaluator, "solve", solve)
    settings = dict(trials=4, workers=2, max_evaluations=100_000)
    tune(tmp_path/"data", tmp_path/"old.json", tmp_path/"old", **settings)
    original = {p.relative_to(tmp_path/"old"): p.read_bytes() for p in (tmp_path/"old").rglob("*") if p.is_file()}
    result = tune(tmp_path/"data", tmp_path/"new.json", tmp_path/"new",
                  reuse_from=tmp_path/"old", **{**settings, "max_evaluations": 200_000})
    assert result["reused"]["verified_current_solver"]
    for n in (10, 30, 50, 100):
        history = json.loads((tmp_path/f"new/N{n}/smac/pareto/42/runhistory.json").read_text())
        assert history["stats"]["finished"] == 8
        old_ids = {p.name for p in (tmp_path/f"old/N{n}/candidates").glob("*.json")}
        assert old_ids <= {p.name for p in (tmp_path/f"new/N{n}/candidates").glob("*.json")}
    assert all((tmp_path/"old"/p).read_bytes() == raw for p, raw in original.items())
    db = CachedEvaluator(tmp_path/"new/solves.sqlite3", 1)
    try:
        rows = module.load_dataset(tmp_path/"data")[0]["train"][10]
        profile = json.loads((tmp_path/"old/N10/profile.json").read_text())
        before = len(calls)
        db.panel(rows, profile["baseline_parameters"], [42, 43, 44])
        assert db.hits == 6 and len(calls) == before
    finally:
        db.close()
    resumed = tune(tmp_path/"data", tmp_path/"new.json", tmp_path/"new", resume=True,
                   **{**settings, "max_evaluations": 200_000})
    assert resumed["profiles"] == result["profiles"]
    monkeypatch.setattr(CachedEvaluator, "solve", lambda self, p, params, seed: dict(seed=seed, fitness=2., seconds=.01))
    with pytest.raises(ValueError, match="Cached fitness differs"):
        tune(tmp_path/"data", tmp_path/"bad.json", tmp_path/"bad", reuse_from=tmp_path/"old", **settings)
