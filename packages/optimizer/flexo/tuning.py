"""Single-campaign ParEGO tuning with bounded native workers and persistent solves."""
from concurrent.futures import ThreadPoolExecutor, as_completed
import csv
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import statistics
import threading
import time

from . import _core
from .api import DEFAULT_PARAMETERS, integer, optimize, parameters_checked, prepare
from .instances import SIZES, write_json

EVALUATION_STEP = 100_000
MAX_EVALUATIONS = 100_000_000
PRESET_TOLERANCES = {"low": .02, "medium": .005, "high": 0.}
PRIOR_PARAMETERS = dict(t_max=.1603194019, t_min=.0116169910, stage_length=4908,
                        starts=4, rcl_alpha=.2746914740, p_inter=.6647498733,
                        p_shift=.5008078735, p_block=.2693767726)


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, allow_nan=False).encode()).hexdigest()


def budget_steps(evaluations):
    evaluations = integer(evaluations, "evaluations", EVALUATION_STEP)
    if evaluations % EVALUATION_STEP or evaluations > MAX_EVALUATIONS:
        raise ValueError("Budget must be a multiple of 100,000 from 100k through 100m")
    return evaluations // EVALUATION_STEP


def configuration_space(seed=42, max_evaluations=MAX_EVALUATIONS):
    from ConfigSpace import ConfigurationSpace, Constant, Float, Integer
    steps = budget_steps(max_evaluations)
    space = ConfigurationSpace(seed=seed)
    space.add(Float("t_max", (.01, 100_000.), default=500., log=True),
              Float("temperature_ratio", (1e-8, .99), default=.001/500, log=True),
              Integer("stage_length", (1, 5000), default=1000),
              Integer("starts", (1, 20), default=4), Float("rcl_alpha", (0., 1.), default=.5),
              Float("p_inter", (0., 1.), default=.5), Float("p_shift", (0., 1.), default=.5),
              Float("p_block", (0., 1.), default=.5),
              Constant("evaluation_steps", 1) if steps == 1 else Integer("evaluation_steps", (1, steps), default=steps, log=True))
    return space


def decode(config, max_evaluations=MAX_EVALUATIONS):
    parameters = dict(config)
    steps = integer(parameters.pop("evaluation_steps"), "evaluation_steps", 1)
    parameters["evaluations"] = steps * EVALUATION_STEP
    if parameters["evaluations"] > max_evaluations:
        raise ValueError("Budget exceeds configured maximum")
    parameters["t_min"] = parameters["t_max"] * parameters.pop("temperature_ratio")
    return parameters_checked(parameters)


def as_config(space, parameters):
    from ConfigSpace import Configuration
    values = {k: parameters[k] for k in ("t_max", "stage_length", "starts", "rcl_alpha", "p_inter", "p_shift", "p_block")}
    values["temperature_ratio"] = parameters["t_min"]/parameters["t_max"]
    values["evaluation_steps"] = budget_steps(parameters["evaluations"])
    return Configuration(space, values)


def load_dataset(directory):
    groups = {split: {n: [] for n in SIZES} for split in ("train", "heldout")}
    digest = hashlib.sha256()
    for split in groups:
        for path in sorted((Path(directory)/split).glob("*.json")):
            raw = path.read_bytes()
            digest.update(f"{split}/{path.name}\n".encode()+raw)
            data = json.loads(raw)
            p = prepare(data)
            n = len(p.movable)
            kind = data.get("meta", {}).get("kind")
            if n not in SIZES or len(p.machines) != 3 or kind not in ("clean", "carryover"):
                raise ValueError(f"Unexpected SMAC instance {path}")
            if data["meta"].get("split") != split:
                raise ValueError(f"Wrong split metadata in {path}")
            if (kind == "clean" and (data["now"] != 0 or any(p.locked.values()))) or (
                kind == "carryover" and (not any(p.locked.values()) or not any(p.jobs[j]["arrival_time"] < data["now"] for j in p.movable))):
                raise ValueError(f"Invalid snapshot type in {path}")
            groups[split][n].append((path.name, kind, p))
        for n, rows in groups[split].items():
            counts = [sum(kind == k for _, kind, _ in rows) for k in ("clean", "carryover")]
            if not counts[0] or counts[0] != counts[1]:
                raise ValueError(f"Need balanced clean/carryover {split} snapshots for N{n}")
    training = {json.dumps({k: v for k, v in p.snapshot.items() if k != "meta"}, sort_keys=True)
                for rows in groups["train"].values() for _, _, p in rows}
    for rows in groups["heldout"].values():
        for _, _, p in rows:
            # Ignore split metadata when detecting accidental leakage.
            stripped = json.dumps({k: v for k, v in p.snapshot.items() if k != "meta"}, sort_keys=True)
            if stripped in training:
                raise ValueError("Training and held-out snapshots overlap")
    return groups, digest.hexdigest()


