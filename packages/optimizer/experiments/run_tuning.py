"""Foreground fixed-budget tuning; --mode pareto selects the legacy search."""
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
    def __init__(self, workdir, seed=42, trials=400, stream=None, bar_stream=None, disable=False):
        self.workdir, self.seed, self.trials = Path(workdir), seed, trials
        self.stream = sys.stdout if stream is None else stream
        self.bar_stream = sys.stderr if bar_stream is None else bar_stream
        self.disable = disable
        self.buffer, self.current, self.base = "", None, 0
        self.completed = set()
        self.phase = self.solves = None
        self.sizes = tqdm(total=4, desc="Job sizes", unit="size", position=0,
                          file=self.bar_stream, disable=disable, dynamic_ncols=True)

    def complete_size(self):
        if self.current is not None and self.current not in self.completed:
            self.completed.add(self.current)
            self.sizes.update(1)

    def handle(self, line):
        fixed = re.match(r"Fixed search: N(\d+), budget=(\d+), total=(\d+), finished=(\d+), reused=(\d+)", line)
        if fixed:
            for bar in (self.solves, self.phase):
                if bar is not None: bar.close()
            self.solves = None
            self.current = int(fixed[1])
            self.phase = tqdm(total=int(fixed[3]), initial=int(fixed[4]),
                              desc=f"N{self.current} / {int(fixed[2]):,} proposals", unit="config", position=1,
                              file=self.bar_stream, disable=self.disable, dynamic_ncols=True)
        fixed_trial = re.match(r"Fixed trial (\d+)/(\d+): (.*)", line)
        if fixed_trial and self.phase is not None:
            self.phase.update(int(fixed_trial[1])-self.phase.n)
            self.phase.set_postfix_str(fixed_trial[3], refresh=False)
            return
        match = re.match(r"N(\d+): pareto search", line)
        if match:
            self.complete_size()
            for bar in (self.solves, self.phase):
                if bar is not None: bar.close()
            self.solves = None
            self.current = int(match[1])
            path = self.workdir/f"N{self.current}"/"smac/pareto"/str(self.seed)/"runhistory.json"
            self.base = int(json.loads(path.read_text())["stats"]["finished"]) if path.exists() else 0
            total = re.search(r"trials=(\d+)", line)
            inherited = re.search(r"reused=(\d+)", line)
            if not path.exists() and inherited:
                self.base = int(inherited[1])
            self.phase = tqdm(total=int(total[1]) if total else self.trials, initial=self.base, desc=f"N{self.current} Pareto",
                              unit="config", position=1, file=self.bar_stream, disable=self.disable, dynamic_ncols=True)
        match = re.match(r"Solves: (\d+)/(\d+) (.*)", line)
        if match:
            done, total = int(match[1]), int(match[2])
            if self.solves is None:
                self.solves = tqdm(total=total, desc="Panel solves", unit="solve", position=2,
                                   file=self.bar_stream, disable=self.disable, dynamic_ncols=True, leave=False)
            if self.solves.total != total or done < self.solves.n:
                self.solves.reset(total=total)
            self.solves.update(done-self.solves.n)
            self.solves.set_postfix_str(match[3], refresh=False)
            return
        match = re.match(r"Pareto trial (\d+): (.*)", line)
        if match and self.phase is not None:
            self.phase.update(self.base+int(match[1])-self.phase.n)
            self.phase.set_postfix_str(match[2], refresh=False)
            return
        if line.startswith("Panel: heldout") and self.phase is not None:
            self.phase.set_description(f"N{self.current} held-out verification")
        ready = re.match(r"N(\d+): presets ready", line)
        if ready:
            self.current = int(ready[1])
            self.complete_size()
        with tqdm.external_write_mode(file=self.bar_stream):
            self.stream.write(line+"\n")
            self.stream.flush()

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
            self.handle(self.buffer); self.buffer = ""
        if success: self.complete_size()
        for bar in (self.solves, self.phase, self.sizes):
            if bar is not None: bar.close()


def main():
    root = Path(__file__).resolve().parents[1]
    os.chdir(root)
    if str(root) not in sys.path: sys.path.insert(0, str(root))
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--mode", choices=["fixed", "pareto"], default="fixed")
    parser.add_argument("--workdir")
    parser.add_argument("--reuse-from")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--trials", type=int, default=400)
    args, remaining = parser.parse_known_args()
    if args.workdir is None:
        pgo = Path("results/fixed-budget-tuning-pgo")
        args.workdir = (str(pgo) if (pgo/"build-transition.json").exists() else "results/fixed-budget-tuning") if args.mode == "fixed" else "results/pareto-tuning-100m-20starts"
    resume = (Path(args.workdir)/"manifest.json").exists()
    from flexo import _core
    import hashlib
    print(f"Native build: {hashlib.sha256(Path(_core.__file__).read_bytes()).hexdigest()}; checkpoint: {Path(args.workdir).resolve()}")
    command = ["tune-fixed" if args.mode == "fixed" else "tune", "--workdir", args.workdir, "--seed", str(args.seed), "--trials", str(args.trials), *remaining]
    source = args.reuse_from
    if source is None and args.mode == "fixed" and Path("results/pareto-tuning-100m-20starts/manifest.json").exists():
        source = "results/pareto-tuning-100m-20starts"
    elif source is None and args.workdir == "results/pareto-tuning-100m-20starts" and Path("results/pareto-tuning/manifest.json").exists():
        source = "results/pareto-tuning"
    if source is not None: command.extend(["--reuse-from", source])
    if resume and "--resume" not in command: command.append("--resume")
    from flexo.__main__ import main as tune_main
    sys.argv[1:] = command
    if "--help" in command or "-h" in command:
        tune_main(); return
    label = "fixed-budget" if args.mode == "fixed" else "Pareto"
    print(f"{'Resuming' if resume else 'Starting'} {label} tuning in {Path(args.workdir).resolve()}")
    if args.mode == "fixed":
        print(f"{args.trials} additional trials per distinct size/budget; heldout reports gaps without preset fallback.")
    print("Ctrl+C cancels queued tasks and checkpoints active solves before stopping. Starts: 1-20; seeds per instance: 3.")
    progress = TerminalProgress(args.workdir, args.seed, args.trials)
    success = False
    try:
        with redirect_stdout(progress): tune_main()
        success = True
    except KeyboardInterrupt:
        tqdm.write("Stopped. Completed solves are saved; rerun the same command to resume.")
    finally:
        progress.finish(success)


if __name__ == "__main__":
    main()
