"""Run/resume SMAC in your own terminal with tqdm progress bars.

From the repository root: python experiments/run_tuning.py
All flexo tune options are supported. Existing work directories resume by default.
"""
import argparse
from contextlib import redirect_stdout
import io
import json
import os
from pathlib import Path
import re
import sys

from tqdm import tqdm


class TerminalProgress(io.TextIOBase):
    """Present existing tuning messages without changing search/checkpoint code."""
    def __init__(self, workdir, seed=42, reference_calls=1000, reduction_trials=100,
                 stream=None, bar_stream=None, disable=False, stage="all"):
        self.workdir = Path(workdir)
        self.seed = seed
        self.reference_calls, self.reduction_trials = reference_calls, reduction_trials
        self.stream = stream if stream is not None else sys.stdout
        self.bar_stream = bar_stream if bar_stream is not None else sys.stderr
        self.disable = disable
        self.stage = stage
        self.buffer = ""
        self.current = None
        self.completed = set()
        self.base = 0
        self.phase = None
        self.sizes = tqdm(total=4, desc="Job sizes", unit="size", position=0,
                          file=self.bar_stream, disable=disable, dynamic_ncols=True)

    def checkpoint(self, phase):
        path = self.workdir/f"N{self.current}"/f"{phase}-smac"/phase/str(self.seed)/"runhistory.json"
        if path.exists():
            return int(json.loads(path.read_text())["stats"]["finished"])
        return 0

    def start_phase(self, name):
        if self.phase is not None:
            self.phase.close()
        self.base = self.checkpoint(name) if name in ("reference", "reduction") else 0
        total = self.reference_calls if name == "reference" else self.reduction_trials if name == "reduction" else None
        self.phase = tqdm(total=total, initial=self.base, desc=f"N{self.current} {name}",
                          unit="eval" if name == "reference" else "trial", position=1,
                          file=self.bar_stream, disable=self.disable, dynamic_ncols=True)

    def complete_size(self):
        if self.current is not None and self.current not in self.completed:
            self.completed.add(self.current)
            self.sizes.update(1)

    def handle(self, line):
        match = re.match(r"N(\d+): stage=(\w+)", line)
        if match:
            self.complete_size()
            self.current = int(match[1])
            self.start_phase("pilot" if match[2] == "pilot" else "reference" if match[2] != "reduce" else "reduction")
        match = re.match(r"Reference instance evaluation (\d+): (.*)", line)
        if match and self.phase is not None:
            self.phase.update(self.base+int(match[1])-self.phase.n)
            self.phase.set_postfix_str(match[2], refresh=False)
            return
        match = re.match(r"Reduction trial (\d+): (.*)", line)
        if match and self.phase is not None:
            self.phase.update(self.base+int(match[1])-self.phase.n)
            self.phase.set_postfix_str(match[2], refresh=False)
            return
        if re.match(r"N\d+: reference complete", line) and self.stage != "reference":
            self.start_phase("reduction")
        if re.match(r"N\d+: selected", line):
            self.complete_size()
        tqdm.write(line, file=self.stream)

    def write(self, value):
        self.buffer += value
        while "\n" in self.buffer:
            line, self.buffer = self.buffer.split("\n", 1)
            self.handle(line)
        return len(value)

    def flush(self):
        self.stream.flush()

    def finish(self, success):
        if self.buffer:
            self.handle(self.buffer)
            self.buffer = ""
        if success:
            self.complete_size()
        if self.phase is not None:
            self.phase.close()
        self.sizes.close()


def main():
    root = Path(__file__).resolve().parents[1]
    os.chdir(root)
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    # Consume only display settings; let the main CLI validate all tuning options.
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--workdir", default="results/quality-budget-run")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--reference-calls", type=int, default=1000)
    parser.add_argument("--reduction-trials", type=int, default=100)
    parser.add_argument("--stage", choices=["pilot", "reference", "reduce", "all"], default="all")
    args, remaining = parser.parse_known_args()
    resume = (Path(args.workdir)/"manifest.json").exists()
    command = ["tune", "--workdir", args.workdir, "--seed", str(args.seed),
               "--reference-calls", str(args.reference_calls), "--reduction-trials", str(args.reduction_trials),
               "--stage", args.stage, *remaining]
    if resume and "--resume" not in command:
        command.append("--resume")
    if "--help" in command or "-h" in command:
        from flexo.__main__ import main as tune_main
        sys.argv[1:] = command
        tune_main()
        return
    print(f"{'Resuming' if resume else 'Starting'} tuning in {Path(args.workdir).resolve()}")
    print("Ctrl+C stops the run. Run this command again to resume. Starts: 1–4; seeds per instance: 3.")
    progress = TerminalProgress(args.workdir, args.seed, args.reference_calls, args.reduction_trials, stage=args.stage)
    success = False
    try:
        from flexo.__main__ import main as tune_main
        sys.argv[1:] = command
        with redirect_stdout(progress):
            tune_main()
        success = True
    except KeyboardInterrupt:
        tqdm.write("Stopped. Completed measurements are saved; rerun to resume.")
    finally:
        progress.finish(success)


if __name__ == "__main__":
    main()