class CachedEvaluator:
    """One bounded pool; only its coordinator accesses SQLite or aggregates scores."""
    def __init__(self, path, workers=0):
        self.workers = integer(workers, "workers") or (os.cpu_count() or 1)
        self.db = sqlite3.connect(path)
        self.db.execute("CREATE TABLE IF NOT EXISTS solves (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        self.pool = ThreadPoolExecutor(max_workers=self.workers, thread_name_prefix="sa")
        self.hits = self.misses = self.active = self.peak = 0
        self.lock = threading.Lock()
        self.last_panel_stats = {}

    def close(self):
        self.pool.shutdown(wait=True, cancel_futures=True)
        self.db.close()

    def solve(self, problem, parameters, seed):
        with self.lock:
            self.active += 1
            self.peak = max(self.peak, self.active)
        try:
            # Each task owns one CPU worker; its starts execute sequentially.
            result = optimize(problem, parameters, seed, num_threads=1)
            return dict(seed=seed, fitness=result["fitness"], seconds=result["total_runtime"])
        finally:
            with self.lock:
                self.active -= 1

    def store(self, key, value):
        with self.db:
            self.db.execute("INSERT OR IGNORE INTO solves VALUES (?,?)", (key, json.dumps(value, allow_nan=False)))
        self.misses += 1

    def panel(self, rows, parameters, seeds):
        if not rows or not seeds:
            raise ValueError("A panel needs instances and seeds")
        begin, cpu_begin = time.perf_counter(), time.process_time()
        hit_start, miss_start = self.hits, self.misses
        self.peak = 0
        values, pending = {}, {}
        total = len(rows)*len(seeds)
        last_display = 0.
        def display(force=False):
            nonlocal last_display
            now = time.perf_counter()
            if force or now-last_display >= .15:
                print(f"Solves: {len(values)}/{total} cached={self.hits-hit_start} computed={self.misses-miss_start} active={self.active}/{self.workers}", flush=True)
                last_display = now
        try:
            for name, kind, problem in rows:
                identity = fingerprint(problem.snapshot)
                for seed in seeds:
                    key = fingerprint([identity, parameters, seed])
                    record = self.db.execute("SELECT value FROM solves WHERE key=?", (key,)).fetchone()
                    if record is not None:
                        values[name, seed] = json.loads(record[0])
                        self.hits += 1
                    else:
                        future = self.pool.submit(self.solve, problem, parameters, seed)
                        pending[future] = (key, name, seed)
            display(True)
            for future in as_completed(list(pending)):
                key, name, seed = pending.pop(future)
                value = future.result()
                self.store(key, value)
                values[name, seed] = value
                display()
            display(True)
        except BaseException:
            # Cancel queued work, let active native calls finish, and checkpoint
            # their results before propagating Ctrl+C or a worker failure.
            for future in pending:
                future.cancel()
            self.pool.shutdown(wait=True, cancel_futures=True)
            for future, (key, _, _) in pending.items():
                if not future.cancelled() and future.done() and future.exception() is None:
                    self.store(key, future.result())
            raise
        elapsed = time.perf_counter()-begin
        self.last_panel_stats = dict(wall_seconds=elapsed, cpu_seconds=time.process_time()-cpu_begin,
                                     computed=self.misses-miss_start, cached=self.hits-hit_start,
                                     peak_workers=self.peak, workers=self.workers)
        # Stable ordering is independent of which thread finished first.
        return {name: dict(kind=kind, fitness=statistics.mean(values[name, s]["fitness"] for s in seeds),
                           samples=[values[name, s] for s in seeds],
                           seconds=sum(values[name, s]["seconds"] for s in seeds)) for name, kind, _ in rows}


def summarize(measured, baseline):
    ratios = {name: row["fitness"]/max(baseline[name]["fitness"], 1e-12) for name, row in measured.items()}
    by_kind = {kind: statistics.mean(ratios[name] for name, row in measured.items() if row["kind"] == kind)
               for kind in ("clean", "carryover")}
    seeds = [s["seed"] for s in next(iter(measured.values()))["samples"]]
    per_seed = [statistics.mean(next(s["fitness"] for s in row["samples"] if s["seed"] == seed)
                                /max(baseline[name]["fitness"], 1e-12) for name, row in measured.items()) for seed in seeds]
    return dict(quality=statistics.mean(ratios.values()), by_kind=by_kind,
                mean_fitness=statistics.mean(row["fitness"] for row in measured.values()),
                seed_quality=per_seed, seed_std=statistics.stdev(per_seed) if len(seeds)>1 else 0.)


def pareto_front(points):
    """Cheaper first; numerical objective ties keep the cheaper/fewer-start point."""
    ordered = sorted(points, key=lambda p: (p["parameters"]["evaluations"], p["quality"], p["parameters"]["starts"], p["id"]))
    frontier, best = [], float("inf")
    for point in ordered:
        if point["quality"] < best-1e-9:
            frontier.append(point)
            best = point["quality"]
    return frontier


def tolerance_failures(candidate, high, tolerance):
    values = [("overall", candidate["quality"], high["quality"])]
    values += [(kind, candidate["by_kind"][kind], high["by_kind"][kind]) for kind in ("clean", "carryover")]
    return [name for name, value, reference in values if value > reference*(1+tolerance)+1e-9*max(1., abs(reference))]


def select_presets(frontier):
    high = min(frontier, key=lambda p: (p["quality"], p["parameters"]["evaluations"], p["parameters"]["starts"], p["id"]))
    selected = {"high": high["id"]}
    for name in ("low", "medium"):
        eligible = [p for p in frontier if not tolerance_failures(p, high, PRESET_TOLERANCES[name])]
        selected[name] = min(eligible, key=lambda p: (p["parameters"]["evaluations"], p["quality"], p["parameters"]["starts"], p["id"]))["id"]
    return selected


def validate_presets(frontier, selected, heldout, evaluator, seeds):
    baseline_parameters = {**DEFAULT_PARAMETERS, **PRIOR_PARAMETERS, "evaluations": EVALUATION_STEP}
    baseline = evaluator.panel(heldout, baseline_parameters, seeds)
    points = {p["id"]: p for p in frontier}
    results = {}
    for point_id in dict.fromkeys(selected.values()):
        measured = evaluator.panel(heldout, points[point_id]["parameters"], seeds)
        results[point_id] = dict(summarize(measured, baseline), measurements=measured)
    validated, failures = dict(selected), {}
    for name in ("low", "medium"):
        bad = tolerance_failures(results[selected[name]], results[selected["high"]], PRESET_TOLERANCES[name])
        if bad:
            failures[name] = bad
            validated[name] = selected["high"]
    return validated, dict(points=results, baseline=baseline, fallback_reasons=failures)


def export_frontier(folder, frontier, candidates, presets):
    write_json(folder/"frontier.json", dict(frontier=frontier, presets=presets))
    with (folder/"frontier.csv").open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=["id", "proposals", "starts", "quality", "seed_std", "clean_quality", "carryover_quality", "parameters"])
        writer.writeheader()
        for p in frontier:
            writer.writerow(dict(id=p["id"], proposals=p["parameters"]["evaluations"], starts=p["parameters"]["starts"],
                                 quality=p["quality"], seed_std=p["seed_std"], clean_quality=p["by_kind"]["clean"],
                                 carryover_quality=p["by_kind"]["carryover"], parameters=json.dumps(p["parameters"])))
    from matplotlib.figure import Figure
    from matplotlib.backends.backend_agg import FigureCanvasAgg
    fig = Figure(figsize=(9, 5)); FigureCanvasAgg(fig)
    ax = fig.subplots()
    ax.scatter([p["parameters"]["evaluations"]/1e6 for p in candidates], [p["quality"] for p in candidates], alpha=.3, color="gray", label="Evaluated")
    ax.plot([p["parameters"]["evaluations"]/1e6 for p in frontier], [p["quality"] for p in frontier], "o-", label="Training frontier")
    lookup = {p["id"]: p for p in frontier}
    for point_id in dict.fromkeys(presets.values()):
        point = lookup[point_id]
        names = "/".join(name for name in ("low", "medium", "high") if presets[name] == point_id)
        right = point["parameters"]["evaluations"] == frontier[-1]["parameters"]["evaluations"]
        ax.annotate(names, (point["parameters"]["evaluations"]/1e6, point["quality"]),
                    xytext=(-5 if right else 5, 8), ha="right" if right else "left", textcoords="offset points")
    ax.set(xscale="log", xlabel="Total proposals (millions, log scale)", ylabel="Normalized fitness (lower is better)", title="Cost / quality frontier")
    ax.grid(alpha=.2); ax.legend(); fig.tight_layout()
    fig.savefig(folder/"frontier.png", dpi=160)
    fig.savefig(folder/"frontier.svg")


