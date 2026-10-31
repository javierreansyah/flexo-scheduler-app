"use client";
import { useState, useEffect } from "react";
import type { Result } from "@/lib/model";
export function Timeline({
  result,
  preferences,
  onPreferences,
}: {
  result: Result;
  preferences?: { mode: string; shift: number; scale: number };
  onPreferences: (v: { mode: string; shift: number; scale: number }) => void;
}) {
  const [view, setView] = useState(preferences?.mode ?? "full"),
    [shift, setShift] = useState(preferences?.shift ?? 0),
    [scale, setScale] = useState(preferences?.scale ?? 80);
  useEffect(() => {
    onPreferences({ mode: view, shift, scale });
  }, [view, shift, scale]);
  const end = Math.max(result.makespan, result.now, 1);
  const maxShift = Math.max(0, Math.ceil(end / 8) - 1);
  const start = view === "shift" ? Math.min(shift, maxShift) * 8 : 0;
  const span = view === "shift" ? 8 : end;
  const arrivals = [
    ...new Set(
      Object.values(result.schedule)
        .flat()
        .map((j) => j.arrival_time),
    ),
  ].sort((a, b) => a - b);
  const colors = ["#73b6a0", "#a6a9d9", "#c6ae78", "#8eb4cf", "#bd94b2"];
  return (
    <section className="panel timeline">
      <div className="section-head">
        <h2>Production timeline</h2>
        <div className="actions">
          {["full", "scroll", "shift"].map((v) => (
            <button
              aria-pressed={view === v}
              key={v}
              onClick={() => setView(v)}
            >
              {v}
            </button>
          ))}
          {view === "scroll" && (
            <input
              aria-label="Timeline zoom"
              type="range"
              min={20}
              max={240}
              value={scale}
              onChange={(e) => setScale(+e.target.value)}
            />
          )}{" "}
          {view === "shift" && (
            <>
              <button
                disabled={shift === 0}
                onClick={() => setShift(Math.max(0, shift - 1))}
              >
                Prev
              </button>
              <span>Shift {Math.min(shift, maxShift) + 1}</span>
              <button
                disabled={shift >= maxShift}
                onClick={() => setShift(shift + 1)}
              >
                Next
              </button>
            </>
          )}
        </div>
      </div>
      <div className="timeline-scroll">
        <div
          style={{
            minWidth: view === "scroll" ? `${end * scale + 120}px` : "0px",
          }}
        >
          <div className="lane axis">
            <strong>Machine</strong>
            <div>
              {Array.from({ length: 9 }, (_, i) => (
                <span key={i} style={{ left: `${(i / 8) * 100}%` }}>
                  {(start + (span * i) / 8).toFixed(1)}h
                </span>
              ))}
            </div>
          </div>
          {Object.entries(result.schedule).map(([machine, jobs]) => (
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
                      style={{ left: `${((t - start) / span) * 100}%` }}
                    />
                  ))}
                {result.now >= start && result.now <= start + span && (
                  <i
                    className="now-line"
                    style={{ left: `${((result.now - start) / span) * 100}%` }}
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
                        style={{
                          left: `${((left - start) / span) * 100}%`,
                          width: `${((right - left) / span) * 100}%`,
                          background:
                            colors[
                              arrivals.indexOf(j.arrival_time) % colors.length
                            ],
                        }}
                        title={`${j.id} | ${j.quantity} pieces | inks ${j.inks.join(", ")} | setup ${j.setup_start?.toFixed(3)} · ${j.start?.toFixed(3)} | complete ${j.completion?.toFixed(3)}h${j.locked ? " | locked" : ""}`}
                      >
                        <span
                          className="setup"
                          style={{
                            width: `${((j.start! - j.setup_start!) / duration) * 100}%`,
                          }}
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
      <div className="legend">
        <span>Hatched: setup</span>
        <span>Outlined: locked work</span>
        <span>White line: current time</span>
        {arrivals.map((a, i) => (
          <span key={a} style={{ color: colors[i % colors.length] }}>
            Batch {a}h
          </span>
        ))}
      </div>
    </section>
  );
}
