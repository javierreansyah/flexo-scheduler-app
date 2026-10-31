"""Independent SMAC campaigns by movable-job count, using frozen snapshots."""
import hashlib
import json
from pathlib import Path
import statistics
import time
import sqlite3

from . import _core

from .api import DEFAULT_PARAMETERS, optimize, prepare
from .instances import SIZES, write_json


def configuration_space(seed=42, reduction_budget=None):
    from ConfigSpace import ConfigurationSpace, Constant, Float, Integer
    cs = ConfigurationSpace(seed=seed)
    cs.add(Float("t_max", (.01, 100_000.), default=500., log=True),
           Float("temperature_ratio", (1e-8, .99), default=.001/500, log=True),
           Integer("stage_length", (1, 5000), default=1000),
           Integer("starts", (1, 4), default=4), Float("rcl_alpha", (0., 1.), default=.5),
           Float("p_inter", (0., 1.), default=.5), Float("p_shift", (0., 1.), default=.5),
           Float("p_block", (0., 1.), default=.5))
    if reduction_budget is not None:
        steps = budget_steps(reduction_budget)
        cs.add(Constant("evaluation_steps", 1) if steps == 1 else
               Integer("evaluation_steps", (1, steps), default=steps, log=True))
    return cs


def decode(config, evaluations):
    maximum = evaluations
    params = dict(config)
    if "evaluation_steps" in params:
        from .api import integer
        steps = integer(params.pop("evaluation_steps"), "evaluation_steps", 1)
        evaluations = steps * EVALUATION_STEP
        if evaluations > maximum:
            raise ValueError("Efficiency budget exceeds reference budget")
    params["t_min"] = params["t_max"] * params.pop("temperature_ratio")
    return {**DEFAULT_PARAMETERS, **params, "evaluations": evaluations}


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


def normalized(measured, baseline):
    return statistics.mean(row["fitness"]/max(baseline[name]["fitness"], 1e-12) for name, row in measured.items())


REFERENCE_BUDGET = 10_000_000
EVALUATION_STEP = 100_000


def budget_steps(evaluations):
    from .api import integer
    evaluations = integer(evaluations, "evaluations", EVALUATION_STEP)
    if evaluations % EVALUATION_STEP or evaluations > 2_000_000_000:
        raise ValueError("Reference budget must be a multiple of 100,000 within the native integer limit")
    return evaluations // EVALUATION_STEP
PRIOR_PARAMETERS = dict(t_max=.1603194019, t_min=.0116169910, stage_length=4908,
                        starts=4, rcl_alpha=.2746914740, p_inter=.6647498733,
                        p_shift=.5008078735, p_block=.2693767726)


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, allow_nan=False).encode()).hexdigest()


def quality_failures(measured, reference):
    failures = []
    for name, row in measured.items():
        expected = reference[name]["fitness"]
        if row["fitness"] > expected + 1e-9*max(1., abs(expected)):
            failures.append(dict(instance=name, reference=expected, candidate=row["fitness"],
                                 relative_loss=(row["fitness"]-expected)/max(abs(expected), 1e-12)))
    return failures