def warm_parameters(path, max_evaluations):
    """Legacy profiles supply proposals only, never certified Pareto measurements."""
    data = json.loads(Path(path).read_text()) if Path(path).exists() else {}
    result = {}
    for n in SIZES:
        entry = data.get("profiles", {}).get(str(n), {})
        options = [entry["parameters"]] if "parameters" in entry else []
        if "presets" in entry:
            options += [p["parameters"] for p in entry["frontier"] if p["id"] in entry["presets"].values()]
        valid = []
        for raw in options:
            parameters = parameters_checked(raw)
            if EVALUATION_STEP <= parameters["evaluations"] <= max_evaluations and parameters["evaluations"] % EVALUATION_STEP == 0:
                valid.append(parameters)
        result[str(n)] = valid
    return result


def reuse_campaign(source, workdir, dataset, manifest, workers):
    """Copy exact solves only after checking old fitness against today's solver."""
    source = Path(source).resolve()
    old = json.loads((source/"manifest.json").read_text())
    for key in ("schema_version", "mode", "dataset_sha256", "evaluation_step", "seeds", "heldout_seeds", "tolerances"):
        if old.get(key) != manifest[key]:
            raise ValueError(f"Cannot reuse campaign: {key} differs")
    if source == workdir.resolve():
        raise ValueError("Reuse needs a new work directory; the source is kept unchanged")
    points = {}
    verifier = CachedEvaluator(":memory:", workers)
    try:
        for n in SIZES:
            profile = json.loads((source/f"N{n}/profile.json").read_text())
            rows = dataset["train"][n]
            print(f"N{n}: checking cached baseline against current solver", flush=True)
            measured = verifier.panel(rows, profile["baseline_parameters"], manifest["seeds"])
            checks = [(measured, profile["normalization"])]
            # Include long-run trajectories, not just the 100k normalization panel.
            for point in (profile["frontier"][0], profile["frontier"][-1]):
                sample = [next(row for row in rows if row[1] == kind) for kind in ("clean", "carryover")]
                checks.append((verifier.panel(sample, point["parameters"], manifest["seeds"][:1]), point["measurements"]))
            for actual, expected in checks:
                for name, row in actual.items():
                    saved = {s["seed"]: s["fitness"] for s in expected[name]["samples"]}
                    if any(abs(s["fitness"]-saved[s["seed"]]) > 1e-12 for s in row["samples"]):
                        raise ValueError(f"Cached fitness differs from current solver: N{n}/{name}; reuse refused")
            points[n] = [json.loads(p.read_text()) for p in sorted((source/f"N{n}/candidates").glob("*.json"))]
            for point in points[n]:
                as_config(configuration_space(max_evaluations=manifest["max_evaluations"]), point["parameters"])
    finally:
        verifier.close()
    workdir.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(f"{(source/'solves.sqlite3').as_uri()}?mode=ro", uri=True) as src, sqlite3.connect(workdir/"solves.sqlite3") as dst:
        src.backup(dst)
    for n, candidates in points.items():
        for point in candidates:
            write_json(workdir/f"N{n}/candidates/{point['id']}.json", point)
    return dict(source=str(source), manifest_sha256=fingerprint(old),
                verified_current_solver=True, candidates={str(n): len(p) for n, p in points.items()})


