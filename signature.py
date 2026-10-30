import json
import os
import math
import time
from datetime import datetime
from collections import Counter
from dataclasses import dataclass, field, replace
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import matplotlib.colors as mcolors
from IPython.display import display, HTML
from itertools import product
from tqdm import tqdm
import matplotlib.cm as cm
import matplotlib.colors as mcolors
from collections import Counter
from itertools import combinations, permutations

import optimizer as cpp_optimizer
import ablation as cpp_ablation


def changeover(prev_inks: tuple[int, ...], next_inks: tuple[int, ...]) -> int:
    A, B = Counter(prev_inks), Counter(next_inks)
    if A == B:
        return 0

    rem, add = [], []
    for lvl in set(A) | set(B):
        d = A.get(lvl, 0) - B.get(lvl, 0)
        ((rem if d > 0 else add).extend([lvl] * abs(d)) if d else None)

    m = min(len(rem), len(add))
    deletions = len(rem) - m
    best = 10**9

    rem_choices = (
        [tuple(range(len(rem)))] if len(rem) <= m else combinations(range(len(rem)), m)
    )
    add_choices = (
        [tuple(range(len(add)))] if len(add) <= m else combinations(range(len(add)), m)
    )

    for ridx in rem_choices:
        r = [rem[i] for i in ridx]
        for aidx in add_choices:
            sel = [add[i] for i in aidx]
            for p in permutations(sel):
                cost = deletions + sum(1 for x, y in zip(r, p) if x > y)
                if cost < best:
                    best = cost

    return best


PRODUCTION_HOURS_PER_DAY = 8.0


def _day_boundary_crossed(t_prev, t_now):
    """True if any shift boundary falls between t_prev and t_now."""
    if t_now < PRODUCTION_HOURS_PER_DAY:
        return False
    k_first = max(1, math.ceil(t_prev / PRODUCTION_HOURS_PER_DAY))
    return k_first * PRODUCTION_HOURS_PER_DAY <= t_now


def _next_shift_end(t):
    """End-of-shift time for the shift containing t."""
    return (math.floor(t / PRODUCTION_HOURS_PER_DAY) + 1) * PRODUCTION_HOURS_PER_DAY


def build_timeline_data(schedule, job_batches, cfg):
    job_arrival_times = {
        str(o): b["arrival_time"] for b in job_batches for o in b["orders"]
    }

    # Batch-based colour palette (consistent with create_timeline_chart)
    unique_batches = sorted(set(b["arrival_time"] for b in job_batches))
    cmap_obj = cm.get_cmap("viridis")
    _batch_positions = [0.2, 0.4, 0.6, 0.8]
    batch_color_map = {
        b: mcolors.to_hex(cmap_obj(_batch_positions[i % len(_batch_positions)]))
        for i, b in enumerate(unique_batches)
    }

    all_orders = set()
    timeline_rows = []

    for m, jobs in schedule.items():
        t, prev = 0.0, tuple()
        for seq, j in enumerate(jobs, 1):
            rate = cfg.machine_production_rates[m]
            proc = j.production_quantity / rate / 60
            earliest = max(t, j.arrival_time)

            # Reset inks if a shift boundary was crossed since last completion
            if _day_boundary_crossed(t, earliest):
                prev = tuple()

            changes = changeover(prev, j.inks)
            setup = cfg.sequence_dependent_setup_time if changes > 0 else 0.0
            total_duration = setup + proc

            # No preemption: if job would cross shift boundary, push to next shift
            shift_end = _next_shift_end(earliest)
            if earliest + total_duration > shift_end:
                earliest = shift_end
                prev = tuple()  # inks reset due to end-of-day cleaning
                changes = changeover(prev, j.inks)
                setup = cfg.sequence_dependent_setup_time if changes > 0 else 0.0
                total_duration = setup + proc

            start = earliest + setup
            end = start + proc

            batch_arrival = job_arrival_times.get(j.order_code, 0)

            timeline_rows.append(
                {
                    "machine": m,
                    "order_code": j.order_code,
                    "inks": j.inks,
                    "inks_display": ", ".join(map(str, j.inks)) or "0",
                    "quantity": j.production_quantity,
                    "start_hours": start,
                    "end_hours": end,
                    "duration": end - start,
                    "ink_violation": changes > 0,
                    "sequence": seq,
                    "rate": rate,
                    "setup_time": setup,
                    "num_changes": changes,
                    "color": batch_color_map.get(batch_arrival, "#808080"),
                }
            )
            t, prev = end, j.inks
            all_orders.add(j.order_code)

    color_map = {
        o: batch_color_map.get(job_arrival_times.get(o, 0), "#808080")
        for o in sorted(all_orders)
    }

    return timeline_rows, color_map, job_arrival_times


