from signature import (
    ExperimentConfig,
    run_experiments_multiple_seeds,
)

import os
import json
import numpy as np
import pandas as pd
from datetime import datetime
from pathlib import Path
from tqdm import tqdm

from ConfigSpace import ConfigurationSpace, Float, Integer
from smac import Scenario, HyperparameterOptimizationFacade

TUNING_INSTANCES = [
    "instances/tuning/N15_K1_static_tune.json",
    "instances/tuning/N15_K2_rho1.5_tune.json",
    "instances/tuning/N30_K1_static_tune.json",
    "instances/tuning/N30_K2_rho1.5_tune.json",
    "instances/tuning/N50_K1_static_tune.json",
    "instances/tuning/N50_K2_rho1.5_tune.json",
    "instances/tuning/N50_K3_rho1.5_tune.json",
    "instances/tuning/N100_K1_static_tune.json",
    "instances/tuning/N100_K2_rho1.5_tune.json",
    "instances/tuning/N100_K3_rho1.5_tune.json",
]

# TUNING_INSTANCES = [
#     "instances/N15_K1_static_rep00.json",
#     "instances/N15_K2_rho1.5_rep00.json",
#     "instances/N30_K1_static_rep00.json",
#     # "instances/N30_K2_rho1.5_rep00.json",
#     "instances/N50_K1_static_rep00.json",
#     # "instances/N50_K2_rho1.5_rep00.json",
# ]

SEEDS = list(range(42, 72))  # number of runs for each evaluation


def load_instance(path):
    """Load a problem instance JSON and return (machine_rates, orders_data, job_batches, meta)."""
    with open(path) as f:
        d = json.load(f)
    return d["machine_rates"], d["orders_data"], d["job_batches"], d["meta"]


MOVE_NAMES = [
    "p_inter",
    "p_shift",
    "p_block",
]

BASELINE_ITER = 500000
BASELINE_STARTS = 10
BASELINE_T_MAX = 500
BASELINE_T_MIN = 0.001
BASELINE_N_S = 1000
BASELINE_RCL = 0.5
BASELINE_MOVE_PROBS = (0.5, 0.5, 0.5)  # [p_I, p_S, p_B]

# Baseline fitness per instance — populated once before SMAC starts
_baseline: dict[str, float] = {}

# Optimization bounds
T_MAX_BOUNDS = (0.01, 100_000.0)
T_MIN_BOUNDS = (1e-6, 1_000.0)
N_S_BOUNDS = (1, 5_000)
STARTS_BOUNDS = (1, 20)
RCL_BOUNDS = (0.0, 1.0)
TOTAL_EVALS = 5_000_000  # starts * iterations is fixed to this budget

N_MOVES = 3  # p_inter, p_shift, p_block

# ── Shared evaluation log ─────────────────────────────────────────────────────
_all_evaluations: list[dict] = []
_trial_counter = [0]
_best_tracker: dict = {
    "fitness": float("inf"),
    "config": None,
    "per_inst": {},
    "params": None,
}
_csv_path: list[str] = [None]  # mutable container so the target function can write
_pbar: list = [None]  # tqdm progress bar, created in run_smac_optimization


