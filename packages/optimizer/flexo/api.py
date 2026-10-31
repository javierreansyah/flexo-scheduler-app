"""Validate production inputs once, then reuse immutable native problem data."""
from copy import deepcopy
from dataclasses import dataclass
import json
import math
from pathlib import Path
import time

from . import _core

DEFAULT_PARAMETERS = dict(evaluations=5_000_000, starts=4, stage_length=1000,
                          t_max=500.0, t_min=.001, rcl_alpha=.5,
                          p_inter=.5, p_shift=.5, p_block=.5)


def number(value, name, minimum=0):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < minimum:
        raise ValueError(f"{name} must be finite and >= {minimum}")
    return float(value)


def integer(value, name, minimum=0):
    number(value, name, minimum)
    if int(value) != value:
        raise ValueError(f"{name} must be an integer")
    return int(value)


def ink_pattern(inks):
    return tuple(sorted(integer(ink, "ink id", 1) for ink in inks))


def select_parameters(job_count, profiles=None, preset="medium"):
    """Nearest movable-job count; ties choose the larger profile."""
    job_count = integer(job_count, "job_count")
    if preset not in ("low", "medium", "high"):
        raise ValueError("preset must be low, medium, or high")
    if profiles is None:
        path = Path("flexo/profiles.json")
        if not path.exists():
            path = Path(__file__).with_name("profiles.json")
        profiles = json.loads(path.read_text()) if path.exists() else {}
    elif isinstance(profiles, (str, Path)):
        profiles = json.loads(Path(profiles).read_text())
    entries = profiles.get("profiles", {})
    if not entries:
        return dict(DEFAULT_PARAMETERS), None
    size = min((int(k) for k in entries), key=lambda k: (abs(k-job_count), -k))
    entry = entries[str(size)]
    parameters = entry["parameters"]
    if "presets" in entry:
        point_id = entry["presets"][preset]
        parameters = next(point["parameters"] for point in entry["frontier"] if point["id"] == point_id)
    return {**DEFAULT_PARAMETERS, **parameters}, size


def parameters_checked(parameters):
    unknown = set(parameters) - DEFAULT_PARAMETERS.keys()
    if unknown:
        raise ValueError(f"Unknown search parameters: {sorted(unknown)}")
    out = {**DEFAULT_PARAMETERS, **parameters}
    for key in ("evaluations", "starts", "stage_length"):
        out[key] = integer(out[key], key, 0 if key == "evaluations" else 1)
        if out[key] > 2_000_000_000:
            raise ValueError(f"{key} exceeds the native integer limit")
    if out["starts"] > 10:
        raise ValueError("starts must be between 1 and 10")
    for key in ("t_max", "t_min", "rcl_alpha", "p_inter", "p_shift", "p_block"):
        out[key] = number(out[key], key)
    if not 0 < out["t_min"] < out["t_max"]:
        raise ValueError("Require 0 < t_min < t_max")
    for key in ("rcl_alpha", "p_inter", "p_shift", "p_block"):
        if out[key] > 1:
            raise ValueError(f"{key} must be between 0 and 1")
    return out


@dataclass(frozen=True)
class PreparedSnapshot:
    core: object
    machines: tuple
    movable: tuple
    jobs: dict
    locked: dict
    snapshot: dict