def print_production_summary(df_timeline, schedule, best_fit, batch_flow_time, cfg):
    df = pd.DataFrame(df_timeline) if isinstance(df_timeline, list) else df_timeline
    if df.empty:
        return print("No timeline data.")
    total_jobs, total_qty = len(df), int(df["quantity"].sum())
    ink = int(df["num_changes"].sum())

    core_metrics_data = [
        ["Fitness", f"{best_fit:.3f}"],
        ["Penalti Tinta", f"{ink}"],
        ["Batch Flow Time (h)", f"{batch_flow_time:.2f}"],
    ]

    core_metrics_df = pd.DataFrame(core_metrics_data, columns=["Metrik", "Nilai"])
    print("\nMETRIK INTI")
    display(HTML(core_metrics_df.to_html(index=False, classes="table table-striped")))


def create_timeline_chart(
    timeline_data,
    job_arrival_times=None,
    cfg=None,
):
    AXIS_FONT_SIZE = 18
    BAR_TEXT_FONT_SIZE = 18
    BATCH_FONT_SIZE = 18

    machines = (
        list(cfg.machine_production_rates) if cfg else ["Flexo A", "Flexo B", "Flexo C"]
    )
    batches = sorted(set(job_arrival_times.values())) if job_arrival_times else [0, 4]

    cmap = cm.get_cmap("viridis")

    batch_colors = [
        mcolors.to_hex(cmap(0.2)),
        mcolors.to_hex(cmap(0.4)),
        mcolors.to_hex(cmap(0.6)),
        mcolors.to_hex(cmap(0.8)),
    ]

    bmap = {b: batch_colors[i % len(batch_colors)] for i, b in enumerate(batches)}

    def iter_jobs_for(machine):
        if hasattr(timeline_data, "iterrows"):
            return (
                timeline_data[timeline_data["machine"] == machine]
                .sort_values("start_hours")
                .to_dict("records")
            )
        return sorted(
            (j for j in timeline_data if j["machine"] == machine),
            key=lambda x: x["start_hours"],
        )

    fig, ax = plt.subplots(figsize=(14, 6))

    plt.rcParams["hatch.linewidth"] = 8.0

    plt.rcParams["font.family"] = "Calibri"

    max_end = (
        timeline_data["end_hours"].max()
        if hasattr(timeline_data, "empty") and not timeline_data.empty
        else max(j["end_hours"] for j in timeline_data)
    )

    machine_positions = {m: i for i, m in enumerate(reversed(machines))}
    bar_height = 0.8

    for m in machines:
        y_pos = machine_positions[m]
        for job in iter_jobs_for(m):
            oc, s, e, dur = (
                job["order_code"],
                job["start_hours"],
                job["end_hours"],
                job["duration"],
            )
            inks_disp = job["inks_display"]
            jb = job_arrival_times.get(oc, 0) if job_arrival_times else 0
            bc = bmap.get(jb, "#808080")

            penalty_parts = []
            if job["num_changes"] > 0:
                penalty_parts.append(f"I:{int(job['num_changes'])}")
            penalty_info = " ".join(penalty_parts)

            has_penalty = job["num_changes"] > 0
            hatch_pattern = "/" if has_penalty else None

            bc = job.get("color", bc)
            rgb = mcolors.to_rgb(bc)
            darkened = tuple(c * 0.8 for c in rgb)

            ax.barh(
                y_pos,
                dur,
                left=s,
                height=bar_height,
                color=bc,
                alpha=0.9,
                edgecolor=darkened,
                linewidth=1,
                hatch=hatch_pattern,
            )

            text_x = s + dur / 2
            inks_formatted = ",".join(map(str, job["inks"]))
            job_text = f"{oc}\n{inks_formatted}"
            if penalty_info:
                job_text += f"\n{penalty_info}"
            ax.text(
                text_x,
                y_pos,
                job_text,
                ha="center",
                va="center",
                fontsize=BAR_TEXT_FONT_SIZE,
                color="white",
                weight="bold",
            )

    for b in batches:
        ax.axvline(
            x=b,
            color=bmap[b],
            linestyle="--",
            linewidth=2,
            alpha=0.5,
        )
        ax.text(
            b + 0.03,
            -0.61,
            f"{b}h",
            rotation=0,
            va="bottom",
            ha="left",
            color=bmap[b],
            fontsize=BATCH_FONT_SIZE,
            weight="bold",
            bbox=dict(
                boxstyle="square,pad=0.2",
                facecolor="white",
                alpha=1.0,
                edgecolor=bmap[b],
                linewidth=1,
            ),
        )

    # Shift boundary lines (end-of-day cleaning)
    shift_t = PRODUCTION_HOURS_PER_DAY
    while shift_t < max_end:
        ax.axvline(x=shift_t, color="#CC0000", linestyle=":", linewidth=1.5, alpha=0.4)
        shift_t += PRODUCTION_HOURS_PER_DAY

    ax.set_xlim(0, max_end)
    ax.set_ylim(-0.65, len(machines) - 0.4)
    ax.set_xlabel("Jam", fontsize=AXIS_FONT_SIZE)

    ax.set_yticks(range(len(machines)))
    ax.set_yticklabels(reversed(machines), rotation=90, va="center")
    ax.tick_params(axis="both", which="major", labelsize=AXIS_FONT_SIZE)

    ax.grid(
        True,
        axis="x",
        alpha=0.2,
        linestyle="-",
        linewidth=1,
        color="gray",
    )
    ax.set_axisbelow(True)

    ax.spines["top"].set_visible(True)
    ax.spines["right"].set_visible(True)
    ax.spines["bottom"].set_visible(True)
    ax.spines["left"].set_visible(True)

    plt.tight_layout()

    return fig


