from copy import deepcopy
import json
from pathlib import Path

import pytest

from flexo import DEFAULT_PARAMETERS, optimize, prepare
from flexo.api import parameters_checked
from flexo.tuning import (CachedEvaluator, configuration_space, decode, quality_failures,
                          reduce_budget, tune)
from flexo.instances import generate_smac


def test_start_limit_and_reduction_budget():
    from flexo.tuning import REFERENCE_BUDGET, EVALUATION_STEP, as_config
    assert DEFAULT_PARAMETERS["starts"] == 4
    assert REFERENCE_BUDGET == 10_000_000 and EVALUATION_STEP == 100_000
    space = configuration_space(reduction_budget=REFERENCE_BUDGET)
    for starts in (1, 2, 3, 4):
        assert parameters_checked({"starts": starts})["starts"] == starts
        for steps in (1, 2, 16, 100):
            result = decode(dict(t_max=1., temperature_ratio=.1, starts=starts, evaluation_steps=steps), REFERENCE_BUDGET)
            assert result["evaluations"] == steps*100_000
            config = as_config(space, result, True)
            assert decode(config, REFERENCE_BUDGET)["evaluations"] == result["evaluations"]
    with pytest.raises(ValueError, match="1 and 4"):
        parameters_checked({"starts": 5})
    for config in space.sample_configuration(30):
        result = decode(config, REFERENCE_BUDGET)
        assert 100_000 <= result["evaluations"] <= REFERENCE_BUDGET
        assert result["evaluations"] % 100_000 == 0
    for invalid in (18_837, 250_000):
        with pytest.raises(ValueError, match="100"):
            configuration_space(reduction_budget=invalid)
    single = configuration_space(reduction_budget=100_000)
    assert decode(single.get_default_configuration(), 100_000)["evaluations"] == 100_000
    with pytest.raises(ValueError, match="exceeds"):
        decode(dict(t_max=1., temperature_ratio=.1, starts=3, evaluation_steps=101), REFERENCE_BUDGET)


def test_per_instance_gate_and_floating_tolerance():
    reference = {"a": {"fitness": 10.}, "b": {"fitness": 10.}}
    # A better aggregate cannot hide a regression on a different instance.
    assert quality_failures({"a": {"fitness": 1.}, "b": {"fitness": 11.}}, reference)[0]["instance"] == "b"
    assert not quality_failures({"a": {"fitness": 10.+1e-10}}, reference)
    assert quality_failures({"a": {"fitness": 10.+1e-6}}, reference)


def test_default_reference_is_uniform_10m_without_pilot(tmp_path, monkeypatch):
    import flexo.tuning as module
    generate_smac(tmp_path/"data", replicas=1, previous_evaluations=100)
    def capture(rows, evaluator, seeds, budget, calls, seed, directory):
        assert budget == 10_000_000
        assert not (directory/"pilot.json").exists()
        raise RuntimeError("reference reached directly")
    monkeypatch.setattr(module, "reference_tuning", capture)
    with pytest.raises(RuntimeError, match="reference reached directly"):
        tune(tmp_path/"data", workdir=tmp_path/"run")
    manifest = json.loads((tmp_path/"run/manifest.json").read_text())
    assert manifest["reference_budgets"] == {str(n): 10_000_000 for n in (10, 30, 50, 100)}
    assert manifest["evaluation_step"] == 100_000


def test_completed_three_seed_solves_survive_reopening(tmp_path, monkeypatch):
    import flexo.tuning as module
    calls = []
    def fake(problem, parameters, seed, threads):
        calls.append(seed)
        return dict(fitness=float(seed), total_runtime=.01)
    monkeypatch.setattr(module, "optimize", fake)
    problem = prepare(dict(now=0, machines={"A": 100}, jobs=[]))
    row = ("example", "clean", problem)
    evaluator = CachedEvaluator(tmp_path/"cache.sqlite3", 0)
    first = evaluator.measure(row, DEFAULT_PARAMETERS, [42, 43, 44])
    assert len(first["samples"]) == 3 and calls == [42, 43, 44]
    evaluator.close()
    evaluator = CachedEvaluator(tmp_path/"cache.sqlite3", 0)
    assert evaluator.measure(row, DEFAULT_PARAMETERS, [42, 43, 44]) == first
    assert calls == [42, 43, 44] and evaluator.hits == 3
    evaluator.measure(row, {**DEFAULT_PARAMETERS, "evaluations": 100}, [42, 43, 44])
    assert len(calls) == 6
    evaluator.close()