def prepare(snapshot):
    if isinstance(snapshot, PreparedSnapshot):
        return snapshot
    d = deepcopy(snapshot)
    allowed = {"now", "machines", "jobs", "locked", "machine_states", "setup_time",
               "ink_weight", "batch_flow_time_weight", "ink_costs", "setup_durations", "meta"}
    unknown = d.keys() - allowed
    if unknown:
        raise ValueError(f"Unknown snapshot fields: {sorted(unknown)}")
    now = number(d.get("now", 0), "now")
    rates = d["machines"]
    if not rates or any(not isinstance(m, str) or not m for m in rates):
        raise ValueError("At least one named machine is required")
    machines = tuple(sorted(rates))
    rates = {m: number(rates[m], f"rate for {m}") for m in machines}
    if any(rate <= 0 for rate in rates.values()):
        raise ValueError("Machine rates must be positive pieces per minute")
    setup = number(d.get("setup_time", .75), "setup_time")
    if setup > 8:
        raise ValueError("setup_time cannot exceed an 8-hour shift")
    iw = number(d.get("ink_weight", .4), "ink_weight")
    fw = number(d.get("batch_flow_time_weight", .6), "batch_flow_time_weight")
    if iw + fw == 0:
        raise ValueError("At least one objective weight must be positive")
    jobs = {}
    patterns = {()}
    for raw in d["jobs"]:
        if not isinstance(raw["id"], (str, int)) or isinstance(raw["id"], bool):
            raise ValueError("Job ids must be strings or integers")
        job_id = str(raw["id"])
        if not job_id or job_id in jobs:
            raise ValueError(f"Empty or duplicate job id: {job_id!r}")
        quantity = integer(raw["quantity"], f"quantity for {job_id}", 1)
        arrival = number(raw["arrival_time"], f"arrival for {job_id}")
        if arrival > now:
            raise ValueError(f"Future job {job_id}: arrival {arrival} exceeds snapshot time {now}")
        inks = ink_pattern(raw["inks"])
        patterns.add(inks)
        jobs[job_id] = dict(id=job_id, quantity=quantity, inks=list(inks), arrival_time=arrival)
    states = d.get("machine_states", {})
    locked = d.get("locked", {})
    if (states.keys() | locked.keys()) - set(machines):
        raise ValueError("Machine state or locked jobs reference an unknown machine")
    for state in states.values():
        patterns.add(ink_pattern(state.get("inks", [])))
    patterns = [()] + sorted(patterns - {()})
    pattern_index = {p: i for i, p in enumerate(patterns)}
    labels = sorted({ink for p in patterns for ink in p})
    label_index = {str(ink): i+1 for i, ink in enumerate(labels)}
    label_index["empty"] = 0
    costs = [[float(i > j) for j in [0] + labels] for i in [0] + labels]
    if "ink_costs" in d:
        custom = d["ink_costs"]
        catalog = set(custom)
        if not set(label_index) <= catalog:
            raise ValueError("ink_costs must cover all ink ids and 'empty'")
        if any(k != "empty" and (not isinstance(k, str) or not k.isdecimal() or str(int(k)) != k or int(k) < 1) for k in catalog):
            raise ValueError("Invalid ink id in ink_costs")
        for source, row in custom.items():
            if set(row) != catalog:
                raise ValueError(f"Incomplete ink_costs row {source}")
            for target, value in row.items():
                value = number(value, f"ink_costs[{source}][{target}]")
                if source == target and value != 0:
                    raise ValueError("Diagonal ink costs must be zero")
                if source in label_index and target in label_index:
                    costs[label_index[source]][label_index[target]] = value
    indexed = [[label_index[str(ink)] for ink in p] for p in patterns]
    transitions = [_core.changeover(a, b, costs) for a in indexed for b in indexed]
    npat = len(patterns)
    keys = [",".join(map(str, p)) or "empty" for p in patterns]
    overrides = d.get("setup_durations", {})
    if set(overrides)-set(keys) or any(set(row)-set(keys) for row in overrides.values()):
        raise ValueError("Unknown setup duration pattern")
    durations = [number(overrides.get(a, {}).get(b, setup if transitions[i*npat+j]>0 else 0), "setup duration") for i,a in enumerate(keys) for j,b in enumerate(keys)]
    if any(x>8 for x in durations): raise ValueError("Setup durations cannot exceed 8 hours")
    arrivals = sorted({j["arrival_time"] for j in jobs.values()})
    batch_index = {a: i for i, a in enumerate(arrivals)}
    initial_time, initial_pattern, initial_ink, initial_batches = [], [], [], []
    fixed_ids = set()
    fixed = {m: [] for m in machines}
    for m in machines:
        state = states.get(m, {})
        clock = number(state.get("available_time", 0), f"available_time for {m}")
        pat = pattern_index[ink_pattern(state.get("inks", []))]
        total_ink = 0.
        completions = [-1.] * len(arrivals)
        for entry in locked.get(m, []):
            job_id = str(entry["id"])
            if job_id not in jobs or job_id in fixed_ids:
                raise ValueError(f"Unknown or repeated locked job {job_id}")
            job = jobs[job_id]
            earliest = number(entry["setup_start"], "locked setup_start")
            start = number(entry["start"], "locked start")
            completion = number(entry["completion"], "locked completion")
            if earliest > now or earliest < max(clock, job["arrival_time"]) - 1e-9:
                raise ValueError(f"Locked job {job_id} has not started or overlaps earlier work")
            nxt = pattern_index[tuple(job["inks"])]
            result = _core.step_duration(clock, max(job["arrival_time"], earliest), job["quantity"]/rates[m]/60,
                                transitions[pat*npat+nxt], transitions[nxt], durations[pat*npat+nxt], durations[nxt])
            if any(not math.isclose(a, b, abs_tol=1e-8) for a, b in zip(result[:3], [earliest, start, completion])):
                raise ValueError(f"Locked job {job_id} has inconsistent timestamps or crosses a shift")
            cost = result[3]
            if "ink_change_cost" in entry and not math.isclose(number(entry["ink_change_cost"], "locked cost"), cost, abs_tol=1e-8):
                raise ValueError(f"Locked job {job_id} has inconsistent ink cost")
            fixed[m].append(dict(job, setup_start=earliest, start=start, completion=completion,
                                 ink_change_cost=cost, locked=True))
            clock, pat = completion, nxt
            completions[batch_index[job["arrival_time"]]] = max(completions[batch_index[job["arrival_time"]]], completion)
            total_ink += cost
            fixed_ids.add(job_id)
        ready = max(now, clock)
        if ready >= 8 and (math.floor(ready/8) > math.floor(clock/8) or (clock >= 8 and clock % 8 == 0)):
            pat = 0
        initial_time.append(ready); initial_pattern.append(pat)
        initial_ink.append(total_ink); initial_batches.extend(completions)
    movable = tuple(job_id for job_id in jobs if job_id not in fixed_ids)
    for job_id in movable:
        job = jobs[job_id]
        nxt = pattern_index[tuple(job["inks"])]
        fresh_setup = durations[nxt]
        if all(job["quantity"]/rate/60 + fresh_setup > 8 + 1e-10 for rate in rates.values()):
            raise ValueError(f"Job {job_id} cannot fit within a fresh 8-hour shift on any machine")
    core = _core.Problem(dict(
        arrivals=[jobs[j]["arrival_time"] for j in movable], batch_arrivals=arrivals,
        initial_time=initial_time, initial_pattern=initial_pattern, initial_ink=initial_ink,
        initial_batches=initial_batches, patterns=npat, setup=setup, ink_weight=iw, flow_weight=fw,
        processing=[jobs[j]["quantity"]/rates[m]/60 for m in machines for j in movable],
        transitions=transitions, durations=durations, job_pattern=[pattern_index[tuple(jobs[j]["inks"])] for j in movable],
        job_batch=[batch_index[jobs[j]["arrival_time"]] for j in movable]))
    return PreparedSnapshot(core, machines, movable, jobs, fixed, d)