def create_timeline_tables(timeline_data, job_arrival_times=None, cfg=None):
    machines = list(cfg.machine_production_rates)
    jobs = (
        timeline_data.to_dict("records")
        if hasattr(timeline_data, "iterrows")
        else timeline_data
    )

    def get_status_text(job):
        status = []
        if job["num_changes"] > 0:
            num_changes = int(job["num_changes"])
            status.append(f"{num_changes} Tinta")
        return " | ".join(status) if status else "Tidak ada"

    rows = []
    for m in machines:
        machine_jobs = sorted(
            (x for x in jobs if x["machine"] == m),
            key=lambda x: x["start_hours"],
        )
        for seq, j in enumerate(machine_jobs, 1):
            batch = (
                job_arrival_times.get(j["order_code"], 0) if job_arrival_times else 0
            )

            row = {
                "Mesin": m,
                "Urutan": seq,
                "Kode Order": j["order_code"],
                "Batch": f"{batch}h",
                "Level Tinta": j["inks_display"],
                "Mulai": f"{j['start_hours']:.2f}",
                "Selesai": f"{j['end_hours']:.2f}",
                "Penalti": get_status_text(j),
            }
            rows.append(row)

    return pd.DataFrame(sorted(rows, key=lambda x: (x["Mesin"], x["Urutan"])))


def show_statistics_params(results_df, metrics=None):
    metrics = metrics or [
        "Fitness",
        "Batch Flow Time (h)",
        "Ink Changes",
        "Runtime (s)",
    ]
    metrics = [m for m in metrics if m in results_df.columns]
    if not metrics:
        return print("No matching metrics found.")

    desc = (
        results_df[metrics]
        .describe(percentiles=[0.25, 0.5, 0.75])
        .T[
            [
                "count",
                "mean",
                "std",
                "min",
                "25%",
                "50%",
                "75%",
                "max",
            ]
        ]
    )

    display(
        HTML(
            desc.to_html(
                classes="table table-striped",
                float_format="{:,.4f}".format,
            )
        )
    )
    return desc


