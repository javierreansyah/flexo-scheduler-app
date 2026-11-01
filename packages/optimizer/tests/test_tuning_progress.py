import io
import json

from experiments.run_tuning import TerminalProgress


def test_progress_continues_at_saved_checkpoint(tmp_path):
    path = tmp_path/"N10/smac/pareto/42/runhistory.json"
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps(dict(stats=dict(finished=86))))
    output = io.StringIO()
    progress = TerminalProgress(tmp_path, stream=output, bar_stream=io.StringIO())
    try:
        progress.write("N10: pareto search, trials=400, workers=20, instances=20 x 3 seeds\n")
        assert progress.base == progress.phase.n == 86
        progress.write("Solves: 30/60 cached=0 computed=30 active=20/20\n")
        assert progress.solves.n == 30
        progress.write("Solves: 60/60 cached=0 computed=60 active=0/20\n")
        progress.write("Pareto trial 1: proposals=100000 starts=4 quality=1.0\n")
        assert progress.phase.n == 87
        progress.write("Solves: 0/60 cached=0 computed=0 active=20/20\n")
        assert progress.solves.n == 0
        progress.write("Panel: heldout verification\n")
        progress.write("N10: presets ready, frontier=3\n")
        assert progress.completed == {10}
        assert "presets ready" in output.getvalue()
    finally:
        progress.finish(False)


def test_progress_never_counts_interrupted_size_as_complete(tmp_path):
    progress = TerminalProgress(tmp_path, stream=io.StringIO(), disable=True)
    progress.write("N10: pareto search, trials=400\n")
    progress.finish(False)
    assert progress.completed == set()


def test_runner_help_and_small_campaign(tmp_path):
    import subprocess
    import sys
    from pathlib import Path
    from flexo.instances import generate_smac
    root = Path(__file__).resolve().parents[1]
    runner = root/"experiments/run_tuning.py"
    help_result = subprocess.run([sys.executable, str(runner), "--help"], capture_output=True, text=True, check=True)
    assert "--trials" in help_result.stdout and "--workers" in help_result.stdout
    generate_smac(tmp_path/"data", replicas=1, previous_evaluations=100)
    command = [sys.executable, str(runner), "--mode", "pareto", "--directory", str(tmp_path/"data"),
               "--workdir", str(tmp_path/"run"), "--output", str(tmp_path/"profiles.json"),
               "--max-evaluations", "100000", "--trials", "4", "--workers", "2"]
    first = subprocess.run(command, capture_output=True, text=True, check=True)
    assert "Job sizes" in first.stderr and "Pareto" in first.stderr and "Panel solves" in first.stderr
    assert "--- Logging error ---" not in first.stderr
    assert len(json.loads((tmp_path/"profiles.json").read_text())["profiles"]) == 4
    resumed = subprocess.run(command, capture_output=True, text=True, check=True)
    assert "Resuming Pareto tuning" in resumed.stdout
