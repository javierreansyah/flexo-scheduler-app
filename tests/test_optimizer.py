from collections import Counter
from copy import deepcopy
from itertools import combinations_with_replacement, permutations
import math
import json
import random

import pytest

from flexo import DEFAULT_PARAMETERS, evaluate, optimize, prepare, select_parameters
from flexo import _core
from flexo.instances import production_example

FAST = dict(evaluations=2000, starts=3, stage_length=37, t_max=5., t_min=.001)


def snapshot(jobs=None, now=0, machines=None, **kwargs):
    return dict(now=now, machines=machines or {"A": 100., "B": 200., "C": 150.},
                jobs=jobs or [], **kwargs)


def job(job_id="1", quantity=6000, inks=(6,), arrival=0.):
    return dict(id=job_id, quantity=quantity, inks=list(inks), arrival_time=arrival)


def brute_cost(a, b, matrix):
    common = Counter(a) & Counter(b)
    rem = list((Counter(a)-common).elements())
    add = list((Counter(b)-common).elements())
    n = max(len(rem), len(add))
    rem += [0]*(n-len(rem))
    add += [0]*(n-len(add))
    return min((sum(matrix[x][y] for x, y in zip(rem, perm)) for perm in permutations(add)), default=0)


def test_minimum_matching_exhaustive():
    patterns = [p for n in range(4) for p in combinations_with_replacement(range(1, 4), n)]
    rng = random.Random(42)
    matrices = [[[float(i > j) for j in range(4)] for i in range(4)],
                [[0. if i == j else rng.random()*3 for j in range(4)] for i in range(4)]]
    for matrix in matrices:
        for a in patterns:
            for b in patterns:
                assert _core.changeover(list(a), list(reversed(b)), matrix) == pytest.approx(brute_cost(a, b, matrix))


def check_schedule(data, result):
    seen = set()
    completions = {}
    total_ink = 0
    for machine, entries in result["schedule"].items():
        clock = data.get("machine_states", {}).get(machine, {}).get("available_time", 0)
        for entry in entries:
            assert entry["id"] not in seen
            seen.add(entry["id"])
            assert entry["setup_start"] >= max(clock, entry["arrival_time"]) - 1e-9
            assert entry["start"] >= entry["setup_start"]
            assert entry["completion"] == pytest.approx(entry["start"]+entry["quantity"]/data["machines"][machine]/60)
            end = (math.floor(entry["setup_start"]/8)+1)*8
            assert entry["completion"] <= end + 1e-9
            if not entry["locked"]:
                assert entry["setup_start"] >= data["now"]
            total_ink += entry["ink_change_cost"]
            completions[entry["arrival_time"]] = max(completions.get(entry["arrival_time"], 0), entry["completion"])
            clock = entry["completion"]
    assert seen == {str(j["id"]) for j in data["jobs"]}
    flow = sum(done-arrival for arrival, done in completions.items())/len(completions) if completions else 0
    assert result["ink_changes"] == pytest.approx(total_ink)
    assert result["batch_flow_time"] == pytest.approx(flow)
    assert result["fitness"] == pytest.approx(data.get("ink_weight", .4)*total_ink+data.get("batch_flow_time_weight", .6)*flow)


@pytest.mark.parametrize("inter,shift,block", [(i, s, b) for i in (0., 1.) for s in (0., 1.) for b in (0., 1.)])
def test_every_move_family_and_undo(inter, shift, block):
    rng = random.Random(21)
    jobs = [job(str(i), rng.randint(1000, 18000), [rng.randrange(1, 10) for _ in range(rng.randrange(1, 5))]) for i in range(35)]
    data = snapshot(jobs)
    result = optimize(data, {**FAST, "p_inter": inter, "p_shift": shift, "p_block": block}, seed=4, debug=True)
    check_schedule(data, result)
    assert evaluate(data, result["schedule"])["fitness"] == pytest.approx(result["fitness"])


def test_multithreading_and_budget_are_deterministic():
    data = production_example()
    params = {**FAST, "evaluations": 1001, "starts": 7}
    single = optimize(data, params, seed=123, num_threads=1)
    parallel = optimize(data, params, seed=123, num_threads=4)
    assert single["schedule"] == parallel["schedule"]
    assert single["fitness"] == parallel["fitness"]
    assert single["evaluations"] == parallel["evaluations"] == 1001


@pytest.mark.parametrize("groups", [1, 2, 3, 5])
def test_specialized_and_generic_arrival_groups(groups):
    rng = random.Random(319)
    jobs = [job(str(i), rng.randint(1000, 18000), [rng.randint(1, 9)], arrival=i % groups) for i in range(35)]
    data = snapshot(jobs, now=6)
    result = optimize(data, FAST, seed=319, num_threads=2, debug=True)
    check_schedule(data, result)
    assert evaluate(data, result["schedule"])["fitness"] == pytest.approx(result["fitness"])