def create_core_metrics_table(final_fitness, ink, batch_flow_time, runtime, cfg):
    data = [
        ["Fitness", f"{final_fitness:.3f}"],
        ["Penalti Tinta", f"{ink}"],
        ["Batch Flow Time (h)", f"{batch_flow_time:.2f}"],
        ["Runtime (s)", f"{runtime:.2f}"],
    ]
    return pd.DataFrame(data, columns=["Metrik", "Nilai"])


@dataclass(frozen=True)
class ExperimentConfig:
    """Unified config for both the GRASP-SA optimizer and the Moser SA-R
    ablation backend.  Set ``ablation=True`` to use SA-R; otherwise the
    GRASP-SA hybrid runs.

    Usage:
        # Standard GRASP-SA run
        ExperimentConfig(seed=42, T_max=1000.0, T_min=1.0, N_s=50, ...)

        # Ablation (Moser SA-R) run
        ExperimentConfig(ablation=True, seed=42, T_max=5000.0, ...)
    """

    # ── Common fields ────────────────────────────────────────────────────────
    machine_production_rates: dict[str, float] = field(default_factory=dict)
    sequence_dependent_setup_time: float = 0.75
    ink_weight: float = 1.0
    batch_flow_time_weight: float = 1.0
    seed: int = 42
    iterations: int = 250000
    orders_data: list[dict] = field(default_factory=list)
    job_batches: list[dict] = field(default_factory=list)
    show_summary: bool = True
    show_timeline_chart: bool = True
    show_timeline_table: bool = True
    scenario_name: str = "scenario"

    # ── Mode switch ──────────────────────────────────────────────────────────
    ablation: bool = False

    # ── Shared SA temperature params ─────────────────────────────────────────
    T_max: float = 2764.93  # initial temperature
    T_min: float = 6.73  # minimum temperature
    N_s: int = 20  # SA iterations per temperature step

    # ── GRASP-SA params (used when ablation=False) ────────────────────────────
    rcl_alpha: float = 0.0  # GRASP greediness: 0 = fully greedy, 1 = fully random
    num_starts: int = 1
    move_probs: tuple[float, ...] = (0.66, 0.84, 0.04)  # [p_I, p_S, p_B]
    use_metropolis: bool = True  # if False, only accept improving moves (hill-climbing)

    # ── SA-R / Moser params (used when ablation=True) ────────────────────────
    p_I: float = 0.66  # inter-machine move probability
    p_S: float = 0.84  # shift (vs swap) probability
    p_B: float = 0.04  # block (vs single-job) move probability
    p_M: float = 0.71  # guidance: pick from critical-machine set
    B_max: int = 26  # maximum block size
    alpha: float = 0.93  # geometric cooling rate (ablation only)

    # ── Internal helpers ─────────────────────────────────────────────────────
    @property
    def _backend(self):
        return cpp_ablation if self.ablation else cpp_optimizer

    @property
    def _params(self) -> list[float]:
        if self.ablation:
            return [
                self.p_I,
                self.p_S,
                self.p_B,
                self.p_M,
                float(self.B_max),
                self.T_max,
                self.T_min,
                float(self.N_s),
                self.alpha,
            ]
        return list(self.move_probs)

    @property
    def _num_starts(self) -> int:
        return 1 if self.ablation else self.num_starts


def _convert_cpp_schedule(cpp_schedule, cfg):
    class JobObj:
        def __init__(self, d):
            self.order_code = d["order_code"]
            self.inks = tuple(d["inks"])
            self.production_quantity = d["production_quantity"]
            self.arrival_time = d["arrival_time"]

    return {m: [JobObj(j) for j in jobs] for m, jobs in cpp_schedule.items()}


