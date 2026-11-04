"use client";
import type { CSSProperties } from "react";

import type { Result, Snapshot } from "@/lib/model";
import { useEffect, useState } from "react";
import { Button } from "./ui/button";
import { Slider } from "./ui/slider";
export function Timeline({
  result,
  snapshot,
  colorNames = (ids: number[]) => ids.join(", "),
  preferences,
  onPreferences,
}: {
  result: Result | undefined;
  snapshot: Snapshot;
  colorNames?: (ids: number[]) => string;
  preferences?: { mode: string; shift: number; scale: number };
  onPreferences: (v: { mode: string; shift: number; scale: number }) => void;
}) {
  const [view, setView] = useState(preferences?.mode ?? "full"),
    [shift, setShift] = useState(preferences?.shift ?? 0),
    [scale, setScale] = useState(preferences?.scale ?? 80);
  useEffect(() => {
    onPreferences({ mode: view, shift, scale });
  }, [view, shift, scale]);
  const now = result?.now ?? snapshot.now;
  const schedule =
    result?.schedule ??
    Object.fromEntries(
      Object.keys(snapshot.machines).map((machine) => [machine, []]),
    );
  const end = Math.max(result?.makespan ?? 0, now, 1);
  const maxShift = Math.max(0, Math.ceil(end / 8) - 1);
  const start = view === "shift" ? Math.min(shift, maxShift) * 8 : 0;
  const span = view === "shift" ? 8 : end;
  const arrivals = [
    ...new Set(
      Object.values(schedule)
        .flat()
        .map((j) => j.arrival_time),
    ),
  ].sort((a, b) => a - b);
  const colors = [
    "var(--chart-1)",
    "var(--chart-2)",
    "var(--chart-3)",
    "var(--chart-4)",
    "var(--chart-5)",
  ];
  return (
    <section className="mt-6 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2>Schedule</h2>
        <div className="flex flex-wrap items-center gap-2">
          {["full", "scroll", "shift"].map((v) => (
            <Button
              variant="toggle"
              aria-pressed={view === v}
              key={v}
              onClick={() => setView(v)}
            >
              {v[0].toUpperCase() + v.slice(1)}
            </Button>
          ))}
          {view === "scroll" && (
            <Slider
              aria-label="Timeline Zoom"
              min={20}
              max={240}
              value={scale}
              onValueChange={(value) => setScale(Number(value))}
            />
          )}{" "}
          {view === "shift" && (
            <>
              <Button
                variant="outline"
                disabled={shift === 0}
                onClick={() => setShift(Math.max(0, shift - 1))}
              >
                Prev
              </Button>
              <span className="inline-flex h-9 items-center px-3 text-sm font-medium">
                Shift {Math.min(shift, maxShift) + 1}
              </span>
              <Button
                variant="outline"
                disabled={shift >= maxShift}
                onClick={() => setShift(shift + 1)}
              >
                Next
              </Button>
            </>
          )}
        </div>
      </div>
      <div className="timeline-scroll">
        <div
          className="timeline-content"
          style={
            {
              "--timeline-width":
                view === "scroll" ? `${end * scale + 120}px` : "0px",
            } as CSSProperties
          }
        >
          <div className="lane axis">
            <strong>Machine</strong>
            <div>
              {Array.from({ length: 9 }, (_, i) => (
                <span
                  key={i}
                  style={{ "--position": `${(i / 8) * 100}%` } as CSSProperties}
                >
                  {(start + (span * i) / 8).toFixed(1)}h
                </span>
              ))}
            </div>
          </div>
          {Object.entries(schedule).map(([machine, jobs]) => (
            <div className="lane" key={machine}>
              <strong>{machine}</strong>
              <div className="track">
                {Array.from(
                  { length: Math.ceil((start + span) / 8) + 1 },
                  (_, i) => i * 8,
                )
                  .filter((t) => t >= start && t <= start + span)
                  .map((t) => (
                    <i
                      key={t}
                      className="shift-line"
                      style={
                        {
                          "--position": `${((t - start) / span) * 100}%`,
                        } as CSSProperties
                      }
                    />
                  ))}
                {now >= start && now <= start + span && (
                  <i
                    className="now-line"
                    style={
                      {
                        "--position": `${((now - start) / span) * 100}%`,
                      } as CSSProperties
                    }
                  />
                )}
                {jobs
                  .filter(
                    (j) =>
                      j.completion! > start && j.setup_start! < start + span,
                  )
                  .map((j) => {
                    const left = Math.max(start, j.setup_start!);
                    const right = Math.min(start + span, j.completion!);
                    const duration = j.completion! - j.setup_start!;
                    return (
                      <button
                        key={j.id}
                        className={`job-bar ${j.locked ? "locked" : ""}`}
                        style={
                          {
                            "--position": `${((left - start) / span) * 100}%`,
                            "--job-width": `${((right - left) / span) * 100}%`,
                            "--batch-color":
                              colors[
                                arrivals.indexOf(j.arrival_time) % colors.length
                              ],
                          } as CSSProperties
                        }
                        title={`${j.id} | ${j.quantity} pieces | inks ${colorNames(j.inks)} | setup ${j.setup_start?.toFixed(3)} · ${j.start?.toFixed(3)} | complete ${j.completion?.toFixed(3)}h${j.locked ? " | locked" : ""}`}
                      >
                        <span
                          className="setup"
                          style={
                            {
                              "--setup-width": `${((j.start! - j.setup_start!) / duration) * 100}%`,
                            } as CSSProperties
                          }
                        />
                        {j.id}
                      </button>
                    );
                  })}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-4 text-sm text-muted-foreground">
        <span>Hatched: Setup</span>
        <span>Outlined: Locked Work</span>
        <span>White Line: Current Time</span>
        {arrivals.map((a, i) => (
          <span
            key={a}
            className="batch-label"
            style={
              { "--batch-color": colors[i % colors.length] } as CSSProperties
            }
          >
            Batch {a}h
          </span>
        ))}
      </div>
    </section>
  );
}