def _format(p, result):
    result = dict(result)
    timelines = result.pop("schedule")
    result["schedule"] = {}
    for machine, timeline in zip(p.machines, timelines):
        entries = deepcopy(p.locked[machine])
        for entry in timeline:
            entry = dict(entry)
            job_id = p.movable[entry.pop("job")]
            entries.append(dict(p.jobs[job_id], **entry, locked=False))
        result["schedule"][machine] = entries
    return result


def optimize(snapshot, parameters=None, seed=42, num_threads=0, profiles=None, debug=False, preset="medium"):
    begin = time.perf_counter()
    p = prepare(snapshot)
    if preset not in ("low", "medium", "high"):
        raise ValueError("preset must be low, medium, or high")
    selected, size = select_parameters(len(p.movable), profiles, preset) if parameters is None else (parameters, None)
    params = parameters_checked(selected)
    seed = integer(seed, "seed")
    if seed > 2**64-1:
        raise ValueError("seed must fit in an unsigned 64-bit integer")
    num_threads = integer(num_threads, "num_threads")
    result = _format(p, p.core.solve(params, seed, num_threads, bool(debug)))
    result.update(profile_size=size, preset=preset if parameters is None else None,
                  parameters=params, seed=seed, movable_jobs=len(p.movable),
                  total_runtime=time.perf_counter()-begin)
    return result


def evaluate(snapshot, schedule):
    p = prepare(snapshot)
    if set(schedule) != set(p.machines):
        raise ValueError("Schedule must contain exactly the input machines")
    indices = {job_id: i for i, job_id in enumerate(p.movable)}
    sequences = []
    for machine in p.machines:
        entries = schedule[machine]
        prefix = p.locked[machine]
        if len(entries) < len(prefix) or entries[:len(prefix)] != prefix:
            raise ValueError(f"Locked prefix changed on {machine}")
        seq = []
        for entry in entries[len(prefix):]:
            job_id = str(entry["id"] if isinstance(entry, dict) else entry)
            if job_id not in indices:
                raise ValueError(f"Unknown or locked movable job {job_id}")
            seq.append(indices[job_id])
        sequences.append(seq)
    return _format(p, p.core.evaluate(sequences))
