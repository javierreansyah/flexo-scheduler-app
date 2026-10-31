"""Run snapshots or validation instances and inspect the resulting timelines."""
import argparse
import csv
import json
from pathlib import Path
import statistics
import time

from flexo import optimize
from flexo.instances import write_json
from flexo.validation import run_validation


def timeline(result, title="Schedule", now=None):
    """Original batch-colored timeline, using actual optimizer timestamps."""
    import matplotlib.pyplot as plt
    from matplotlib.patches import Patch
    from matplotlib.lines import Line2D

    schedule = result["schedule"]
    arrivals = sorted({j["arrival_time"] for jobs in schedule.values() for j in jobs})
    cmap = plt.get_cmap("viridis")
    colors = {arrival: cmap(.2 + .6*(i % 4)/3) for i, arrival in enumerate(arrivals)}
    machines = list(schedule)
    end = max((j["completion"] for jobs in schedule.values() for j in jobs), default=1.)
    end = max(end, now or 0, 1.)
    # Local style avoids changing notebook-wide Matplotlib settings.
    with plt.rc_context({"hatch.linewidth": 1.5, "font.family": "DejaVu Sans"}):
        fig, ax = plt.subplots(figsize=(16, max(5, len(machines)*1.2)))
        for row, machine in enumerate(machines):
            y = len(machines)-1-row
            for job in schedule[machine]:
                color = colors[job["arrival_time"]]
                setup = job["start"]-job["setup_start"]
                if setup > 0:
                    ax.barh(y, setup, left=job["setup_start"], height=.75,
                            color="#d6d6d6", edgecolor="#777777", hatch="..", linewidth=.6)
                ax.barh(y, job["completion"]-job["start"], left=job["start"], height=.75,
                        color=color, edgecolor="black" if job["locked"] else tuple(c*.75 for c in color[:3]),
                        linewidth=1.8 if job["locked"] else .6,
                        hatch="/" if job["ink_change_cost"] > 0 else None)
                text = f"{job['id']}\n{','.join(map(str, job['inks']))}"
                if job["ink_change_cost"] > 0:
                    text += f"\nI:{job['ink_change_cost']:g}"
                # Short bars retain their rectangles but omit unreadable labels.
                if (job["completion"]-job["start"])/end >= .018:
                    ax.text((job["start"]+job["completion"])/2, y, text,
                            ha="center", va="center", color="white", weight="bold", fontsize=8, clip_on=True)
        for arrival in arrivals:
            ax.axvline(arrival, color=colors[arrival], linestyle="--", alpha=.55, linewidth=1)
        for boundary in range(8, int(end)+1, 8):
            ax.axvline(boundary, color="#cc0000", linestyle=":", alpha=.5)
        if now is not None and now > 0:
            ax.axvline(now, color="#202020", linestyle="-.", linewidth=1.5)
        legend = [Patch(facecolor=colors[a], label=f"Arrival {a:g} h") for a in arrivals]
        legend += [Patch(facecolor="#d6d6d6", hatch="..", label="Setup"),
                   Patch(facecolor="white", edgecolor="black", linewidth=1.8, label="Locked"),
                   Line2D([], [], color="#cc0000", linestyle=":", label="Shift boundary")]
        if now is not None and now > 0:
            legend.append(Line2D([], [], color="#202020", linestyle="-.", label=f"Decision {now:g} h"))
        ax.set(yticks=list(range(len(machines))), yticklabels=list(reversed(machines)),
               xlabel="Production hours", xlim=(0, end*1.015), ylim=(-.6, max(.6, len(machines)-.4)),
               title=f"{title}\nFitness {result['fitness']:.4f} | Ink cost {result['ink_changes']:g} | "
                     f"Batch flow {result['batch_flow_time']:.3f} h | Makespan {result['makespan']:.3f} h")
        ax.grid(axis="x", alpha=.15)
        ax.set_axisbelow(True)
        ax.legend(handles=legend, loc="upper center", bbox_to_anchor=(.5, -.16), ncol=min(6, len(legend)), fontsize=9)
        fig.tight_layout()
    return fig


