"""Compare serial and bounded-pool throughput on five representative cases."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import platform
import threading
import time

from tqdm import tqdm

from experiments.benchmark import ORIGINAL_PARAMETERS, cases
from flexo import _core
from flexo.instances import write_json
from flexo.validation import run_validation


def benchmark(directory="instances/validation", output="results/parallel-benchmark", workers=0, repeats=2):
    workers = workers or (os.cpu_count() or 1)
    if workers < 1 or repeats < 1:
        raise ValueError("workers and repeats must be positive")
    out = Path(output)
    if (out/"report.json").exists():
        raise ValueError("Choose a fresh output directory")
    inputs = cases(directory)
    tasks = [(path.name, data, seed, repeat) for path, data in inputs
             for seed in (42, 43, 44) for repeat in range(repeats)]
    reports = {}
    for label, limit in (("serial", 1), ("parallel", workers)):
        active = peak = 0
        lock = threading.Lock()
        def solve(task):
            nonlocal active, peak
            name, data, seed, repeat = task
            with lock:
                active += 1; peak = max(peak, active)
            try:
                result = run_validation(data, ORIGINAL_PARAMETERS, seed=seed, num_threads=1)
                return dict(instance=name, seed=seed, repeat=repeat, fitness=result["fitness"],
                            schedule_sha256=hashlib.sha256(json.dumps(result["schedule"], sort_keys=True).encode()).hexdigest())
            finally:
                with lock: active -= 1
        begin, cpu_begin = time.perf_counter(), time.process_time()
        with ThreadPoolExecutor(max_workers=limit) as pool:
            rows = list(tqdm(pool.map(solve, tasks), total=len(tasks), desc=label, unit="solve"))
        reports[label] = dict(wall_seconds=time.perf_counter()-begin, cpu_seconds=time.process_time()-cpu_begin,
                              workers=limit, peak_workers=peak, rows=rows)
    if reports["serial"]["rows"] != reports["parallel"]["rows"]:
        raise RuntimeError("Serial and parallel schedules or scores differ")
    report = dict(parameters=ORIGINAL_PARAMETERS, seeds=[42, 43, 44], repeats=repeats,
                  cases=[p.name for p, _ in inputs], schedules_identical=True,
                  speedup=reports["serial"]["wall_seconds"]/reports["parallel"]["wall_seconds"],
                  cpu_count=os.cpu_count(), platform=platform.platform(),
                  core_sha256=hashlib.sha256(Path(_core.__file__).read_bytes()).hexdigest(), **reports)
    write_json(out/"report.json", report)
    print(f"Identical schedules: True. Throughput speedup: {report['speedup']:.2f}x. "
          f"Serial: {reports['serial']['wall_seconds']:.2f}s; parallel: {reports['parallel']['wall_seconds']:.2f}s.")
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", default="instances/validation")
    parser.add_argument("--output", default="results/parallel-benchmark")
    parser.add_argument("--workers", type=int, default=0)
    parser.add_argument("--repeats", type=int, default=2)
    args = parser.parse_args()
    benchmark(**vars(args))