def test_carryover_preserves_locked_times_and_original_arrivals():
    data = production_example()
    first = optimize(data, FAST, seed=4)
    now = min(j["completion"] for entries in first["schedule"].values() for j in entries)/2
    locked = {m: [deepcopy(j) for j in entries if j["setup_start"] <= now] for m, entries in first["schedule"].items()}
    data.update(now=now, locked=locked)
    data["jobs"].append(job("new", 7000, [2, 3], now))
    result = optimize(data, FAST, seed=5, debug=True)
    check_schedule(data, result)
    for m, entries in locked.items():
        for before, after in zip(entries, result["schedule"][m]):
            for key in ("id", "setup_start", "start", "completion"):
                assert before[key] == after[key]
    assert any(j["arrival_time"] < now for entries in result["schedule"].values() for j in entries if not j["locked"])
    broken = deepcopy(result["schedule"])
    m = next(m for m in locked if locked[m])
    broken[m][0]["completion"] += 1
    with pytest.raises(ValueError, match="prefix"):
        evaluate(data, broken)


def test_empty_and_fully_locked():
    assert optimize(snapshot(), FAST)["fitness"] == 0
    first = optimize(snapshot([job()]), FAST)
    data = snapshot([job()], now=.1, locked=first["schedule"])
    second = optimize(data, FAST)
    assert second["movable_jobs"] == second["evaluations"] == 0
    assert second["fitness"] == first["fitness"]
    check_schedule(data, second)


def test_no_past_scheduling_and_shift_deferral():
    data = snapshot([job(quantity=12000)], now=7.5, machines={"A": 100})
    result = optimize(data, FAST)
    assert result["schedule"]["A"][0]["setup_start"] == 8
    check_schedule(data, result)
    data = snapshot([job(inks=[1])], now=2.5)
    assert min(j["setup_start"] for seq in optimize(data, FAST)["schedule"].values() for j in seq) >= 2.5


def test_oversized_assignments_are_excluded():
    data = snapshot([job(quantity=60000)], machines={"slow": 100, "fast": 200})
    r = optimize(data, FAST, debug=True)
    assert not r["schedule"]["slow"]
    assert len(r["schedule"]["fast"]) == 1
    with pytest.raises(ValueError, match="Job 1 cannot fit"):
        optimize(snapshot([job(quantity=100000)], machines={"A": 100}), FAST)


def test_shift_end_reset_is_free():
    data = snapshot([job("a", 48000, [9]), job("b", 6000, [1])], machines={"A": 100})
    r = evaluate(data, {"A": ["a", "b"]})
    assert r["schedule"]["A"][1]["setup_start"] == 8
    assert r["ink_changes"] == 0
    # A machine that finished exactly at 8 is also clean after an idle gap.
    assert _core.step(8., 8.5, 1., 1., 0., .75) == pytest.approx([8.5, 8.5, 9.5, 0.])


def test_custom_costs_keep_parallel_cleaning_duration():
    labels = ["empty", "1", "2", "3"]
    costs = {a: {b: 0. if a == b else 2. for b in labels} for a in labels}
    data = snapshot([job("a", inks=[2, 3]), job("b", inks=[1, 1])], machines={"A": 100}, ink_costs=costs)
    r = evaluate(data, {"A": ["a", "b"]})
    for entry in r["schedule"]["A"]:
        assert entry["start"]-entry["setup_start"] == .75
        assert entry["ink_change_cost"] == 4.


def test_invalid_inputs_and_schedule():
    for data in (snapshot([job(arrival=1)]), snapshot([job(), job()]), snapshot([job(quantity=-1)]),
                 snapshot([job(inks=[0])]), snapshot([job()], machines={"A": 0})):
        with pytest.raises(ValueError):
            prepare(data)
    data = snapshot([job()])
    for params in ({"stage_length": 0}, {"t_min": 500}, {"p_inter": float("nan")}, {"typo": 3}):
        with pytest.raises(ValueError):
            optimize(data, params)
    with pytest.raises(ValueError, match="Missing"):
        evaluate(data, {"A": [], "B": [], "C": []})
    with pytest.raises(ValueError, match="duplicate"):
        evaluate(data, {"A": ["1", "1"], "B": [], "C": []})


def test_profile_routing_and_overrides():
    profiles = {"profiles": {str(n): {"parameters": {**FAST, "evaluations": n}} for n in (10, 30, 50)}}
    for count, expected in [(0, 10), (10, 10), (20, 30), (29, 30), (40, 50), (100, 50)]:
        params, size = select_parameters(count, profiles)
        assert size == params["evaluations"] == expected
    assert select_parameters(10, {}) == (DEFAULT_PARAMETERS, None)
    r = optimize(snapshot([job()]), {**FAST, "evaluations": 7}, profiles=profiles)
    assert r["profile_size"] is None and r["evaluations"] == 7


def test_default_profile_export_is_loaded_from_working_directory(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    (tmp_path/"flexo").mkdir()
    (tmp_path/"flexo/profiles.json").write_text(json.dumps({"profiles": {"10": {"parameters": FAST}}}))
    result = optimize(snapshot([job()]))
    assert result["profile_size"] == 10 and result["evaluations"] == FAST["evaluations"]
