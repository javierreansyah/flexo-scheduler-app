"""Independent quality searches at fixed total proposal budgets."""
import hashlib
import json
import os
from pathlib import Path

from . import _core
from .api import DEFAULT_PARAMETERS, integer, parameters_checked
from .instances import SIZES, write_json
from .tuning import (CachedEvaluator, PRIOR_PARAMETERS, EVALUATION_STEP, as_config,
                     budget_steps, configuration_space, decode, fingerprint,
                     load_dataset, pareto_front, summarize)

BUDGETS = {
    10: dict(low=100_000, medium=100_000, high=100_000),
    30: dict(low=600_000, medium=10_000_000, high=100_000_000),
    50: dict(low=3_000_000, medium=20_000_000, high=100_000_000),
    100: dict(low=10_000_000, medium=20_000_000, high=100_000_000),
}


def fixed_space(budget, seed=42):
    from ConfigSpace import ConfigurationSpace, Constant
    budget_steps(budget)
    original = configuration_space(seed, budget)
    space = ConfigurationSpace(seed=seed)
    space.add(*[hp for name, hp in original.items() if name != "evaluation_steps"],
              Constant("evaluation_steps", budget // EVALUATION_STEP))
    return space


def source_candidates(source, n):
    if source is None:
        return []
    return [json.loads(p.read_text()) for p in sorted((source/f"N{n}/candidates").glob("*.json"))]


def fixed_campaign(rows, evaluator, seeds, baseline, budget, trials, seed, source, folder):
    from smac import HyperparameterOptimizationFacade, Scenario
    from smac.runhistory.dataclasses import TrialInfo, TrialValue
    folder.mkdir(parents=True, exist_ok=True)
    path = folder/"winner.json"
    if path.exists():
        return json.loads(path.read_text())
    candidates_path = folder/"candidates"
    candidates_path.mkdir(exist_ok=True)
    space = fixed_space(budget, seed)
    old = source_candidates(source, len(rows[0][2].movable))
    exact = [p for p in old if p["parameters"]["evaluations"] == budget]
    # Exact-budget observations seed the model; nearby budgets supply proposals only.
    for point in exact:
        parameters_checked(point["parameters"])
        measured = point["measurements"]
        if set(measured) != {name for name, _, _ in rows} or any(
                sorted(s["seed"] for s in row["samples"]) != sorted(seeds) for row in measured.values()):
            raise ValueError("Previous candidate has an incompatible instance/seed panel")
        point = dict(id=point["id"], parameters=point["parameters"], measurements=measured,
                     **summarize(measured, baseline), origin="previous exact budget")
        write_json(candidates_path/f"{point['id']}.json", point)
    known = {}
    for p in old:
        if p["parameters"]["evaluations"] == budget:
            known[as_config(space, p["parameters"])] = p["parameters"]
    total = trials + len(known)
    history_path = folder/f"smac/fixed/{seed}/runhistory.json"
    finished = json.loads(history_path.read_text())["stats"]["finished"] if history_path.exists() else len(known)
    print(f"Fixed search: {folder.parent.name}, budget={budget}, total={total}, finished={finished}, reused={len(known)}", flush=True)
    scenario = Scenario(space, name="fixed", output_directory=folder/"smac", objectives="quality",
                        n_trials=total, seed=seed, deterministic=True, n_workers=1)
    def target(config, seed=0):
        parameters = known.get(config) or decode(config, budget)
        assert parameters["evaluations"] == budget
        point_id = fingerprint(parameters)
        point_path = candidates_path/f"{point_id}.json"
        if point_path.exists():
            point = json.loads(point_path.read_text())
        else:
            measured = evaluator.panel(rows, parameters, seeds)
            point = dict(id=point_id, parameters=parameters, measurements=measured,
                         **summarize(measured, baseline), execution=dict(evaluator.last_panel_stats))
            write_json(point_path, point)
        return point["quality"]
    prior = {**DEFAULT_PARAMETERS, **PRIOR_PARAMETERS, "evaluations": budget}
    nearby = sorted(old, key=lambda p: (abs(p["parameters"]["evaluations"]-budget), p["quality"]))[:8]
    best = sorted(old, key=lambda p: p["quality"])[:8]
    proposals = [prior, {**DEFAULT_PARAMETERS, "evaluations": budget},
                 *[{**p["parameters"], "evaluations": budget} for p in nearby+best]]
    additional = list({as_config(space, p): None for p in proposals})[:max(0, trials-1)]
    design = HyperparameterOptimizationFacade.get_initial_design(
        scenario, n_configs=min(64, max(1, trials//4)), additional_configs=additional)
    intensifier = HyperparameterOptimizationFacade.get_intensifier(scenario, max_config_calls=1)
    from smac.callback import Callback
    class Progress(Callback):
        def on_tell_end(self, smbo, info, value):
            print(f"Fixed trial {smbo.runhistory.finished}/{total}: quality={value.cost:.6f}", flush=True)
    class ResumeFacade(HyperparameterOptimizationFacade):
        @property
        def meta(self):
            metadata = super().meta
            metadata['facade']['name'] = HyperparameterOptimizationFacade.__name__
            return metadata

        def _get_optimizer(self):
            from .smac_resume import check_resume_scenario
            check_resume_scenario(self._scenario)
            return super()._get_optimizer()
    smac = ResumeFacade(scenario, target, initial_design=design,
             intensifier=intensifier, callbacks=[Progress()], overwrite=False, logging_level=30)
    for info in smac.runhistory.get_running_trials():
        smac.tell(info, TrialValue(cost=target(info.config)))
    for point_path in sorted(candidates_path.glob("*.json")):
        point = json.loads(point_path.read_text())
        config = as_config(space, point["parameters"])
        if not smac.runhistory.has_config(config):
            smac.tell(TrialInfo(config, seed=seed), TrialValue(cost=point["quality"]))
    smac.optimize()
    points = [json.loads(p.read_text()) for p in candidates_path.glob("*.json")]
    winner = min(points, key=lambda p: (p["quality"], p["parameters"]["starts"], p["id"]))
    write_json(path, winner)
    return winner


def tune_fixed(directory="instances/smac", output=None, workdir="results/fixed-budget-tuning", *,
               trials=400, workers=0, seed=42, seeds=(42,43,44), heldout_seeds=(142,143,144),
               reuse_from=None, resume=False, validate_only=False):
    trials = integer(trials, "trials", 1)
    workers = integer(workers, "workers") or (os.cpu_count() or 1)
    seed = integer(seed, "seed")
    seeds = [integer(s, "seed") for s in seeds]
    heldout_seeds = [integer(s, "heldout_seed") for s in heldout_seeds]
    if len(seeds)!=3 or len(set(seeds))!=3 or len(heldout_seeds)!=3 or len(set(heldout_seeds))!=3 or set(seeds)&set(heldout_seeds):
        raise ValueError("Need three distinct training and heldout seeds, with disjoint panels")
    dataset, identity = load_dataset(directory)
    workdir = Path(workdir)
    source = Path(reuse_from).resolve() if reuse_from is not None else None
    core_hash = hashlib.sha256(Path(_core.__file__).read_bytes()).hexdigest()
    transition = None
    transition_path = workdir/"build-transition.json"
    if transition_path.exists():
        transition = json.loads(transition_path.read_text())
        if transition["new_core_sha256"] != core_hash or transition["dataset_sha256"] != identity:
            raise ValueError("Verified PGO transition does not match binary or dataset")
    source_hash = None
    if source is not None:
        if source == workdir.resolve():
            raise ValueError("Use a new workdir; reuse source must remain unchanged")
        old = json.loads((source/"manifest.json").read_text())
        for key, expected in dict(mode="parego", schema_version=4, dataset_sha256=identity,
                                  core_sha256=core_hash, seeds=seeds, heldout_seeds=heldout_seeds).items():
            compatible_core = (key == "core_sha256" and transition is not None
                               and old.get(key) == transition["old_core_sha256"])
            if old.get(key) != expected and not compatible_core:
                raise ValueError(f"Cannot reuse previous search: {key} differs")
        if not (source/"solves.sqlite3").exists():
            raise ValueError("Previous solve cache is missing")
        source_hash = fingerprint(old)
    manifest = dict(schema_version=1, mode="fixed-budget", dataset_sha256=identity,
                    core_sha256=core_hash, source_sha256=fingerprint([
                        Path(__file__).read_text(), Path(__file__).with_name("tuning.py").read_text(),
                        Path(__file__).with_name("api.py").read_text(),
                        Path(__file__).with_name("smac_resume.py").read_text()]),
                    budgets={str(n): v for n,v in BUDGETS.items()}, trials=trials, workers=workers,
                    seed=seed, seeds=seeds, heldout_seeds=heldout_seeds,
                    reuse_from=str(source) if source else None, reuse_manifest_sha256=source_hash)
    if transition is not None:
        manifest["build_transition_sha256"] = fingerprint(transition)
    manifest_path = workdir/"manifest.json"
    if manifest_path.exists():
        if not resume:
            raise ValueError("Campaign already exists; use --resume")
        if json.loads(manifest_path.read_text()) != manifest:
            raise ValueError("Resume settings, optimizer, dataset or reuse source differ")
    else:
        if any(workdir.glob("*")):
            raise ValueError("Nonempty workdir has no compatible manifest")
        write_json(manifest_path, manifest)
    if validate_only:
        return manifest
    evaluator = CachedEvaluator(workdir/"solves.sqlite3", workers,
                                read_cache=source/"solves.sqlite3" if source else None)
    exported = dict(manifest, profiles={})
    try:
        for n in SIZES:
            folder = workdir/f"N{n}"
            profile_path = folder/"profile.json"
            if profile_path.exists():
                exported["profiles"][str(n)] = json.loads(profile_path.read_text())
                print(f"N{n}: presets ready (saved)", flush=True)
                continue
            prior = {**DEFAULT_PARAMETERS, **PRIOR_PARAMETERS, "evaluations": EVALUATION_STEP}
            print(f"N{n}: fixed budgets {BUDGETS[n]}, workers={workers}", flush=True)
            baseline = evaluator.panel(dataset["train"][n], prior, seeds)
            winners = {b: fixed_campaign(dataset["train"][n], evaluator, seeds, baseline, b,
                       trials, seed, source, folder/f"budget-{b}") for b in dict.fromkeys(BUDGETS[n].values())}
            presets = {name: winners[b]["id"] for name,b in BUDGETS[n].items()}
            print("Panel: heldout evaluation (report only; no preset fallback)", flush=True)
            baseline_test = evaluator.panel(dataset["heldout"][n], prior, heldout_seeds)
            results = {}
            for point in winners.values():
                measured = evaluator.panel(dataset["heldout"][n], point["parameters"], heldout_seeds)
                results[point["id"]] = dict(measurements=measured, **summarize(measured, baseline_test))
            high = results[presets["high"]]
            gaps = {name: dict(overall=100*(results[pid]["quality"]/high["quality"]-1),
                    **{kind:100*(results[pid]["by_kind"][kind]/high["by_kind"][kind]-1)
                       for kind in ("clean","carryover")}) for name,pid in presets.items()}
            # Keep every preset point addressable for existing profile readers.
            profile = dict(parameters=winners[BUDGETS[n]["medium"]]["parameters"], presets=presets,
                      frontier=list(winners.values()), pareto_frontier=pareto_front(list(winners.values())),
                      budgets=BUDGETS[n], normalization=baseline,
                      validation=dict(points=results, baseline=baseline_test, gap_to_high_pct=gaps),
                      policy="fixed compute tiers; heldout reports gaps without replacing presets")
            write_json(profile_path, profile)
            exported["profiles"][str(n)] = profile
            print(f"N{n}: presets ready, heldout gaps={gaps}", flush=True)
        write_json(output or workdir/"profiles.json", exported)
        write_json(workdir/"progress.json", dict(complete=True, cache_hits=evaluator.hits, computed=evaluator.misses))
        return exported
    finally:
        evaluator.close()