def run_experiment(cfg: ExperimentConfig):
    if cfg.ablation:
        result = cpp_ablation.run_experiment(
            cfg.job_batches,
            cfg.orders_data,
            cfg.machine_production_rates,
            cfg.sequence_dependent_setup_time,
            cfg.ink_weight,
            cfg.batch_flow_time_weight,
            cfg.seed,
            cfg.iterations,
            0.0,  # acceptance_prob (unused)
            1,  # num_starts
            0,  # num_threads
            cfg._params,
        )
    else:
        result = cpp_optimizer.run_experiment(
            cfg.job_batches,
            cfg.orders_data,
            cfg.machine_production_rates,
            cfg.sequence_dependent_setup_time,
            cfg.ink_weight,
            cfg.batch_flow_time_weight,
            cfg.seed,
            cfg.iterations,
            cfg.T_max,
            cfg.T_min,
            cfg.N_s,
            cfg.rcl_alpha,
            cfg.num_starts,
            0,
            cfg._params,
            cfg.use_metropolis,
        )

    runtime = result["runtime"]
    final_fitness = result["fitness"]
    ink = result["ink_changes"]
    batch_flow_time = result["batch_flow_time"]
    makespan = result["makespan"]
    batch_objectives = result.get("batch_objectives", [])
    schedule = _convert_cpp_schedule(result["schedule"], cfg)

    completion_data = [
        ["Runtime", f"{runtime:.2f}s"],
        ["Fitness", f"{final_fitness:.3f}"],
        ["Ink Changes", f"{int(ink)}"],
        ["Batch Flow Time (h)", f"{batch_flow_time:.2f}"],
    ]

    completion_df = pd.DataFrame(completion_data, columns=["Metric", "Value"])
    display(HTML(completion_df.to_html(index=False, classes="table table-striped")))

    timeline_data, color_map, job_arrivals = build_timeline_data(
        schedule, cfg.job_batches, cfg
    )

    if cfg.show_summary:
        print_production_summary(
            timeline_data,
            schedule,
            final_fitness,
            batch_flow_time,
            cfg,
        )

    timeline_chart = create_timeline_chart(timeline_data, job_arrivals, cfg)
    if cfg.show_timeline_chart:
        plots_dir = "plots"
        os.makedirs(plots_dir, exist_ok=True)

        png_filename = f"{cfg.scenario_name}_timeline_chart.png"
        png_filepath = os.path.join(plots_dir, png_filename)
        timeline_chart.savefig(png_filepath, dpi=300, bbox_inches="tight")

        svg_filename = f"{cfg.scenario_name}_timeline_chart.svg"
        svg_filepath = os.path.join(plots_dir, svg_filename)
        timeline_chart.savefig(svg_filepath, bbox_inches="tight")

        print(f"Timeline chart saved to: {png_filepath} and {svg_filepath}")

    timeline_table = create_timeline_tables(timeline_data, job_arrivals, cfg)
    if cfg.show_timeline_table:
        display(HTML(timeline_table.to_html(index=False, escape=False)))

    results_df = pd.DataFrame(
        [
            {
                "Run": 1,
                "Seed": cfg.seed,
                "Fitness": final_fitness,
                "Batch Flow Time (h)": batch_flow_time,
                "Ink Changes": ink,
                "Runtime (s)": runtime,
                "Makespan (h)": makespan,
            }
        ]
    )

    return {
        "final_schedule": schedule,
        "final_fitness": final_fitness,
        "final_batch_flow_time": batch_flow_time,
        "final_ink_changes": ink,
        "final_makespan": makespan,
        "total_runtime": runtime,
        "timeline_data": timeline_data,
        "color_mapping": color_map,
        "timeline_chart": timeline_chart,
        "timeline_table": timeline_table,
        "results_df": results_df,
        "batch_objectives": batch_objectives,
    }


