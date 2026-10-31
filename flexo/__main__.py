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
        command.add_argument("--preset", choices=["low", "medium", "high"], default="medium")
        command.add_argument("--seed", type=int, default=42)
        command.add_argument("--threads", type=int, default=0)
    tuning = commands.add_parser("tune")
    tuning.add_argument("--directory", default="instances/smac")
    tuning.add_argument("--output", default="flexo/profiles.json")
    tuning.add_argument("--workdir", default="results/pareto-tuning")
    tuning.add_argument("--trials", type=int, default=400)
    tuning.add_argument("--workers", type=int, default=0, help="Global solve workers; 0 uses available logical CPUs")
    tuning.add_argument("--max-evaluations", type=int, default=20_000_000, help="Upper proposal budget; multiples of 100k")
    tuning.add_argument("--seeds", type=int, nargs=3, default=[42, 43, 44])
    tuning.add_argument("--heldout-seeds", type=int, nargs=3, default=[142, 143, 144])
    tuning.add_argument("--resume", action="store_true")
    tuning.add_argument("--seed", type=int, default=42)
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
        tune(args.directory, args.output, args.workdir, trials=args.trials,
             workers=args.workers, max_evaluations=args.max_evaluations, seeds=args.seeds,
             heldout_seeds=args.heldout_seeds, seed=args.seed, resume=args.resume)
    else:
        data = json.loads(args.input.read_text(encoding="utf-8"))
        params = json.loads(args.parameters.read_text(encoding="utf-8")) if args.parameters else None
        result = (optimize if args.command == "solve" else run_validation)(
            data, params, args.seed, args.threads, args.profiles, preset=args.preset)
        if args.output:
            write_json(args.output, result)
        else:
            print(json.dumps(result, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