def run(instance="flexo/example.json", seeds=(42,), parameters=None, profiles=None,
        threads=0, output_dir=None, preset="medium"):
    """Return metrics and the best result; chart creation is outside timing."""
    path = Path(instance)
    data = json.loads(path.read_text(encoding="utf-8"))
    validation = "job_batches" in data
    solver = run_validation if validation else optimize
    rows, best = [], None
    if not seeds:
        raise ValueError("Provide at least one seed")
    for seed in seeds:
        begin = time.perf_counter()
        result = solver(data, parameters, seed=seed, num_threads=threads, profiles=profiles, preset=preset)
        elapsed = time.perf_counter()-begin
        row = dict(seed=seed, threads=threads, fitness=result["fitness"], ink_cost=result["ink_changes"],
                   batch_flow_hours=result["batch_flow_time"], makespan_hours=result["makespan"],
                   wall_seconds=elapsed, optimizer_seconds=result["total_runtime"],
                   horizons=len(result.get("horizons", [])) if validation else 1)
        rows.append(row)
        print(f"seed={seed}  fitness={row['fitness']:.5f}  ink={row['ink_cost']:g}  "
              f"flow={row['batch_flow_hours']:.3f}h  makespan={row['makespan_hours']:.3f}h  "
              f"wall={elapsed*1000:.2f}ms  horizons={row['horizons']}", flush=True)
        if best is None or result["fitness"] < best["fitness"]:
            best = result
    print(f"Mean fitness: {statistics.mean(r['fitness'] for r in rows):.5f} | "
          f"Median wall: {statistics.median(r['wall_seconds'] for r in rows)*1000:.2f} ms | "
          f"Best seed: {best['seed']}")
    if output_dir is not None:
        directory = Path(output_dir)
        directory.mkdir(parents=True, exist_ok=True)
        with (directory/"metrics.csv").open("w", newline="", encoding="utf-8") as stream:
            writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
            writer.writeheader(); writer.writerows(rows)
        write_json(directory/"best.json", dict(instance=str(path.resolve()), num_threads=threads, result=best))
        with (directory/"schedule.csv").open("w", newline="", encoding="utf-8") as stream:
            fields = ["machine", "id", "arrival_time", "quantity", "inks", "setup_start", "start", "completion", "ink_change_cost", "locked"]
            writer = csv.DictWriter(stream, fieldnames=fields)
            writer.writeheader()
            for machine, jobs in best["schedule"].items():
                for job in jobs:
                    writer.writerow(dict(machine=machine, **job))
    return rows, best


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("instance", nargs="?", default="flexo/example.json")
    parser.add_argument("--seeds", type=int, nargs="+", default=[42])
    parser.add_argument("--evaluations", type=int, help="Override proposal budget per horizon")
    parser.add_argument("--starts", type=int)
    parser.add_argument("--threads", type=int, default=0)
    parser.add_argument("--profiles", type=Path)
    parser.add_argument("--preset", choices=["low", "medium", "high"], default="medium")
    parser.add_argument("--parameters", type=Path)
    parser.add_argument("--output", type=Path, default=Path("results/playground"))
    parser.add_argument("--show", action="store_true", help="Open a Matplotlib window")
    args = parser.parse_args()
    params = json.loads(args.parameters.read_text()) if args.parameters else None
    if args.evaluations is not None or args.starts is not None:
        if args.profiles:
            parser.error("Use --profiles or explicit budget/parameters overrides, not both")
        params = params or {}
        if args.evaluations is not None: params["evaluations"] = args.evaluations
        if args.starts is not None: params["starts"] = args.starts
    if params is not None and args.profiles:
        parser.error("Use --parameters or --profiles, not both")
    _, best = run(args.instance, args.seeds, params, args.profiles, args.threads, args.output, args.preset)
    import matplotlib
    if not args.show:
        matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    data = json.loads(Path(args.instance).read_text())
    figure = timeline(best, Path(args.instance).stem, data.get("now"))
    figure.savefig(args.output/"timeline.png", dpi=180, bbox_inches="tight")
    figure.savefig(args.output/"timeline.svg", bbox_inches="tight")
    print(f"Saved timeline, metrics, and best schedule to {args.output.resolve()}")
    if args.show: plt.show()
    plt.close(figure)


if __name__ == "__main__":
    main()