def compute_baseline(verbose: bool = True) -> None:
    """Run one evaluation with the default parameters and store per-instance
    fitness values in ``_baseline``.  All subsequent ``evaluate()`` calls
    divide by these values so every instance contributes equally.
    """
    global _baseline
    if _baseline:
        return  # already computed

    if verbose:
        print("Computing baseline fitness with default parameters…")

    move_probs = BASELINE_MOVE_PROBS

    if verbose:
        print("Computing baseline fitness with default parameters…")

    for path in TUNING_INSTANCES:
        m_rates, orders, batches, meta = load_instance(path)
        instance_name = os.path.splitext(os.path.basename(path))[0]

        cfg = ExperimentConfig(
            machine_production_rates=m_rates,
            sequence_dependent_setup_time=0.75,
            ink_weight=0.4,
            batch_flow_time_weight=0.6,
            iterations=BASELINE_ITER,
            T_max=BASELINE_T_MAX,
            T_min=BASELINE_T_MIN,
            N_s=BASELINE_N_S,
            rcl_alpha=BASELINE_RCL,
            move_probs=move_probs,
            orders_data=orders,
            job_batches=batches,
            num_starts=BASELINE_STARTS,
            show_summary=False,
            show_timeline_chart=False,
            show_timeline_table=False,
            scenario_name=f"baseline_{instance_name}",
        )
        results, _ = run_experiments_multiple_seeds(
            cfg, SEEDS, show_unique_timelines=False, verbose=False
        )
        _baseline[instance_name] = float(results["Fitness"].mean())
        if verbose:
            print(f"  {instance_name}: {_baseline[instance_name]:.5f}")

    if verbose:
        print("Baseline computed.\n")


def evaluate(config, seed: int = 0) -> float:
    """SMAC target function — lower is better (normalised combined fitness)."""
    T_max = float(config["T_max"])
    T_min = float(config["T_min"])
    T_min = min(T_min, T_max * 0.99)  # ensure T_min < T_max
    N_s = int(config["N_s"])
    starts = int(config["starts"])
    iterations = TOTAL_EVALS // starts
    rcl_alpha = float(config["rcl_alpha"])
    move_probs = (
        float(config["p_inter"]),
        float(config["p_shift"]),
        float(config["p_block"]),
    )

    per_instance_fitness: dict[str, float] = {}

    for path in TUNING_INSTANCES:
        m_rates, orders, batches, _ = load_instance(path)
        instance_name = os.path.splitext(os.path.basename(path))[0]

        cfg = ExperimentConfig(
            machine_production_rates=m_rates,
            sequence_dependent_setup_time=0.75,
            ink_weight=0.4,
            batch_flow_time_weight=0.6,
            iterations=iterations,
            T_max=T_max,
            T_min=T_min,
            N_s=N_s,
            rcl_alpha=rcl_alpha,
            move_probs=move_probs,
            orders_data=orders,
            job_batches=batches,
            num_starts=starts,
            show_summary=False,
            show_timeline_chart=False,
            show_timeline_table=False,
            scenario_name=f"smac_eval_{instance_name}",
        )
        results, _ = run_experiments_multiple_seeds(
            cfg, SEEDS, show_unique_timelines=False, verbose=False
        )
        per_instance_fitness[instance_name] = float(results["Fitness"].mean())

    # Normalise by baseline so each instance contributes equally
    if _baseline:
        normalised = {k: v / _baseline[k] for k, v in per_instance_fitness.items()}
    else:
        normalised = per_instance_fitness
    combined_fitness = float(np.mean(list(normalised.values())))

    # ── Track ────────────────────────────────────────────────────────────────
    _trial_counter[0] += 1
    t = _trial_counter[0]

    is_best = combined_fitness < _best_tracker["fitness"]
    if is_best:
        _best_tracker["fitness"] = combined_fitness
        _best_tracker["config"] = dict(config)
        _best_tracker["per_inst"] = per_instance_fitness
        _best_tracker["params"] = dict(
            T_max=T_max,
            T_min=T_min,
            N_s=N_s,
            starts=starts,
            iterations=iterations,
            rcl_alpha=rcl_alpha,
            p_inter=move_probs[0],
            p_shift=move_probs[1],
            p_block=move_probs[2],
        )

    row = {
        "trial": t,
        "fitness": combined_fitness,
        **{f"fitness_{k}": v for k, v in per_instance_fitness.items()},
        "starts": starts,
        "iterations": iterations,
        "T_max": T_max,
        "T_min": T_min,
        "N_s": N_s,
        "rcl_alpha": rcl_alpha,
        **{f"move_{MOVE_NAMES[j]}": move_probs[j] for j in range(N_MOVES)},
    }
    _all_evaluations.append(row)

    # Incremental CSV flush
    if _csv_path[0] is not None:
        try:
            pd.DataFrame(_all_evaluations).to_csv(_csv_path[0], index=False)
        except Exception:
            pass

    # ── Detailed print ───────────────────────────────────────────────────────
    marker = " <-- new best" if is_best else ""
    print(f"\n[Eval {t}]{marker}")
    print(
        f"  fitness: {combined_fitness:.10f}  |  best: {_best_tracker['fitness']:.10f}"
    )

    # Per-instance: raw + normalised (no baseline)
    print("  per-instance:")
    for inst, raw in per_instance_fitness.items():
        rel = normalised.get(inst, float("nan"))
        print(f"    {inst:<35s}  raw={raw:.10f}  norm={rel:.10f}")

    # Current trial params (one line)
    print(
        f"  params: starts={starts}  iters={iterations}  T_max={T_max:.10f}"
        f"  T_min={T_min:.10f}  N_s={N_s}  rcl={rcl_alpha:.10f}"
        f"  probs=({move_probs[0]:.4f},{move_probs[1]:.4f},{move_probs[2]:.4f})"
    )

    # Best params so far (only when not a new best, otherwise it's identical)
    if _best_tracker["params"] is not None and not is_best:
        bp = _best_tracker["params"]
        print(
            f"  best:   starts={bp['starts']}  iters={bp['iterations']}  T_max={bp['T_max']:.10f}"
            f"  T_min={bp['T_min']:.10f}  N_s={bp['N_s']}  rcl={bp['rcl_alpha']:.10f}"
            f"  probs=({bp['p_inter']:.4f},{bp['p_shift']:.4f},{bp['p_block']:.4f})"
        )
        print("  best per-instance:")
        for inst, raw in _best_tracker["per_inst"].items():
            norm = raw / _baseline[inst] if inst in _baseline else float("nan")
            print(f"    {inst:<35s}  raw={raw:.10f}  norm={norm:.10f}")

    # Update tqdm bar
    if _pbar[0] is not None:
        _pbar[0].update(1)
        if is_best:
            _pbar[0].set_postfix(best=f"{_best_tracker['fitness']:.8f}")

    return combined_fitness


