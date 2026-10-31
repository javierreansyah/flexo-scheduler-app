import io
import json

from experiments.run_tuning import TerminalProgress


def test_progress_continues_at_saved_checkpoint(tmp_path):
    path = tmp_path/"N10/reference-smac/reference/42/runhistory.json"
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps(dict(stats=dict(finished=856))))
    output = io.StringIO()
    progress = TerminalProgress(tmp_path, stream=output, bar_stream=io.StringIO())
    try:
        progress.write("N10: stage=all, reference=5,000,000, training=20 x 3 seeds\n")
        assert progress.base == progress.phase.n == 856
        progress.write("Reference instance evaluation 1: example, normalized fitness=1.0\n")
        assert progress.phase.n == 857
        progress.write("N10: reference complete, starts=4, score=1.0\n")
        assert progress.base == 0
        progress.write("Reduction trial 1: budget=1000, starts=4, passed=True, instances=20\n")
        progress.write("N10: selected 1000 proposals, starts=4, reduced=True\n")
        assert progress.completed == {10}
        assert "reference complete" in output.getvalue()
    finally:
        progress.finish(False)


def test_progress_never_counts_interrupted_size_as_complete(tmp_path):
    progress = TerminalProgress(tmp_path, stream=io.StringIO(), disable=True)
    progress.write("N10: stage=all, reference=100, training=2 x 3 seeds\n")
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
    assert "--reference-calls" in help_result.stdout
    generate_smac(tmp_path/"data", replicas=1, previous_evaluations=100)
    command = [sys.executable, str(runner), "--directory", str(tmp_path/"data"),
               "--workdir", str(tmp_path/"run"), "--output", str(tmp_path/"profiles.json"),
               "--evaluations", "100000", "--reference-calls", "4", "--reduction-trials", "4", "--threads", "1"]
    first = subprocess.run(command, capture_output=True, text=True, check=True)
    assert "Job sizes" in first.stderr and "reference" in first.stderr and "reduction" in first.stderr
    assert len(json.loads((tmp_path/"profiles.json").read_text())["profiles"]) == 4
    resumed = subprocess.run(command, capture_output=True, text=True, check=True)
    assert "Resuming tuning" in resumed.stdout
