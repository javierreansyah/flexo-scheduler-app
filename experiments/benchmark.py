"""Five representative validation cases with the original tuned SA parameters."""
import argparse
import csv
import hashlib
import json
import os
from pathlib import Path
import platform
import statistics
import time

from flexo.instances import write_json
from flexo import _core
from flexo.validation import run_validation

# Original industry.py SA_OPT_PARAMS, preserved in commit 81fb1fc.
# The native API takes a total budget rather than iterations per start.
ORIGINAL_PARAMETERS = dict(evaluations=833333*6, starts=6, t_max=.1603194019,
                           t_min=.0116169910, stage_length=4908, rcl_alpha=.2746914740,
                           p_inter=.6647498733, p_shift=.5008078735, p_block=.2693767726)


def cases(directory):
    root = Path(directory)
    small = json.loads((root/"N15_K1_static_rep00.json").read_text(encoding="utf-8"))
    small["orders_data"] = small["orders_data"][:10]
    small["job_batches"] = [dict(arrival_time=0., orders=[j["id"] for j in small["orders_data"]])]
    small["meta"] = dict(n=10, k=1, rho=None, rep=0)
    inputs = [(Path("N10_K1_static_derived.json"), small)]
    for name in ("N50_K1_static_rep00.json", "N100_K1_static_rep00.json",
                 "N50_K2_rho1.5_rep00.json", "N100_K3_rho1.5_rep00.json"):
        path = root/name
        inputs.append((path, json.loads(path.read_text(encoding="utf-8"))))
    return inputs


def sweep(directory="instances/validation", output="results/benchmark", seed=42, repeats=1):
    if repeats < 1:
        raise ValueError("repeats must be positive")
    inputs = cases(directory)
    out = Path(output)
    out.mkdir(parents=True, exist_ok=True)
    if (out/"runs.csv").exists():
        raise ValueError("Output already has a benchmark; choose another --output")
    digest = hashlib.sha256()
    for path, data in inputs:
        digest.update(path.name.encode()+json.dumps(data, sort_keys=True).encode())
    metadata = dict(parameters=ORIGINAL_PARAMETERS, iterations_per_start=833333, seed=seed,
                    threads=0, max_workers=min(6, os.cpu_count() or 1), cpu_count=os.cpu_count(),
                    platform=platform.platform(), python=platform.python_version(),
                    core_sha256=hashlib.sha256(Path(_core.__file__).read_bytes()).hexdigest(),
                    dataset_sha256=digest.hexdigest(), instances=len(inputs), repeats=repeats, rows=[])
    fields = ["instance", "repeat", "jobs", "horizons", "wall_seconds", "fitness", "ink_cost", "batch_flow_hours", "makespan_hours", "schedule_sha256"]
    begin = time.perf_counter()
    with (out/"runs.csv").open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        runs = [(path, data, repeat) for path, data in inputs for repeat in range(repeats)]
        for i, (path, data, repeat) in enumerate(runs, 1):
            start = time.perf_counter()
            result = run_validation(data, ORIGINAL_PARAMETERS, seed=seed, num_threads=0)
            elapsed = time.perf_counter()-start
            row = dict(instance=path.name, repeat=repeat, jobs=len(data["orders_data"]), horizons=len(result["horizons"]),
                       wall_seconds=elapsed, fitness=result["fitness"], ink_cost=result["ink_changes"],
                       batch_flow_hours=result["batch_flow_time"], makespan_hours=result["makespan"],
                       schedule_sha256=hashlib.sha256(json.dumps(result["schedule"], sort_keys=True).encode()).hexdigest())
            metadata["rows"].append(row)
            writer.writerow(row); stream.flush()
            print(f"{i}/{len(runs)} N{row['jobs']} {path.stem}: {elapsed:.3f}s fitness={row['fitness']:.5f}", flush=True)
    metadata["wall_seconds"] = time.perf_counter()-begin
    metadata["by_size"] = {str(n): dict(median_seconds=statistics.median(r["wall_seconds"] for r in metadata["rows"] if r["jobs"] == n),
                                      total_seconds=sum(r["wall_seconds"] for r in metadata["rows"] if r["jobs"] == n))
                           for n in sorted({r["jobs"] for r in metadata["rows"]})}
    write_json(out/"report.json", metadata)
    return metadata


def compare(before, after):
    a, b = (json.loads(Path(path).read_text()) for path in (before, after))
    for key in ("parameters", "seed", "dataset_sha256", "max_workers"):
        if a[key] != b[key]:
            raise ValueError(f"Incomparable benchmark {key}")
    if [(r["instance"], r.get("repeat", 0)) for r in a["rows"]] != [(r["instance"], r.get("repeat", 0)) for r in b["rows"]]:
        raise ValueError("Incomparable instance order")
    unchanged = all(x["schedule_sha256"] == y["schedule_sha256"] for x, y in zip(a["rows"], b["rows"]))
    print(f"Schedules identical: {unchanged}")
    for name in dict.fromkeys(r["instance"] for r in a["rows"]):
        before = statistics.median(r["wall_seconds"] for r in a["rows"] if r["instance"] == name)
        after = statistics.median(r["wall_seconds"] for r in b["rows"] if r["instance"] == name)
        print(f"{name}: median {before:.3f}s -> {after:.3f}s ({before/after:.3f}x)")
    for n in a["by_size"]:
        print(f"N{n}: median speedup {a['by_size'][n]['median_seconds']/b['by_size'][n]['median_seconds']:.3f}x")
    print(f"Total solve speedup: {sum(r['wall_seconds'] for r in a['rows'])/sum(r['wall_seconds'] for r in b['rows']):.3f}x")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", default="instances/validation")
    parser.add_argument("--output", default="results/benchmark")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--repeats", type=int, default=1, help="Repeat each of the five cases for timing stability")
    parser.add_argument("--compare", nargs=2, metavar=("BEFORE_JSON", "AFTER_JSON"))
    args = parser.parse_args()
    if args.compare:
        compare(*args.compare)
    else:
        sweep(args.directory, args.output, args.seed, args.repeats)


if __name__ == "__main__":
    main()