def repair_running_costs(path):
    """SMAC 2.3 saves scalar RUNNING placeholders in multiobjective histories."""
    if not path.exists():
        return
    data = json.loads(path.read_text())
    changed = False
    for entry in data["data"]:
        if entry["status"] == 0 and isinstance(entry["cost"], (int, float)):
            entry["cost"] = [entry["cost"], entry["cost"]]
            changed = True
    if changed:
        backup = path.with_suffix(".before-running-cost-fix.json")
        if not backup.exists():
            backup.write_bytes(path.read_bytes())
        write_json(path, data)


def campaign(rows, heldout, evaluator, seeds, heldout_seeds, trials, seed, max_evaluations, warm, folder):
    from smac import HyperparameterOptimizationFacade, Scenario
    from smac.multi_objective.parego import ParEGO
    from smac.runhistory.dataclasses import TrialInfo, TrialValue
    profile_path = folder/"profile.json"
    if profile_path.exists():
        profile = json.loads(profile_path.read_text())
        candidates = [json.loads(p.read_text()) for p in sorted((folder/"candidates").glob("*.json"))]
        export_frontier(folder, profile["frontier"], candidates, profile["presets"])
        return profile
    baseline_parameters = {**DEFAULT_PARAMETERS, **PRIOR_PARAMETERS, "evaluations": EVALUATION_STEP}
    print("Panel: baseline", flush=True)
    baseline = evaluator.panel(rows, baseline_parameters, seeds)
    candidates_path = folder/"candidates"
    candidates_path.mkdir(exist_ok=True)
    space = configuration_space(seed, max_evaluations)
    scenario = Scenario(space, name="pareto", output_directory=folder/"smac", objectives=["quality", "proposal_cost"],
                        n_trials=trials, seed=seed, deterministic=True, n_workers=1, use_default_config=True)
    count = 0
    def target(config, seed=0):
        nonlocal count
        parameters = decode(config, max_evaluations)
        point_id = fingerprint(parameters)
        path = candidates_path/f"{point_id}.json"
        if path.exists():
            point = json.loads(path.read_text())
        else:
            measured = evaluator.panel(rows, parameters, seeds)
            point = dict(id=point_id, parameters=parameters, measurements=measured,
                         **summarize(measured, baseline), execution=dict(evaluator.last_panel_stats))
            write_json(path, point)
        count += 1
        print(f"Pareto trial {count}: proposals={parameters['evaluations']:,} starts={parameters['starts']} quality={point['quality']:.6f}", flush=True)
        return dict(quality=point["quality"], proposal_cost=parameters["evaluations"]/max_evaluations)
    anchors = [baseline_parameters, {**baseline_parameters, "evaluations": max_evaluations}, *warm]
    unique = {fingerprint(p): p for p in anchors}
    additional = [as_config(space, p) for p in unique.values()][:max(0, trials-2)]
    design = HyperparameterOptimizationFacade.get_initial_design(scenario, n_configs=min(64, max(1, trials//4)), additional_configs=additional)
    intensifier = HyperparameterOptimizationFacade.get_intensifier(scenario, max_config_calls=1, max_incumbents=budget_steps(max_evaluations))
    repair_running_costs(folder/f"smac/pareto/{seed}/runhistory.json")
    smac = HyperparameterOptimizationFacade(scenario, target, initial_design=design, intensifier=intensifier,
                                           multi_objective_algorithm=ParEGO(scenario, rho=.05, seed=seed),
                                           overwrite=False, logging_level=30)
    # Saved RUNNING trials have no live worker after a restart.
    for info in smac.runhistory.get_running_trials():
        cost = target(info.config)
        smac.tell(info, TrialValue(cost=[cost["quality"], cost["proposal_cost"]]))
    # A changed search space gets a fresh SMAC state, seeded with old observations.
    # Reconstruct from the saved candidate panels; never reuse scaled old costs.
    for path in sorted(candidates_path.glob("*.json")):
        point = json.loads(path.read_text())
        config = as_config(space, point["parameters"])
        if not smac.runhistory.has_config(config):
            smac.tell(TrialInfo(config, seed=seed),
                      TrialValue(cost=[point["quality"], point["parameters"]["evaluations"]/max_evaluations]))
    smac.optimize()
    candidates = [json.loads(p.read_text()) for p in sorted(candidates_path.glob("*.json"))]
    if not candidates:
        raise RuntimeError("No successful complete candidate evaluations")
    frontier = pareto_front(candidates)
    training_presets = select_presets(frontier)
    print("Panel: heldout verification", flush=True)
    presets, validation = validate_presets(frontier, training_presets, heldout, evaluator, heldout_seeds)
    medium = next(p["parameters"] for p in frontier if p["id"] == presets["medium"])
    profile = dict(parameters=medium, frontier=frontier, presets=presets, training_presets=training_presets,
                   validation=validation, baseline_parameters=baseline_parameters, normalization=baseline,
                   candidates_evaluated=len(candidates), tolerances=PRESET_TOLERANCES)
    export_frontier(folder, frontier, candidates, presets)
    write_json(profile_path, profile)
    return profile


def tune(directory="instances/smac", output="flexo/profiles.json", workdir="results/pareto-tuning", *,
         trials=400, workers=0, max_evaluations=MAX_EVALUATIONS, seeds=(42, 43, 44),
         heldout_seeds=(142, 143, 144), seed=42, resume=False, reuse_from=None):
    trials = integer(trials, "trials", 1)
    workers = integer(workers, "workers") or (os.cpu_count() or 1)
    budget_steps(max_evaluations)
    seed = integer(seed, "seed")
    if len(seeds)!=3 or len(set(seeds))!=3 or len(heldout_seeds)!=3 or len(set(heldout_seeds))!=3:
        raise ValueError("Training and heldout panels need three distinct seeds each")
    seeds = [integer(s, "seed") for s in seeds]
    heldout_seeds = [integer(s, "heldout_seed") for s in heldout_seeds]
    if set(seeds) & set(heldout_seeds):
        raise ValueError("Training and heldout seeds must be disjoint")
    dataset, identity = load_dataset(directory)
    workdir = Path(workdir)
    manifest_path = workdir/"manifest.json"
    previous = json.loads(manifest_path.read_text()) if manifest_path.exists() else None
    if previous is not None and (previous.get("schema_version") != 4 or previous.get("mode") != "parego"):
        raise ValueError("This work directory uses an older tuning format; choose a new --workdir")
    warm = previous["warm_starts"] if previous is not None else warm_parameters(output, max_evaluations)
    manifest = dict(schema_version=4, mode="parego", dataset_sha256=identity,
                    core_sha256=hashlib.sha256(Path(_core.__file__).read_bytes()).hexdigest(),
                    source_sha256=fingerprint([Path(__file__).read_text(), Path(__file__).with_name("api.py").read_text()]),
                    evaluation_step=EVALUATION_STEP, max_evaluations=max_evaluations, max_starts=20,
                    trials=trials, workers=workers, seeds=seeds, heldout_seeds=heldout_seeds,
                    smac_seed=seed, warm_starts=warm, tolerances=PRESET_TOLERANCES)
    if previous is not None and "reused" in previous:
        manifest["reused"] = previous["reused"]
        if reuse_from is not None and str(Path(reuse_from).resolve()) != previous["reused"]["source"]:
            raise ValueError("Resume reuse source differs from the saved campaign")
    if previous is not None:
        if not resume:
            raise ValueError("Campaign already exists; use --resume")
        if previous != manifest:
            raise ValueError("Resume settings, optimizer, or dataset differ from the saved campaign")
    else:
        if any(workdir.glob("*")):
            raise ValueError("Nonempty work directory has no compatible manifest")
        workdir.mkdir(parents=True, exist_ok=True)
        if reuse_from is not None:
            manifest["reused"] = reuse_campaign(reuse_from, workdir, dataset, manifest, workers)
        write_json(manifest_path, manifest)
    evaluator = CachedEvaluator(workdir/"solves.sqlite3", workers)
    exported = dict(manifest, profiles={})
    try:
        for n in SIZES:
            folder = workdir/f"N{n}"; folder.mkdir(exist_ok=True)
            inherited = manifest.get("reused", {}).get("candidates", {}).get(str(n), 0)
            total_trials = trials + inherited
            print(f"N{n}: pareto search, trials={total_trials}, reused={inherited}, workers={workers}, instances={len(dataset['train'][n])} x 3 seeds", flush=True)
            exported["profiles"][str(n)] = campaign(dataset["train"][n], dataset["heldout"][n], evaluator,
                                                   seeds, heldout_seeds, total_trials, seed, max_evaluations, warm[str(n)], folder)
            print(f"N{n}: presets ready, frontier={len(exported['profiles'][str(n)]['frontier'])}", flush=True)
        write_json(output, exported)
        write_json(workdir/"progress.json", dict(complete=True, cache_hits=evaluator.hits, computed=evaluator.misses))
        return exported
    finally:
        evaluator.close()