def run_experiments_multiple_seeds(
    cfg: ExperimentConfig,
    seeds,
    show_unique_timelines=False,
    num_threads=0,
    verbose=False,
    sequential=False,
):
    import os

    if num_threads == 0:
        num_threads = os.cpu_count() or 1

    if verbose:
        mode = "sequential" if sequential else f"parallel ({num_threads} threads)"
        print(f"Running {len(seeds)} experiments with C++ {mode}...")

    if cfg.ablation:
        results = cpp_ablation.run_multiple_experiments(
            cfg.job_batches,
            cfg.orders_data,
            cfg.machine_production_rates,
            cfg.sequence_dependent_setup_time,
            cfg.ink_weight,
            cfg.batch_flow_time_weight,
            list(seeds),
            cfg.iterations,
            0.0,  # acceptance_prob (unused)
            num_threads,
            1,  # num_starts
            cfg._params,
            sequential,
        )
    else:
        results = cpp_optimizer.run_multiple_experiments(
            cfg.job_batches,
            cfg.orders_data,
            cfg.machine_production_rates,
            cfg.sequence_dependent_setup_time,
            cfg.ink_weight,
            cfg.batch_flow_time_weight,
            list(seeds),
            cfg.iterations,
            cfg.T_max,
            cfg.T_min,
            cfg.N_s,
            num_threads,
            cfg._num_starts,
            cfg._params,
            sequential,
            cfg.rcl_alpha,
            cfg.use_metropolis,
        )

    runs = []
    unique_schedules = {}

    for i, r in enumerate(results, 1):
        seed = r["seed"]
        fitness = r["fitness"]
        bft = r["batch_flow_time"]
        ink = r["ink_changes"]
        runtime = r["runtime"]
        makespan = r["makespan"]
        batch_objectives = r.get("batch_objectives", [])
        batch_objectives_json = json.dumps(batch_objectives, separators=(",", ":"))
        schedule_json = json.dumps(
            {m: [j["order_code"] for j in jobs] for m, jobs in r["schedule"].items()},
            separators=(",", ":"),
        )

        runs.append(
            {
                "Run": i,
                "Seed": seed,
                "Fitness": fitness,
                "Batch Flow Time (h)": bft,
                "Ink Changes": ink,
                "Runtime (s)": runtime,
                "Makespan (h)": makespan,
                "Schedule JSON": schedule_json,
                "Per Batch Objectives JSON": batch_objectives_json,
                "Status": "ok",
            }
        )

        if show_unique_timelines:
            schedule = _convert_cpp_schedule(r["schedule"], cfg)
            timeline_data, color_map, job_arrivals = build_timeline_data(
                schedule, cfg.job_batches, cfg
            )
            fitness_key = round(fitness, 6)
            if fitness_key not in unique_schedules:
                unique_schedules[fitness_key] = (
                    {
                        "final_fitness": fitness,
                        "timeline_data": timeline_data,
                        "job_arrivals": job_arrivals,
                        "cfg": cfg,
                    },
                    [],
                )
            unique_schedules[fitness_key][1].append(f"Run {i} (Seed {seed})")

    if verbose:
        print("\n" + "=" * 60)
        print("ALL EXPERIMENTS COMPLETED - DISPLAYING RESULTS")
        print("=" * 60)

    results_df = pd.DataFrame(runs)
    if verbose:
        fitness_summary = (
            results_df.groupby("Fitness")
            .agg(
                Count=("Seed", "count"),
                **{"Batch Flow Time (h)": ("Batch Flow Time (h)", "first")},
                **{"Ink Changes": ("Ink Changes", "first")},
                Seeds=("Seed", "first"),
            )
            .reset_index()
            .sort_values("Fitness")
        )
        display(
            HTML(
                fitness_summary.to_html(
                    index=False,
                    classes="table table-striped",
                    float_format="{:.6f}".format,
                )
            )
        )

    if verbose:
        stats = show_statistics_params(results_df)
    else:
        stats = (
            results_df[
                [
                    "Fitness",
                    "Batch Flow Time (h)",
                    "Ink Changes",
                    "Runtime (s)",
                    "Makespan (h)",
                ]
            ].describe()
            if all(
                col in results_df.columns
                for col in [
                    "Fitness",
                    "Batch Flow Time (h)",
                    "Ink Changes",
                    "Runtime (s)",
                    "Makespan (h)",
                ]
            )
            else None
        )

    if show_unique_timelines:
        if verbose:
            print(f"\n=== UNIQUE SCHEDULES ({len(unique_schedules)} found) ===")
        for fitness, (result, runs_list) in sorted(unique_schedules.items()):
            if verbose:
                print(
                    f"\nFitness: {fitness:.6f} | Count: {len(runs_list)} | Found in: {', '.join(runs_list)}"
                )

            timeline_chart = create_timeline_chart(
                result["timeline_data"],
                result["job_arrivals"],
                result["cfg"],
            )
            plt.show()

    return results_df, stats
