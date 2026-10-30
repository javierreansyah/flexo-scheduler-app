"""Independent SMAC campaigns by movable-job count, using frozen snapshots."""
import hashlib
import json
from pathlib import Path
import statistics

from .api import DEFAULT_PARAMETERS, optimize, prepare
from .instances import SIZES, write_json


def configuration_space(seed=42):
    from ConfigSpace import ConfigurationSpace, Float, Integer
    cs = ConfigurationSpace(seed=seed)
    cs.add(Float("t_max", (.01, 100_000.), default=500., log=True),
           Float("temperature_ratio", (1e-8, .99), default=.001/500, log=True),
           Integer("stage_length", (1, 5000), default=1000),
           Integer("starts", (1, 20), default=10), Float("rcl_alpha", (0., 1.), default=.5),
           Float("p_inter", (0., 1.), default=.5), Float("p_shift", (0., 1.), default=.5),
           Float("p_block", (0., 1.), default=.5))
    return cs


def decode(config, evaluations):
    params = dict(config)
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


def measure(rows, parameters, seeds, threads):
    return {name: dict(kind=kind, fitness=statistics.mean(
        optimize(p, parameters, seed, threads)["fitness"] for seed in seeds)) for name, kind, p in rows}


def normalized(measured, baseline):
    return statistics.mean(row["fitness"]/max(baseline[name]["fitness"], 1e-12) for name, row in measured.items())


def tune(directory="instances/smac", output="flexo/profiles.json", workdir="results/tuning",
         trials=200, evaluations=5_000_000, seeds=tuple(range(42, 72)), seed=42, num_threads=0):
    from smac import HyperparameterOptimizationFacade, Scenario
    if trials < 1 or evaluations < 1 or not seeds:
        raise ValueError("trials/evaluations must be positive and seeds nonempty")
    dataset, identity = load_dataset(directory)
    workdir = Path(workdir)
    workdir.mkdir(parents=True, exist_ok=True)
    if any((workdir/f"N{n}").exists() for n in SIZES):
        raise ValueError("Tuning work directory already contains campaigns; choose a new directory")
    baseline_parameters = {**DEFAULT_PARAMETERS, "evaluations": evaluations}
    exported = dict(schema_version=1, dataset_sha256=identity, seeds=list(seeds), smac_seed=seed,
                    evaluations=evaluations, trials=trials, profiles={})
    for n in SIZES:
        rows = dataset["train"][n]
        print(f"N{n}: computing fixed baseline on {len(rows)} training snapshots", flush=True)
        baseline = measure(rows, baseline_parameters, seeds, num_threads)
        campaign_dir = workdir/f"N{n}"
        campaign_dir.mkdir()
        history = campaign_dir/"evaluations.jsonl"
        def target(config, seed=0):
            # The fixed seed panel makes every candidate comparable.
            params = decode(config, evaluations)
            measured = measure(rows, params, seeds, num_threads)
            score = normalized(measured, baseline)
            with history.open("a", encoding="utf-8") as stream:
                stream.write(json.dumps(dict(parameters=params, score=score, instances=measured), allow_nan=False)+"\n")
            return score
        cs = configuration_space(seed)
        scenario = Scenario(cs, name=f"N{n}", output_directory=campaign_dir/"smac",
                            n_trials=trials, seed=seed, deterministic=True, n_workers=1, use_default_config=True)
        design = HyperparameterOptimizationFacade.get_initial_design(scenario, n_configs=min(10, max(1, trials//2)))
        smac = HyperparameterOptimizationFacade(scenario, target, initial_design=design, overwrite=False,
                                               logging_level=30)
        incumbent = smac.optimize()
        parameters = decode(incumbent, evaluations)
        heldout = measure(dataset["heldout"][n], parameters, seeds, num_threads)
        heldout_baseline = measure(dataset["heldout"][n], baseline_parameters, seeds, num_threads)
        report = dict(parameters=parameters, training_baseline=baseline,
                      heldout=heldout, heldout_baseline=heldout_baseline,
                      heldout_normalized_fitness=normalized(heldout, heldout_baseline),
                      heldout_by_kind={kind: statistics.mean(row["fitness"] for row in heldout.values() if row["kind"] == kind)
                                       for kind in ("clean", "carryover")})
        exported["profiles"][str(n)] = report
        write_json(campaign_dir/"profile.json", report)
        print(f"N{n}: held-out relative fitness {report['heldout_normalized_fitness']:.4f}", flush=True)
    # Publish all profiles together; failed campaigns leave the previous file intact.
    write_json(output, exported)
    return exported