def build_configspace() -> ConfigurationSpace:
    cs = ConfigurationSpace(seed=0)
    cs.add(
        Float(
            "T_max",
            (T_MAX_BOUNDS[0], T_MAX_BOUNDS[1]),
            default=BASELINE_T_MAX,
            log=True,
        )
    )
    cs.add(
        Float(
            "T_min",
            (T_MIN_BOUNDS[0], T_MIN_BOUNDS[1]),
            default=BASELINE_T_MIN,
            log=True,
        )
    )
    cs.add(Integer("N_s", (N_S_BOUNDS[0], N_S_BOUNDS[1]), default=BASELINE_N_S))
    cs.add(
        Integer("starts", (STARTS_BOUNDS[0], STARTS_BOUNDS[1]), default=BASELINE_STARTS)
    )
    cs.add(Float("rcl_alpha", (RCL_BOUNDS[0], RCL_BOUNDS[1]), default=BASELINE_RCL))
    cs.add(Float("p_inter", (0.0, 1.0), default=BASELINE_MOVE_PROBS[0]))
    cs.add(Float("p_shift", (0.0, 1.0), default=BASELINE_MOVE_PROBS[1]))
    cs.add(Float("p_block", (0.0, 1.0), default=BASELINE_MOVE_PROBS[2]))
    return cs


