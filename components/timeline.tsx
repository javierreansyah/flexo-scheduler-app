"use client";
import { Fragment, type CSSProperties } from "react";
import { timelineSegment } from "@/lib/timeline-segment";

import type { Result, Snapshot } from "@/lib/model";
import { Button } from "./ui/button";
import { Slider } from "./ui/slider";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";
type TimelinePreferences = { mode: string; shift: number; scale: number };

export function TimelineControls({
  preferences,
  onPreferences,
  end,
}: {
  preferences: TimelinePreferences;
  onPreferences: (value: TimelinePreferences) => void;
  end: number;
}) {
  const { mode: view, shift, scale } = preferences;
  const maxShift = Math.max(0, Math.ceil(end / 8) - 1);
  const setView = (mode: string) => onPreferences({ ...preferences, mode });
  const setShift = (shift: number) => onPreferences({ ...preferences, shift });
  const setScale = (scale: number) => onPreferences({ ...preferences, scale });
  return (
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
  );
}

export function Timeline({
  result,
  snapshot,
  colorNames = (ids: number[]) => ids.join(", "),
  preferences,
}: {
  result: Result | undefined;
  snapshot: Snapshot;
  colorNames?: (ids: number[]) => string;
  preferences: TimelinePreferences;
}) {
  const { mode: view, shift, scale } = preferences;
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
    <TooltipProvider>
      <section className="min-w-0" aria-label="Schedule timeline">
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
                    style={
                      { "--position": `${(i / 8) * 100}%` } as CSSProperties
                    }
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
                      const setup = timelineSegment(
                        j.setup_start!,
                        j.start!,
                        start,
                        span,
                      );
                      const production = timelineSegment(
                        j.start!,
                        j.completion!,
                        start,
                        span,
                      );
                      const batchColor =
                        colors[
                          arrivals.indexOf(j.arrival_time) % colors.length
                        ];
                      const title = `${j.id} | ${j.quantity} pieces | inks ${colorNames(j.inks)} | setup ${j.setup_start?.toFixed(3)} · ${j.start?.toFixed(3)} | complete ${j.completion?.toFixed(3)}h${j.locked ? " | locked" : ""}`;
                      const jobButton = (
                        <button
                          className={`job-bar ${j.locked ? "locked" : ""}`}
                        />
                      );
                      return (
                        <Fragment key={j.id}>
                          {setup && (
                            <span
                              className={`setup-bar ${j.locked ? "locked" : ""}`}
                              role="img"
                              aria-label={`Setup for ${j.id}, ${j.setup_start?.toFixed(3)} to ${j.start?.toFixed(3)} hours`}
                              title={`Setup for ${j.id} | ${j.setup_start?.toFixed(3)}–${j.start?.toFixed(3)}h`}
                              style={
                                {
                                  "--position": `${setup.left}%`,
                                  "--job-width": `${setup.width}%`,
                                  "--batch-color": batchColor,
                                } as CSSProperties
                              }
                            />
                          )}
                          {production && (
                            <Tooltip>
                              <TooltipTrigger
                                render={jobButton}
                                style={
                                  {
                                    "--position": `${production.left}%`,
                                    "--job-width": `${production.width}%`,
                                    "--batch-color": batchColor,
                                  } as CSSProperties
                                }
                              >
                                {j.id}
                              </TooltipTrigger>
                              <TooltipContent>{title}</TooltipContent>
                            </Tooltip>
                          )}
                        </Fragment>
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
    </TooltipProvider>
  );
}
