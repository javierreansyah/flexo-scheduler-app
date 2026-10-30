import json
import math
import random

import pytest

from experiments.benchmark import ORIGINAL_PARAMETERS, sweep, compare
from flexo import _core


def reference_step(time, arrival, proc, cost, empty_cost, setup):
    earliest = max(time, arrival)
    if earliest >= 8 and (math.floor(earliest/8) > math.floor(time/8) or (time >= 8 and math.fmod(time, 8) == 0)):
        cost = empty_cost
    duration = setup if cost > 0 else 0
    end = (math.floor(earliest/8)+1)*8
    if earliest+duration+proc > end+1e-10:
        earliest, cost = end, empty_cost
        duration = setup if cost > 0 else 0
    done = math.inf if duration+proc > 8+1e-10 else earliest+duration+proc
    return [earliest, earliest if math.isinf(done) else earliest+duration, done, cost]


def test_shift_arithmetic_matches_original_formula():
    rng = random.Random(42)
    times = [k*8+delta for k in range(1, 100) for delta in (-1e-10, 0, 1e-10)]
    times += [rng.uniform(0, 800) for _ in range(2000)]
    for time in times:
        arrival = time + rng.choice([0, 0, rng.uniform(0, 10)])
        proc, cost, empty_cost, setup = rng.uniform(.01, 10), rng.randrange(3), rng.randrange(3), rng.uniform(0, 2)
        assert _core.step(time, arrival, proc, cost, empty_cost, setup) == reference_step(time, arrival, proc, cost, empty_cost, setup)


def test_benchmark_uses_five_cases_and_original_parameters(tmp_path, monkeypatch):
    import experiments.benchmark as benchmark
    data = tmp_path/"data"; data.mkdir()
    for name, n in [("N15_K1_static_rep00", 15), ("N50_K1_static_rep00", 50), ("N100_K1_static_rep00", 100),
                    ("N50_K2_rho1.5_rep00", 50), ("N100_K3_rho1.5_rep00", 100)]:
        (data/f"{name}.json").write_text(json.dumps(dict(orders_data=[dict(id=i) for i in range(n)])))
    calls = []
    def fake(instance, params, seed, num_threads):
        calls.append((len(instance["orders_data"]), params, num_threads))
        return dict(horizons=[{}], schedule={}, fitness=1, ink_changes=0, batch_flow_time=1, makespan=1)
    monkeypatch.setattr(benchmark, "run_validation", fake)
    a = sweep(data, tmp_path/"a")
    sweep(data, tmp_path/"b")
    assert [c[0] for c in calls[:5]] == [10, 50, 100, 50, 100]
    assert all(p == ORIGINAL_PARAMETERS and threads == 0 for _, p, threads in calls)
    assert ORIGINAL_PARAMETERS["evaluations"] == 833333*6
    assert a["iterations_per_start"] == 833333
    compare(tmp_path/"a/report.json", tmp_path/"b/report.json")
    repeated = sweep(data, tmp_path/"repeated", repeats=2)
    assert len(repeated["rows"]) == 10 and repeated["instances"] == 5
    assert [r["repeat"] for r in repeated["rows"]] == [0, 1]*5
    with pytest.raises(ValueError, match="positive"):
        sweep(data, tmp_path/"invalid", repeats=0)
    with pytest.raises(ValueError, match="already"):
        sweep(data, tmp_path/"a")
