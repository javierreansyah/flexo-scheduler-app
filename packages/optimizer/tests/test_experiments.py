import json

import pytest

from experiments.playground import run, timeline


def test_playground_exports_and_plots_solver_timestamps(tmp_path):
    pytest.importorskip("matplotlib")
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    snapshot = dict(now=0, machines={"A": 100}, jobs=[
        dict(id="first", quantity=6000, inks=[9], arrival_time=0),
        dict(id="second", quantity=6000, inks=[1], arrival_time=0)])
    path = tmp_path/"input.json"
    path.write_text(json.dumps(snapshot))
    rows, best = run(path, seeds=[42, 43], parameters={"evaluations": 50, "starts": 1}, output_dir=tmp_path/"out")
    assert len(rows) == 2 and all(r["wall_seconds"] >= 0 for r in rows)
    assert best["fitness"] == min(r["fitness"] for r in rows)
    assert (tmp_path/"out/metrics.csv").read_text().count("\n") == 3
    assert json.loads((tmp_path/"out/best.json").read_text())["result"]["seed"] == best["seed"]
    figure = timeline(best)
    bars = figure.axes[0].patches
    for job in best["schedule"]["A"]:
        assert any(bar.get_x() == job["start"] and bar.get_width() == pytest.approx(job["completion"]-job["start"]) for bar in bars)
    figure.savefig(tmp_path/"chart.png")
    plt.close(figure)


def test_playground_detects_validation_and_empty_schedule(tmp_path):
    rows, best = run("instances/validation/N15_K2_rho1.0_rep00.json", parameters={"evaluations": 50, "starts": 1})
    assert rows[0]["horizons"] == 2
    assert len(best["horizons"]) == 2
    pytest.importorskip("matplotlib")
    import matplotlib.pyplot as plt
    figure = timeline(dict(schedule={"A": []}, fitness=0, ink_changes=0, batch_flow_time=0, makespan=0))
    plt.close(figure)
