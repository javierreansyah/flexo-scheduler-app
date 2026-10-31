import argparse
import json
from pathlib import Path

from .api import optimize
from .instances import generate_smac, generate_validation, write_json
from .validation import run_validation


def main():
    parser = argparse.ArgumentParser(description="Flexo scheduling and size-based SA tuning")
    commands = parser.add_subparsers(dest="command", required=True)
    generate = commands.add_parser("generate")
    generate.add_argument("kind", choices=["smac", "validation"])
    generate.add_argument("--directory")
    generate.add_argument("--replicas", type=int, default=10)
    generate.add_argument("--seed", type=int, default=42)
    generate.add_argument("--previous-evaluations", type=int, default=50_000)
    generate.add_argument("--template", type=Path)
    generate.add_argument("--overwrite", action="store_true", help="Replace existing generated SMAC snapshots")
    for name in ("solve", "validate"):
        command = commands.add_parser(name)
        command.add_argument("input", type=Path)
        command.add_argument("--output", type=Path)
        command.add_argument("--parameters", type=Path)
        command.add_argument("--profiles", type=Path)
        command.add_argument("--seed", type=int, default=42)
        command.add_argument("--threads", type=int, default=0)
    tuning = commands.add_parser("tune")
    tuning.add_argument("--directory", default="instances/smac")
    tuning.add_argument("--output", default="flexo/profiles.json")
    tuning.add_argument("--workdir", default="results/tuning-v2")
    tuning.add_argument("--reference-calls", type=int, default=1000)
    tuning.add_argument("--reduction-trials", type=int, default=100)
    tuning.add_argument("--evaluations", type=int, help="Override all reference budgets (default: 5m/5m/5m/8m)")
    tuning.add_argument("--seeds", type=int, nargs=3, default=[42, 43, 44])
    tuning.add_argument("--heldout-seeds", type=int, nargs=3, default=[142, 143, 144])
    tuning.add_argument("--stage", choices=["pilot", "reference", "reduce", "all"], default="all")
    tuning.add_argument("--resume", action="store_true")
    tuning.add_argument("--seed", type=int, default=42)
    tuning.add_argument("--threads", type=int, default=0)
    args = parser.parse_args()
    if args.command == "generate":
        kwargs = dict(directory=args.directory or f"instances/{args.kind}", replicas=args.replicas,
                      seed=args.seed, template_path=args.template)
        if args.kind == "smac":
            paths = generate_smac(**kwargs, previous_evaluations=args.previous_evaluations, overwrite=args.overwrite)
        else:
            paths = generate_validation(**kwargs)
        print(f"Generated {len(paths)} instances")
    elif args.command == "tune":
        from .tuning import tune
        tune(args.directory, args.output, args.workdir, reference_calls=args.reference_calls,
             reduction_trials=args.reduction_trials, evaluations=args.evaluations, seeds=args.seeds,
             heldout_seeds=args.heldout_seeds, seed=args.seed, num_threads=args.threads,
             stage=args.stage, resume=args.resume)
    else:
        data = json.loads(args.input.read_text(encoding="utf-8"))
        params = json.loads(args.parameters.read_text(encoding="utf-8")) if args.parameters else None
        result = (optimize if args.command == "solve" else run_validation)(
            data, params, args.seed, args.threads, args.profiles)
        if args.output:
            write_json(args.output, result)
        else:
            print(json.dumps(result, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