def run_smac_optimization(
    n_trials: int = 200,
    seed: int = 42,
    verbose: bool = True,
    save_csv: bool = True,
    smac_output_dir: str = "smac_output",
):
    """Optimise SA hyper-parameters with SMAC (HyperparameterOptimizationFacade).

    Parameters
    ----------
    n_trials:
        Total number of SMAC evaluations (budget).
    seed:
        RNG seed for SMAC.
    verbose:
        Print progress after every evaluation.
    save_csv:
        Persist all evaluations incrementally to ``tables/``.
    smac_output_dir:
        Directory for SMAC internal artefacts (logs, runhistory, …).
    """

    # ------------------------------------------------------------------
    # 0.  Compute baseline (once) for normalised fitness
    # ------------------------------------------------------------------
    compute_baseline(verbose=verbose)

    # ------------------------------------------------------------------
    # 1.  CSV path
    # ------------------------------------------------------------------
    if save_csv:
        os.makedirs("tables", exist_ok=True)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        _csv_path[0] = f"tables/smac_evaluations_{timestamp}.csv"

    # ------------------------------------------------------------------
    # 2.  ConfigSpace + Scenario
    # ------------------------------------------------------------------
    cs = build_configspace()

    scenario = Scenario(
        configspace=cs,
        name=f"sa_tuning_{datetime.now().strftime('%Y%m%d_%H%M%S')}",
        output_directory=Path(smac_output_dir),
        n_trials=n_trials,
        seed=seed,
        deterministic=True,  # evaluate() averages over many seeds already
    )

    # ------------------------------------------------------------------
    # 3.  Run SMAC
    # ------------------------------------------------------------------
    if verbose:
        print(f"Starting SMAC with budget={n_trials} trials, seed={seed}\n")

    _pbar[0] = tqdm(total=n_trials, desc="SMAC trials", unit="trial")

    smac = HyperparameterOptimizationFacade(
        scenario=scenario,
        target_function=evaluate,
        overwrite=True,
    )

    incumbent = smac.optimize()

    if _pbar[0] is not None:
        _pbar[0].close()
        _pbar[0] = None

    # ------------------------------------------------------------------
    # 4.  Results
    # ------------------------------------------------------------------
    best_cfg = dict(incumbent)
    best_fitness = _best_tracker["fitness"]
    best_per_inst = _best_tracker["per_inst"]
    best_params = _best_tracker.get("params", {})

    if verbose:
        print("\n" + "=" * 65)
        print("SMAC optimisation finished.")
        print(f"Best fitness (normalised): {best_fitness:.10f}")
        print("Best per-instance fitness:")
        for inst, v in best_per_inst.items():
            base = _baseline.get(inst, float("nan"))
            norm = v / base if base else float("nan")
            print(f"  {inst}: raw={v:.10f}  norm={norm:.6f}  (baseline={base:.5f})")
        if best_params:
            print("Best parameters:")
            print(
                f"  starts={best_params['starts']}  iterations={best_params['iterations']}"
                f"  (product={best_params['starts'] * best_params['iterations']})"
            )
            print(
                f"  T_max={best_params['T_max']:.10f}"
                f"  T_min={best_params['T_min']:.10f}"
                f"  N_s={best_params['N_s']}"
            )
            print(f"  rcl_alpha={best_params['rcl_alpha']:.10f}")
            print(
                f"  move_probs=(p_inter={best_params['p_inter']:.10f},"
                f" p_shift={best_params['p_shift']:.10f},"
                f" p_block={best_params['p_block']:.10f})"
            )
        print("=" * 65)

    # Final CSV flush
    if _csv_path[0] is not None:
        try:
            pd.DataFrame(_all_evaluations).to_csv(_csv_path[0], index=False)
            if verbose:
                print(f"Saved evaluations to {_csv_path[0]}")
        except Exception:
            pass

    return {
        "best_config": best_cfg,
        "best_fitness": best_fitness,
        "per_instance_fitness": best_per_inst,
        "best_params": best_params,
        "all_evaluations": _all_evaluations,
        "incumbent": incumbent,
        "smac": smac,
    }


if __name__ == "__main__":
    run_smac_optimization(n_trials=300, seed=42, verbose=True)
