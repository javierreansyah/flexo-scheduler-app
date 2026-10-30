"""Replay arrivals for validation only; tuning never imports this module."""
from copy import deepcopy

from .api import optimize


def run_validation(instance, parameters=None, seed=42, num_threads=0, profiles=None):
    if len(instance["orders_data"]) > 100:
        raise ValueError("Validation instances are capped at 100 jobs")
    lookup = {str(o["id"]): o for o in instance["orders_data"]}
    if len(lookup) != len(instance["orders_data"]):
        raise ValueError("Duplicate validation job id")
    arrivals = {}
    for batch in instance["job_batches"]:
        for job_id in batch["orders"]:
            job_id = str(job_id)
            if job_id not in lookup or job_id in arrivals:
                raise ValueError(f"Unknown or repeated batch job {job_id}")
            arrivals[job_id] = batch["arrival_time"]
    if arrivals.keys() != lookup.keys():
        raise ValueError("Every validation order must have one arrival")
    previous = None
    trace = []
    for now in sorted(set(arrivals.values())):
        jobs = [dict(o, arrival_time=arrivals[j]) for j, o in lookup.items() if arrivals[j] <= now]
        locked = {} if previous is None else {
            m: [deepcopy(j) for j in entries if j["setup_start"] <= now]
            for m, entries in previous["schedule"].items()}
        snapshot = dict(now=now, machines=instance["machine_rates"], jobs=jobs, locked=locked)
        previous = optimize(snapshot, parameters, seed=seed, num_threads=num_threads, profiles=profiles)
        trace.append(dict(now=now, fitness=previous["fitness"], movable_jobs=previous["movable_jobs"],
                          profile_size=previous["profile_size"], runtime=previous["total_runtime"]))
    if previous is None:
        previous = optimize(dict(now=0, machines=instance["machine_rates"], jobs=[]), parameters, seed, num_threads, profiles)
    previous["horizons"] = trace
    previous["total_runtime"] = sum(row["runtime"] for row in trace)
    return previous
