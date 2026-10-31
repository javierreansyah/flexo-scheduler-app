"""SMAC snapshots and the original rolling-horizon validation format."""
from copy import deepcopy
import json
from pathlib import Path
import random

from .api import optimize

SIZES = (10, 30, 50, 100)
VALIDATION_SIZES = (15, 30, 50, 100)


def write_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(data, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    temporary.replace(path)


def orders(count, rng, templates, prefix=""):
    result = []
    for i in range(count):
        template = rng.choice(templates)
        result.append(dict(id=f"{prefix}{i+1}", quantity=max(1000, int(template["quantity"] * rng.uniform(.85, 1.15))),
                           inks=list(template["inks"])))
    return result


def production_example(path=None):
    return json.loads(Path(path or Path(__file__).with_name("example.json")).read_text(encoding="utf-8"))


def generate_smac(directory="instances/smac", replicas=10, seed=42, previous_evaluations=50_000, template_path=None, overwrite=False):
    if replicas < 1 or previous_evaluations < 0:
        raise ValueError("replicas must be positive and previous_evaluations nonnegative")
    example = production_example(template_path)
    if len(example["machines"]) != 3:
        raise ValueError("SMAC generation requires exactly three machines")
    written = []
    baseline = dict(evaluations=previous_evaluations, starts=4, t_max=500., t_min=.001,
                    stage_length=1000, rcl_alpha=.5, p_inter=.5, p_shift=.5, p_block=.5)
    for split_index, split in enumerate(("train", "heldout")):
        for n in SIZES:
            for rep in range(replicas):
                paths = [Path(directory)/split/f"N{n}_{kind}_{rep:02d}.json" for kind in ("clean", "carryover")]
                if not overwrite and all(p.exists() for p in paths):
                    written.extend(paths)
                    continue
                instance_seed = seed + split_index*1_000_000 + n*1000 + rep
                rng = random.Random(instance_seed)
                previous_jobs = [dict(j, arrival_time=0.) for j in orders(n, rng, example["jobs"], "old-")]
                clean = dict(now=0., machines=example["machines"], jobs=previous_jobs)
                previous = optimize(clean, baseline, seed=instance_seed, num_threads=1)
                events = sorted({t for entries in previous["schedule"].values() for j in entries
                                 for t in (j["setup_start"], j["completion"])})
                cuts = []
                for a, b in zip(events, events[1:]):
                    now = (a+b)/2
                    locked_count = sum(j["setup_start"] <= now for entries in previous["schedule"].values() for j in entries)
                    if 0 < locked_count < n and now > 0:
                        cuts.append(now)
                if not cuts:
                    raise ValueError("Previous schedule cannot produce both locked and movable work")
                now = rng.choice(cuts)
                locked = {m: [j for j in entries if j["setup_start"] <= now] for m, entries in previous["schedule"].items()}
                locked_count = sum(map(len, locked.values()))
                new_jobs = [dict(j, arrival_time=now) for j in orders(locked_count, rng, example["jobs"], "new-")]
                carry = dict(now=now, machines=example["machines"], jobs=previous_jobs+new_jobs, locked=locked)
                for kind, snapshot in (("clean", clean), ("carryover", carry)):
                    snapshot["meta"] = dict(kind=kind, split=split, movable_jobs=n, replica=rep,
                                            seed=instance_seed, previous_parameters=baseline if kind == "carryover" else None)
                    path = Path(directory)/split/f"N{n}_{kind}_{rep:02d}.json"
                    if overwrite or not path.exists():
                        write_json(path, snapshot)
                    written.append(path)
    return written


def generate_validation(directory="instances/validation", replicas=10, seed=42, template_path=None):
    """Same static/K2/K3, rho=1/1.5 validation families; never generate N200."""
    example = production_example(template_path)
    rates = example["machines"]
    templates = example["jobs"]
    written = []
    rng = random.Random(seed)
    for n in VALIDATION_SIZES:
        for rep in range(replicas):
            generated = (deepcopy(templates) if n == 15 and rep == 0 else orders(n, rng, templates))
            generated = [dict(id=i+1, quantity=j["quantity"], inks=j["inks"]) for i, j in enumerate(generated)]
            for k in (1, 2, 3):
                ids = list(range(1, n+1))
                if k > 1:
                    rng.shuffle(ids)
                splits = [sorted(ids[i*(n//k): n if i == k-1 else (i+1)*(n//k)]) for i in range(k)]
                for rho in ((None,) if k == 1 else (1., 1.5)):
                    avg_qty = sum(j["quantity"] for j in generated)/n
                    gap = 0 if rho is None else avg_qty/(sum(rates.values())/len(rates))/60*(n/k)/(rho*len(rates))
                    batches = [dict(arrival_time=round(i*gap, 2), orders=part) for i, part in enumerate(splits)]
                    label = "static" if rho is None else f"rho{rho}"
                    path = Path(directory)/f"N{n}_K{k}_{label}_rep{rep:02d}.json"
                    write_json(path, dict(machine_rates=rates, orders_data=generated, job_batches=batches,
                                          meta=dict(n=n, k=k, rho=rho, rep=rep)))
                    written.append(path)
    return written