def test_seed_panels_require_three_independent_runs(tmp_path):
    for seeds in ([42], [42, 42, 43], [142, 43, 44]):
        with pytest.raises(ValueError, match="three distinct|disjoint"):
            tune(tmp_path, seeds=seeds)


def test_early_rejection_and_heldout_fallback(tmp_path):
    pytest.importorskip("smac")
    class Evaluator:
        def __init__(self): self.calls = []
        def measure(self, row, parameters, seeds):
            self.calls.append((row[0], parameters["evaluations"], tuple(seeds)))
            # Shorter candidates fail immediately; equal reference with a
            # different parameter configuration can pass training but not heldout.
            value = 2. if parameters["evaluations"] < 200_000 else 1.
            return dict(kind=row[1], fitness=value, seconds=.1, samples=[])
        def panel(self, rows, parameters, seeds):
            return {row[0]: self.measure(row, parameters, seeds) for row in rows}
    params = parameters_checked({"evaluations": 200_000})
    reference = dict(parameters=params, instances={"a": dict(fitness=1., kind="clean"), "b": dict(fitness=1., kind="carryover")})
    evaluator = Evaluator()
    result = reduce_budget([("a", "clean", None), ("b", "carryover", None)],
                           [("ha", "clean", None), ("hb", "carryover", None)], evaluator,
                           [42, 43, 44], [142, 143, 144], reference, 5, 42, tmp_path)
    rejected = [json.loads(line) for line in (tmp_path/"reduction-trials.jsonl").read_text().splitlines() if not json.loads(line)["feasible"]]
    assert rejected and all(len(r["instances"]) == 1 for r in rejected)
    assert result["parameters"] == params
    assert not result["accepted_reduction"]


def test_rejected_heldout_candidate_never_becomes_runtime_profile(tmp_path):
    # Completed SMAC state can be replayed from the solve cache without tuning
    # on heldout results. Force a smaller training-passing candidate via history.
    pytest.importorskip("smac")
    params = parameters_checked({"evaluations": 200_000})
    shorter = {**params, "evaluations": 100_000}
    reference = dict(parameters=params, instances={"a": dict(fitness=1., kind="clean"), "b": dict(fitness=1., kind="carryover")})
    candidate = dict(parameters=shorter, feasible=True, complete=True, normalized_fitness=1., instances=deepcopy(reference["instances"]))
    (tmp_path/"reduction-trials.jsonl").write_text(json.dumps(candidate)+"\n")
    class Evaluator:
        def measure(self, row, parameters, seeds):
            return dict(kind=row[1], fitness=1., seconds=.1)
        def panel(self, rows, parameters, seeds):
            value = 2. if parameters["evaluations"] < 200_000 else 1.
            return {r[0]: dict(kind=r[1], fitness=value, seconds=.1) for r in rows}
    result = reduce_budget([("a", "clean", None), ("b", "carryover", None)],
                           [("ha", "clean", None), ("hb", "carryover", None)], Evaluator(),
                           [42, 43, 44], [142, 143, 144], reference, 2, 42, tmp_path)
    assert result["candidate_parameters"]["evaluations"] < 200_000
    assert len(result["heldout_failures"]) == 2
    assert result["parameters"] == params


def test_interrupted_smac_campaign_resumes(tmp_path, monkeypatch):
    pytest.importorskip("smac")
    import flexo.tuning as module
    generate_smac(tmp_path/"data", replicas=1, previous_evaluations=100)
    settings = dict(reference_calls=4, reduction_trials=4, evaluations=100_000, num_threads=1)
    original = module.log_trial
    interrupted = False
    def interrupt(path, row):
        nonlocal interrupted
        original(path, row)
        if Path(path).name == "reference-trials.jsonl" and not interrupted:
            interrupted = True
            raise KeyboardInterrupt()
    monkeypatch.setattr(module, "log_trial", interrupt)
    with pytest.raises(KeyboardInterrupt):
        tune(tmp_path/"data", tmp_path/"profiles.json", tmp_path/"runs", **settings)
    monkeypatch.setattr(module, "log_trial", original)
    result = tune(tmp_path/"data", tmp_path/"profiles.json", tmp_path/"runs", resume=True, **settings)
    assert set(result["profiles"]) == {"10", "30", "50", "100"}