class CachedEvaluator:
    """Commit complete individual solves; interrupted panels can reuse them."""
    def __init__(self, path, threads):
        self.db = sqlite3.connect(path)
        self.db.execute("CREATE TABLE IF NOT EXISTS solves (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        self.threads = threads
        self.hits = self.misses = 0

    def close(self):
        self.db.close()

    def measure(self, row, parameters, seeds):
        name, kind, problem = row
        identity = fingerprint(problem.snapshot)
        values = []
        for seed in seeds:
            key = fingerprint([identity, parameters, seed])
            record = self.db.execute("SELECT value FROM solves WHERE key=?", (key,)).fetchone()
            if record is None:
                result = optimize(problem, parameters, seed, self.threads)
                value = dict(seed=seed, fitness=result["fitness"], seconds=result["total_runtime"])
                with self.db:
                    self.db.execute("INSERT INTO solves VALUES (?,?)", (key, json.dumps(value, allow_nan=False)))
                self.misses += 1
            else:
                value = json.loads(record[0])
                self.hits += 1
            values.append(value)
        return dict(kind=kind, fitness=statistics.mean(v["fitness"] for v in values),
                    seconds=sum(v["seconds"] for v in values), samples=values)

    def panel(self, rows, parameters, seeds):
        return {row[0]: self.measure(row, parameters, seeds) for row in rows}


def as_config(space, parameters, reduction=False):
    from ConfigSpace import Configuration
    values = {k: parameters[k] for k in ("t_max", "stage_length", "starts", "rcl_alpha", "p_inter", "p_shift", "p_block")}
    values["temperature_ratio"] = parameters["t_min"]/parameters["t_max"]
    if reduction:
        values["evaluation_steps"] = budget_steps(parameters["evaluations"])
    return Configuration(space, values)


def log_trial(path, row):
    with Path(path).open("a", encoding="utf-8") as stream:
        stream.write(json.dumps(row, allow_nan=False)+"\n")


def reference_tuning(rows, evaluator, seeds, budget, calls, seed, directory):
    from smac import AlgorithmConfigurationFacade, HyperparameterOptimizationFacade, Scenario
    path = directory/"reference.json"
    if path.exists():
        return json.loads(path.read_text())
    default = {**DEFAULT_PARAMETERS, "evaluations": budget}
    prior = {**default, **PRIOR_PARAMETERS}
    baseline = evaluator.panel(rows, default, seeds)
    lookup = {row[0]: row for row in rows}
    space = configuration_space(seed)
    scenario = Scenario(space, name="reference", output_directory=directory/"reference-smac",
                        instances=list(lookup), deterministic=True, n_trials=calls, seed=seed,
                        use_default_config=True, n_workers=1)
    count = 0
    def target(config, instance, seed=0):
        nonlocal count
        parameters = decode(config, budget)
        result = evaluator.measure(lookup[instance], parameters, seeds)
        score = result["fitness"]/max(baseline[instance]["fitness"], 1e-12)
        count += 1
        log_trial(directory/"reference-trials.jsonl", dict(instance=instance, parameters=parameters, result=result, score=score))
        print(f"Reference instance evaluation {count}: {instance}, normalized fitness={score:.6f}", flush=True)
        return score
    design = HyperparameterOptimizationFacade.get_initial_design(
        scenario, n_configs=min(32, max(1, calls//4)), additional_configs=[as_config(space, prior)] if calls >= 4 else [])
    intensifier = AlgorithmConfigurationFacade.get_intensifier(scenario, max_config_calls=len(rows), max_incumbents=1)
    smac = AlgorithmConfigurationFacade(scenario, target, initial_design=design, intensifier=intensifier,
                                       overwrite=False, logging_level=30)
    incumbent = smac.optimize()
    configs = sorted(smac.runhistory.get_configs(), key=lambda c: smac.runhistory.average_cost(c))[:5]
    candidates = [default, prior, decode(incumbent, budget)] + [decode(c, budget) for c in configs]
    finalists = {}
    for params in candidates:
        key = fingerprint(params)
        if key not in finalists:
            measured = evaluator.panel(rows, params, seeds)
            finalists[key] = dict(parameters=params, instances=measured, score=normalized(measured, baseline))
    result = min(finalists.values(), key=lambda r: r["score"])
    result = dict(result, baseline=baseline, finalists=[dict(parameters=r["parameters"], score=r["score"]) for r in finalists.values()])
    write_json(path, result)
    return result


def reduce_budget(rows, heldout, evaluator, seeds, heldout_seeds, reference, trials, seed, directory):
    from smac import HyperparameterOptimizationFacade, Scenario
    path = directory/"profile.json"
    if path.exists():
        return json.loads(path.read_text())
    reference_parameters = reference["parameters"]
    budget = reference_parameters["evaluations"]
    history = directory/"reduction-trials.jsonl"
    space = configuration_space(seed, reduction_budget=budget)
    count = 0
    def assess(parameters):
        measured = {}
        for row in rows:
            measured[row[0]] = evaluator.measure(row, parameters, seeds)
            failures = quality_failures(measured, reference["instances"])
            if failures:
                return dict(parameters=parameters, feasible=False, complete=False, instances=measured,
                            failures=failures, score=1.+failures[0]["relative_loss"])
        return dict(parameters=parameters, feasible=True, complete=True, instances=measured, failures=[],
                    score=parameters["evaluations"]/budget,
                    normalized_fitness=normalized(measured, reference["instances"]))
    def target(config, seed=0):
        nonlocal count
        row = assess(decode(config, budget))
        log_trial(history, row)
        count += 1
        print(f"Reduction trial {count}: budget={row['parameters']['evaluations']:,}, starts={row['parameters']['starts']}, passed={row['feasible']}, instances={len(row['instances'])}", flush=True)
        return row["score"]
    scenario = Scenario(space, name="reduction", output_directory=directory/"reduction-smac",
                        n_trials=trials, seed=seed, deterministic=True, n_workers=1)
    warm = [as_config(space, reference_parameters, True)]
    design = HyperparameterOptimizationFacade.get_initial_design(
        scenario, n_configs=min(24, max(1, trials//4)), additional_configs=warm if trials >= 4 else [])
    smac = HyperparameterOptimizationFacade(scenario, target, initial_design=design, overwrite=False, logging_level=30)
    smac.optimize()
    # Always retain the exact reference as a feasible fallback.
    feasible = [dict(parameters=reference_parameters, instances=reference["instances"], normalized_fitness=1.)]
    if history.exists():
        for line in history.read_text(encoding="utf-8").splitlines():
            try:
                trial = json.loads(line)
            except json.JSONDecodeError:
                continue  # A killed process can leave an incomplete final log line.
            if trial["feasible"] and trial["complete"]:
                feasible.append(trial)
    # Re-evaluate SMAC's configurations using the solve cache if a crash occurred
    # between SMAC persistence and appending a completed trial record.
    for config in smac.runhistory.get_configs():
        params = decode(config, budget)
        if not any(r["parameters"] == params for r in feasible):
            row = assess(params)
            if row["feasible"]:
                feasible.append(row)
    winner = min(feasible, key=lambda r: (r["parameters"]["evaluations"], r["normalized_fitness"]))
    heldout_reference = evaluator.panel(heldout, reference_parameters, heldout_seeds)
    heldout_candidate = evaluator.panel(heldout, winner["parameters"], heldout_seeds)
    failures = quality_failures(heldout_candidate, heldout_reference)
    selected = reference_parameters if failures else winner["parameters"]
    report = dict(parameters=selected, reference_parameters=reference_parameters,
                  candidate_parameters=winner["parameters"], accepted_reduction=not failures and selected["evaluations"] < budget,
                  heldout_failures=failures, training_reference=reference["instances"],
                  training_candidate=winner["instances"], heldout_reference=heldout_reference,
                  heldout_candidate=heldout_candidate, heldout_selected=heldout_reference if failures else heldout_candidate,
                  proposal_reduction=1.-selected["evaluations"]/budget)
    report["heldout_by_kind"] = {
        kind: dict(reference_fitness=statistics.mean(r["fitness"] for r in heldout_reference.values() if r["kind"] == kind),
                   candidate_fitness=statistics.mean(r["fitness"] for r in heldout_candidate.values() if r["kind"] == kind),
                   reference_seconds=sum(r["seconds"] for r in heldout_reference.values() if r["kind"] == kind),
                   selected_seconds=sum(r["seconds"] for r in report["heldout_selected"].values() if r["kind"] == kind))
        for kind in ("clean", "carryover")}
    write_json(path, report)
    return report


def tune(directory="instances/smac", output="flexo/profiles.json", workdir="results/tuning-10m-100k", *,
         reference_calls=1000, reduction_trials=100, evaluations=None, seeds=(42, 43, 44),
         heldout_seeds=(142, 143, 144), seed=42, num_threads=0, stage="all", resume=False):
    from .api import integer
    if stage not in ("reference", "reduce", "all"):
        raise ValueError("Unknown tuning stage")
    reference_calls = integer(reference_calls, "reference_calls", 1)
    reduction_trials = integer(reduction_trials, "reduction_trials", 1)
    if len(seeds) != 3 or len(set(seeds)) != 3 or len(heldout_seeds) != 3 or len(set(heldout_seeds)) != 3:
        raise ValueError("Training and heldout seed panels must each contain three distinct seeds")
    seeds = [integer(s, "seed") for s in seeds]
    heldout_seeds = [integer(s, "heldout_seed") for s in heldout_seeds]
    if set(seeds) & set(heldout_seeds):
        raise ValueError("Training and heldout seeds must be disjoint")
    reference_budget = REFERENCE_BUDGET if evaluations is None else evaluations
    reference_budget = budget_steps(reference_budget) * EVALUATION_STEP
    budgets = {n: reference_budget for n in SIZES}
    dataset, identity = load_dataset(directory)
    manifest = dict(schema_version=3, evaluation_step=EVALUATION_STEP, dataset_sha256=identity,
                    core_sha256=hashlib.sha256(Path(_core.__file__).read_bytes()).hexdigest(),
                    source_sha256=fingerprint([Path(__file__).read_text(), Path(__file__).with_name("api.py").read_text()]),
                    reference_budgets=budgets, seeds=seeds, heldout_seeds=heldout_seeds,
                    reference_calls=reference_calls, reduction_trials=reduction_trials, smac_seed=seed,
                    num_threads=integer(num_threads, "num_threads"))
    # JSON roundtrip makes integer-keyed dictionaries comparable after restart.
    manifest = json.loads(json.dumps(manifest))
    workdir = Path(workdir)
    manifest_path = workdir/"manifest.json"
    if manifest_path.exists():
        if not resume:
            raise ValueError("Campaign already exists; use --resume")
        if json.loads(manifest_path.read_text()) != manifest:
            raise ValueError("Resume settings, optimizer, or dataset differ from the saved campaign")
    else:
        if any(workdir.glob("*")):
            raise ValueError("Nonempty workdir has no compatible campaign manifest")
        workdir.mkdir(parents=True, exist_ok=True)
        write_json(manifest_path, manifest)
    evaluator = CachedEvaluator(workdir/"solves.sqlite3", num_threads)
    exported = dict(manifest, profiles={})
    try:
        for n in SIZES:
            folder = workdir/f"N{n}"
            folder.mkdir(exist_ok=True)
            # Interleave case types so early rejection does not always begin on
            # the same type of production state.
            groups = [[row for row in dataset["train"][n] if row[1] == kind] for kind in ("clean", "carryover")]
            rows = [row for pair in zip(*groups) for row in pair]
            print(f"N{n}: stage={stage}, reference={budgets[n]:,}, training={len(rows)} x 3 seeds", flush=True)
            if stage == "reduce" and not (folder/"reference.json").exists():
                raise ValueError(f"N{n}: reduction requires a completed reference stage")
            reference = reference_tuning(rows, evaluator, seeds, budgets[n], reference_calls, seed, folder)
            print(f"N{n}: reference complete, starts={reference['parameters']['starts']}, score={reference['score']:.6f}", flush=True)
            if stage == "reference":
                continue
            exported["profiles"][str(n)] = reduce_budget(rows, dataset["heldout"][n], evaluator, seeds,
                                                       heldout_seeds, reference, reduction_trials, seed, folder)
            profile = exported["profiles"][str(n)]
            print(f"N{n}: selected {profile['parameters']['evaluations']:,} proposals, starts={profile['parameters']['starts']}, reduced={profile['accepted_reduction']}", flush=True)
        if stage in ("all", "reduce"):
            write_json(output, exported)
        write_json(workdir/"progress.json", dict(stage=stage, profiles=list(exported["profiles"]), cache_hits=evaluator.hits, solves=evaluator.misses))
        return exported
    finally:
        evaluator.close()
