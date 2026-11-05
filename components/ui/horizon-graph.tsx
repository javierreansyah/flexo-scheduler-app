"use client";
import type { CSSProperties } from "react";
import type { Project } from "@/lib/model";
import { Button } from "./button";
export function HorizonGraph({
  project,
  labels,
  disabled,
  onSelect,
}: {
  project: Project;
  labels: Map<string, string>;
  disabled: boolean;
  onSelect: (id: string) => void;
}) {
  const nodes = project.horizons!.nodes;
  const times = [...new Set(nodes.map((n) => n.state.snapshot.now))].sort(
    (a, b) => a - b,
  );
  const positions = new Map(
    nodes.map((n) => [
      n.id,
      {
        x: times.indexOf(n.state.snapshot.now) * 240,
        y:
          nodes
            .filter((x) => x.state.snapshot.now === n.state.snapshot.now)
            .findIndex((x) => x.id === n.id) *
            64 +
          64,
      },
    ]),
  );
  const height =
    Math.max(
      ...times.map(
        (t) => nodes.filter((n) => n.state.snapshot.now === t).length,
      ),
    ) *
      64 +
    96;
  const ancestors = new Set<string>();
  let current = nodes.find((n) => n.id === project.horizons!.active);
  while (current) {
    ancestors.add(current.id);
    current = nodes.find((n) => n.id === current!.parent);
  }
  return (
    <div
      className="horizon-scroll"
      role="region"
      aria-label="Horizon graph"
      tabIndex={0}
    >
      <div
        className="horizon-graph"
        style={
          {
            "--graph-width": (times.length - 1) * 240 + 208 + "px",
            "--graph-height": height + "px",
          } as CSSProperties
        }
      >
        <svg
          width={(times.length - 1) * 240 + 208}
          height={height}
          aria-hidden="true"
        >
          {[...nodes]
            .sort(
              (a, b) =>
                Number(ancestors.has(a.id)) - Number(ancestors.has(b.id)),
            )
            .map((n) => {
              const a = positions.get(n.parent ?? ""),
                b = positions.get(n.id)!;
              return a ? (
                <path
                  key={n.id}
                  className={
                    ancestors.has(n.id) ? "horizon-path-active" : "horizon-path"
                  }
                  d={
                    a.x === b.x
                      ? b.y - a.y === 64
                        ? `M ${a.x + 88} ${a.y + 36} V ${b.y}`
                        : a.x === 0
                          ? `M ${a.x + 176} ${a.y + 18} H ${a.x + 208} V ${b.y + 18} H ${b.x + 176}`
                          : `M ${a.x} ${a.y + 18} H ${a.x - 32} V ${b.y + 18} H ${b.x}`
                      : b.x - a.x === 240
                        ? `M ${a.x + 176} ${a.y + 18} H ${a.x + 208} V ${b.y + 18} H ${b.x}`
                        : `M ${a.x + 176} ${a.y + 18} H ${a.x + 208} V 48 H ${b.x - 32} V ${b.y + 18} H ${b.x}`
                  }
                />
              ) : null;
            })}
        </svg>
        {times.map((time, i) => (
          <p
            key={time}
            className="horizon-column-label"
            style={{ "--node-x": i * 240 + "px" } as CSSProperties}
          >
            Horizon {time}h
          </p>
        ))}
        {nodes.map((n) => {
          const pos = positions.get(n.id)!;
          return (
            <div
              key={n.id}
              className="horizon-node"
              style={
                {
                  "--node-x": pos.x + "px",
                  "--node-y": pos.y + "px",
                } as CSSProperties
              }
            >
              <Button
                variant={
                  n.id === project.horizons!.active ? "default" : "outline"
                }
                disabled={disabled}
                aria-pressed={n.id === project.horizons!.active}
                aria-label={labels.get(n.id)}
                onClick={() => onSelect(n.id)}
              >
                {n.result === undefined
                  ? "Draft"
                  : labels.get(n.id)?.split(" · ").at(-1)}
                {n.unavailable ? " · view only" : ""}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
