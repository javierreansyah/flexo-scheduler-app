"use client";
import { InkCostMatrix } from "./ink-cost-matrix";
import { inkLabels, inkCostMatrix, isIndustryInkMatrix } from "@/lib/ink-costs";
import { useEffect, useRef, useState } from "react";
import { get, set } from "idb-keyval";
import Papa from "papaparse";
import {
  ArrowUpRight,
  Plus,
  Play,
  Square,
  Download,
  Upload,
  RotateCcw,
  Shuffle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import GridBackground from "./background-effect";
import ContactLinks from "./contact-links";
import { DataGrid } from "./data-grid";
import { Timeline } from "./timeline";
import {
  initial,
  example,
  advance,
  randomJobs,
  random,
  parameters,
  importProject,
  Project,
  Job,
} from "@/lib/model";
import { run } from "@/lib/runner";
const jobColumns = [
  { key: "id", label: "Job ID" },
  { key: "quantity", label: "Quantity" },
  { key: "inks", label: "Inks" },
  { key: "arrival", label: "Arrival (h)" },
  { key: "status", label: "Status" },
];
const machineColumns = [
  { key: "name", label: "Machine" },
  { key: "rate", label: "Pieces / min" },
  { key: "available", label: "Available (h)" },
  { key: "inks", label: "Initial inks" },
];
function download(name: string, data: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function Workspace() {
  const [project, update] = useState<Project>(initial),
    [ready, setReady] = useState(false),
    [savedProject, setSavedProject] = useState<Project | null>(null),
    [saveError, setSaveError] = useState(false),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0),
    [elapsed, setElapsed] = useState(0),
    [bestFitness, setBestFitness] = useState<number | null>(null),
    [error, setError] = useState(""),
    [tab, setTab] = useState("jobs"),
    [count, setCount] = useState(30),
    [machineCount, setMachineCount] = useState(3),
    [arrival, setArrival] = useState(1),
    [historyIndex, setHistoryIndex] = useState(-1),
    [from, setFrom] = useState("empty"),
    [to, setTo] = useState(""),
    [duration, setDuration] = useState(0.75);
  const active = useRef<ReturnType<typeof run> | null>(null),
    file = useRef<HTMLInputElement>(null),
    csv = useRef<HTMLInputElement>(null);
  const snapshot = project.snapshot,
    history = project.history;
  const physicalLocked = history.length > 0;
  useEffect(() => {
    if (!snapshot.ink_costs) return;
    const complete = inkCostMatrix(
      inkLabels(snapshot, false),
      snapshot.ink_costs,
    );
    if (JSON.stringify(complete) !== JSON.stringify(snapshot.ink_costs))
      update((p) => ({
        ...p,
        snapshot: { ...p.snapshot, ink_costs: complete },
      }));
  }, [snapshot.jobs, snapshot.machine_states, snapshot.ink_costs]);

  const fixed = new Set(
    Object.values(snapshot.locked)
      .flat()
      .map((j) => String(j.id)),
  );
  const movable = snapshot.jobs.filter((j) => !fixed.has(String(j.id))).length;
  const params =
    project.preset === "custom"
      ? project.custom
      : parameters(movable, project.preset);
  const result = historyIndex < 0 ? history.at(-1) : history[historyIndex];
  useEffect(() => {
    if (!busy) return;
    const start = performance.now();
    const id = setInterval(
      () => setElapsed((performance.now() - start) / 1000),
      250,
    );
    return () => clearInterval(id);
  }, [busy]);
  useEffect(() => {
    get("flexo-project-v1")
      .then((v) => {
        if (v) {
          if (
            v.version !== 1 ||
            !v.snapshot ||
            !Array.isArray(v.snapshot.jobs) ||
            !Array.isArray(v.history)
          )
            throw Error("Unsupported local workspace");
          update(v);
        }
      })
      .catch((e) => setError(`Could not restore saved work: ${e}`))
      .finally(() => setReady(true));
    return () => active.current?.cancel();
  }, []);
  useEffect(() => {
    if (!ready) return;
    let current = true;
    setSaveError(false);
    set("flexo-project-v1", project)
      .then(() => {
        if (current) setSavedProject(project);
      })
      .catch((e) => {
        if (current) {
          setSaveError(true);
          setError(
            `Autosave unavailable: ${e}. Export your project to keep it.`,
          );
        }
      });
    return () => {
      current = false;
    };
  }, [project, ready]);
  function changeSnapshot(change: Partial<Project["snapshot"]>) {
    update((p) => ({ ...p, snapshot: { ...p.snapshot, ...change } }));
  }
  function action(fn: () => void) {
    try {
      setError("");
      fn();
    } catch (e) {
      setError(String(e));
    }
  }
  async function optimize() {
    setError("");
    setBusy(true);
    setProgress(0);
    setElapsed(0);
    setBestFitness(null);
    try {
      if (
        !/^\d+$/.test(project.seed) ||
        BigInt(project.seed) > 18446744073709551615n
      )
        throw Error("Seed must be an unsigned 64-bit integer");
      if (!snapshot.jobs.length) throw Error("Add jobs before optimizing");
      const task = run(snapshot, params, project.seed, (value, best) => {
        setProgress(value);
        if (best !== undefined) setBestFitness(best);
      });
      active.current = task;
      const output = await task.promise;
      const next = { ...project, history: [...project.history, output] };
      try {
        await set("flexo-project-v1", next);
      } catch (e) {
        setError(
          `Result is ready, but autosave failed: ${e}. Export your project.`,
        );
      }
      update(next);
      setHistoryIndex(-1);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
      active.current = null;
    }
  }
  function replace(p: Project) {
    if (
      history.length &&
      !confirm(
        "Replace this project and its history? Export your project first if you want to retain it.",
      )
    )
      return;
    update(p);
    setHistoryIndex(-1);
    setError("");
  }
  function appendJobs(jobs: Job[]) {
    update((p) => ({
      ...p,
      snapshot: { ...p.snapshot, jobs: [...p.snapshot.jobs, ...jobs] },
    }));
  }
  return (
    <main>
      <header>
        <GridBackground
          enabled={!busy}
          className="masthead"
          config={{
            seed: 2,
            cameraX: 10,
            cameraY: 4,
            noiseBrightness: 0.36,
            noiseContrast: 24,
          }}
          gradation={{ rowCount: 2, direction: "down" }}
          initialEvents={[
            {
              property: "noiseBrightness",
              stepSize: 0.002,
              keyframes: [
                { target: 0, duration: 0 },
                { target: 0.36, duration: 1000, ease: "easeOut" },
              ],
            },
          ]}
        >
          <div className="hero">
            <h1>Flexo Scheduler</h1>
          </div>
        </GridBackground>
      </header>
      <div id="workspace" className="workspace">
        <div className="workspace-title">
          <div>
            <p className="eyebrow">
              Scheduling workspace / {String(history.length).padStart(2, "0")}{" "}
              horizons
            </p>
            <h2>Your next production run.</h2>
          </div>
          <div className="actions">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => replace(example())}
            >
              Industry example <ArrowUpRight size={14} />
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => replace(initial())}
            >
              <RotateCcw size={14} /> New
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                download("flexo-project.json", JSON.stringify(project, null, 2))
              }
            >
              <Download size={14} /> Export project
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => file.current?.click()}
            >
              <Upload size={14} /> Import
            </Button>
          </div>
        </div>
        <input
          ref={file}
          type="file"
          accept=".json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f)
              try {
                replace(importProject(JSON.parse(await f.text())));
              } catch (e) {
                setError(String(e));
              }
            e.target.value = "";
          }}
        />
        {!ready && (
          <p role="status">
            Running locally - {Math.round(progress * 100)}% search complete -{" "}
            {elapsed.toFixed(1)}s
            {bestFitness !== null
              ? ` - best completed start ${bestFitness.toFixed(5)}`
              : ""}
          </p>
        )}
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        <div className="editor-layout">
          <section className="panel inputs">
            <div className="tabs">
              {["jobs", "machines", "changeovers"].map((v) => (
                <button
                  key={v}
                  aria-pressed={tab === v}
                  onClick={() => setTab(v)}
                >
                  {v}
                  {v === "jobs" ? ` / ${snapshot.jobs.length}` : ""}
                </button>
              ))}
            </div>
            {tab === "jobs" && (
              <>
                <div className="section-head">
                  <div>
                    <h3>Orders & batches</h3>
                    <p>
                      {movable} movable · {fixed.size} locked · current time{" "}
                      {snapshot.now}h
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      appendJobs([
                        {
                          id: `J-${Date.now()}`,
                          quantity: 10000,
                          inks: [],
                          arrival_time: snapshot.now,
                        },
                      ])
                    }
                  >
                    <Plus size={14} /> Add job
                  </Button>
                </div>
                <div className="actions inset">
                  <label>
                    Generate{" "}
                    <input
                      aria-label="Jobs to generate"
                      type="number"
                      min={1}
                      max={10000}
                      value={count}
                      onChange={(e) => setCount(+e.target.value)}
                    />
                  </label>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      action(() =>
                        appendJobs(
                          randomJobs(
                            count,
                            Number(project.seed),
                            snapshot.now,
                            `B${history.length}-${snapshot.jobs.length}-`,
                          ),
                        ),
                      )
                    }
                  >
                    <Shuffle size={14} /> Generate jobs
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => csv.current?.click()}
                  >
                    Import CSV
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      download(
                        "jobs.csv",
                        Papa.unparse(
                          snapshot.jobs.map((j) => ({
                            id: j.id,
                            quantity: j.quantity,
                            inks: j.inks.join(","),
                            arrival_time: j.arrival_time,
                          })),
                          { escapeFormulae: true },
                        ),
                        "text/csv",
                      )
                    }
                  >
                    Export CSV
                  </Button>
                </div>
                <DataGrid
                  rows={snapshot.jobs.map((j) => ({
                    id: j.id,
                    quantity: String(j.quantity),
                    inks: j.inks.join(", "),
                    arrival: String(j.arrival_time),
                    status: fixed.has(String(j.id)) ? "Locked" : "Movable",
                  }))}
                  columns={jobColumns}
                  onDeleteMany={(indices) =>
                    changeSnapshot({
                      jobs: snapshot.jobs.filter(
                        (_, i) => !indices.includes(i),
                      ),
                    })
                  }
                  onPasteCells={(cells, append) =>
                    action(() => {
                      const jobs = structuredClone(snapshot.jobs);
                      for (const c of cells) {
                        (jobs[c.i] as any)[c.key] =
                          c.key === "quantity"
                            ? Number(c.value)
                            : c.key === "inks"
                              ? c.value
                                  .split(/[ ,]+/)
                                  .filter(Boolean)
                                  .map(Number)
                              : c.value;
                      }
                      for (const r of append)
                        jobs.push({
                          id: r.id || `J-${Date.now()}-${jobs.length}`,
                          quantity: Number(r.quantity ?? 10000),
                          inks: (r.inks ?? "")
                            .split(/[ ,]+/)
                            .filter(Boolean)
                            .map(Number),
                          arrival_time: snapshot.now,
                        });
                      changeSnapshot({ jobs });
                    })
                  }
                  disabled={busy}
                  onDelete={(i) =>
                    changeSnapshot({
                      jobs: snapshot.jobs.filter((_, x) => x !== i),
                    })
                  }
                  onChange={(i, key, value) =>
                    update((p) => ({
                      ...p,
                      snapshot: {
                        ...p.snapshot,
                        jobs: p.snapshot.jobs.map((j, k) =>
                          k !== i
                            ? j
                            : {
                                ...j,
                                [key]:
                                  key === "quantity"
                                    ? Number(value)
                                    : key === "inks"
                                      ? value
                                          .split(/[ ,]+/)
                                          .filter(Boolean)
                                          .map(Number)
                                      : value,
                              },
                        ),
                      },
                    }))
                  }
                />
                {history.length > 0 && (
                  <div className="arrival">
                    <div>
                      <h3>Another batch has arrived?</h3>
                      <p>
                        Advance time, preserve started work, then add the new
                        orders.
                      </p>
                    </div>
                    <label>
                      Arrival hour{" "}
                      <input
                        aria-label="Next batch arrival hour"
                        type="number"
                        min={snapshot.now}
                        step="any"
                        value={arrival}
                        onChange={(e) => setArrival(+e.target.value)}
                      />
                    </label>
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        action(() => {
                          update(advance(project, arrival));
                          setArrival(arrival + 1);
                        })
                      }
                    >
                      Start arrival batch <ArrowUpRight size={14} />
                    </Button>
                  </div>
                )}
              </>
            )}
            {tab === "machines" && (
              <>
                <div className="section-head">
                  <div>
                    <h3>Machine configuration</h3>
                    <p>
                      {physicalLocked
                        ? "Equipment is fixed for this project. Start a new project to change it."
                        : "Rates are pieces per minute. Availability is in production hours."}
                    </p>
                  </div>
                </div>
                <div className="actions inset">
                  <Button
                    variant="outline"
                    disabled={busy || physicalLocked}
                    onClick={() =>
                      changeSnapshot({
                        machines: {
                          ...snapshot.machines,
                          [`Machine ${Object.keys(snapshot.machines).length + 1}`]: 150,
                        },
                      })
                    }
                  >
                    <Plus size={14} /> Add machine
                  </Button>
                  <label>
                    Count{" "}
                    <input
                      aria-label="Machines to generate"
                      type="number"
                      min={1}
                      max={100}
                      value={machineCount}
                      onChange={(e) => setMachineCount(+e.target.value)}
                    />
                  </label>
                  <Button
                    variant="outline"
                    disabled={busy || physicalLocked}
                    onClick={() =>
                      action(() => {
                        if (
                          !Number.isInteger(machineCount) ||
                          machineCount < 1 ||
                          machineCount > 100
                        )
                          throw Error("Generate 1?100 machines");
                        const rng = random(Number(project.seed));
                        changeSnapshot({
                          machines: Object.fromEntries(
                            Array.from({ length: machineCount }, (_, i) => [
                              `Machine ${i + 1}`,
                              Math.round(
                                [112, 224, 175][Math.floor(rng() * 3)] *
                                  (0.85 + 0.3 * rng()) *
                                  100,
                              ) / 100,
                            ]),
                          ),
                          machine_states: {},
                        });
                      })
                    }
                  >
                    Generate machines
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy || physicalLocked}
                    onClick={() => csv.current?.click()}
                  >
                    Import CSV
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      download(
                        "machines.csv",
                        Papa.unparse(
                          Object.entries(snapshot.machines).map(
                            ([name, rate]) => ({
                              name,
                              rate,
                              ...snapshot.machine_states?.[name],
                              inks:
                                snapshot.machine_states?.[name]?.inks.join(
                                  ",",
                                ) ?? "",
                            }),
                          ),
                          { escapeFormulae: true },
                        ),
                        "text/csv",
                      )
                    }
                  >
                    Export CSV
                  </Button>
                </div>
                <DataGrid
                  rows={Object.entries(snapshot.machines).map(
                    ([name, rate]) => ({
                      name,
                      rate: String(rate),
                      available: String(
                        snapshot.machine_states?.[name]?.available_time ?? 0,
                      ),
                      inks: (snapshot.machine_states?.[name]?.inks ?? []).join(
                        ",",
                      ),
                    }),
                  )}
                  columns={machineColumns}
                  onDeleteMany={(indices) => {
                    const machines = Object.fromEntries(
                      Object.entries(snapshot.machines).filter(
                        (_, i) => !indices.includes(i),
                      ),
                    );
                    changeSnapshot({
                      machines,
                      machine_states: Object.fromEntries(
                        Object.entries(snapshot.machine_states ?? {}).filter(
                          ([m]) => m in machines,
                        ),
                      ),
                    });
                  }}
                  onPasteCells={(cells, append) =>
                    action(() => {
                      const rows = Object.entries(snapshot.machines).map(
                        ([name, rate]) => ({
                          name,
                          rate: String(rate),
                          available: String(
                            snapshot.machine_states?.[name]?.available_time ??
                              0,
                          ),
                          inks: (
                            snapshot.machine_states?.[name]?.inks ?? []
                          ).join(","),
                        }),
                      );
                      for (const c of cells)
                        (rows[c.i] as any)[c.key] = c.value;
                      for (const r of append)
                        rows.push({
                          name: r.name || `Machine ${rows.length + 1}`,
                          rate: r.rate ?? "150",
                          available: r.available ?? "0",
                          inks: r.inks ?? "",
                        });
                      if (new Set(rows.map((r) => r.name)).size !== rows.length)
                        throw Error("Machine names must be unique");
                      changeSnapshot({
                        machines: Object.fromEntries(
                          rows.map((r) => [r.name, Number(r.rate)]),
                        ),
                        machine_states: Object.fromEntries(
                          rows.map((r) => [
                            r.name,
                            {
                              available_time: Number(r.available),
                              inks: r.inks
                                .split(/[ ,]+/)
                                .filter(Boolean)
                                .map(Number),
                            },
                          ]),
                        ),
                      });
                    })
                  }
                  disabled={busy || physicalLocked}
                  onDelete={(i) =>
                    changeSnapshot({
                      machines: Object.fromEntries(
                        Object.entries(snapshot.machines).filter(
                          (_, k) => k !== i,
                        ),
                      ),
                      machine_states: {},
                    })
                  }
                  onChange={(i, key, value) => {
                    const entries = Object.entries(snapshot.machines);
                    const [name, rate] = entries[i];
                    if (key === "name") {
                      if (value in snapshot.machines && value !== name) {
                        setError("Machine names must be unique");
                        return;
                      }
                      entries[i] = [value, rate];
                      const states = { ...snapshot.machine_states };
                      if (states[name]) {
                        states[value] = states[name];
                        delete states[name];
                      }
                      changeSnapshot({
                        machines: Object.fromEntries(entries),
                        machine_states: states,
                      });
                    } else if (key === "rate") {
                      entries[i] = [name, Number(value)];
                      changeSnapshot({ machines: Object.fromEntries(entries) });
                    } else {
                      changeSnapshot({
                        machine_states: {
                          ...snapshot.machine_states,
                          [name]: {
                            available_time:
                              snapshot.machine_states?.[name]?.available_time ??
                              0,
                            inks: snapshot.machine_states?.[name]?.inks ?? [],
                            [key === "available" ? "available_time" : "inks"]:
                              key === "available"
                                ? Number(value)
                                : value
                                    .split(/[ ,]+/)
                                    .filter(Boolean)
                                    .map(Number),
                          },
                        },
                      });
                    }
                  }}
                />
                <p className="note inset">
                  Random rates sample the three industry rates with ±15%
                  variation. Presets were calibrated on the original
                  three-machine setup.
                </p>
              </>
            )}
            {tab === "changeovers" && (
              <div className="settings">
                <h3>Changeovers</h3>
                <p>
                  Directed ink costs and setup durations are separate. Pattern
                  keys are sorted ink IDs (for example 2,6); use empty for a
                  clean machine.
                </p>
                <label>
                  Default setup duration (hours)
                  <input
                    disabled={physicalLocked || busy}
                    type="number"
                    min={0}
                    max={8}
                    step="any"
                    value={snapshot.setup_time}
                    onChange={(e) =>
                      changeSnapshot({ setup_time: +e.target.value })
                    }
                  />
                </label>
                <h4>Setup duration override</h4>
                <div className="actions">
                  <input
                    aria-label="Setup source pattern"
                    placeholder="empty"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                  />
                  <span>&rarr;</span>
                  <input
                    aria-label="Setup target pattern"
                    placeholder="2,6"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                  />
                  <input
                    aria-label="Transition duration"
                    type="number"
                    min={0}
                    max={8}
                    step="any"
                    value={duration}
                    onChange={(e) => setDuration(+e.target.value)}
                  />
                  <Button
                    disabled={physicalLocked || busy}
                    variant="outline"
                    onClick={() =>
                      changeSnapshot({
                        setup_durations: {
                          ...snapshot.setup_durations,
                          [from]: {
                            ...snapshot.setup_durations?.[from],
                            [to]: duration,
                          },
                        },
                      })
                    }
                  >
                    Set hours
                  </Button>
                </div>
                {Object.entries(snapshot.setup_durations ?? {}).flatMap(
                  ([a, row]) =>
                    Object.entries(row).map(([b, t]) => (
                      <div className="transition" key={a + b}>
                        {a} · {b}
                        <span>{t}h</span>
                        <button
                          disabled={physicalLocked || busy}
                          onClick={() => {
                            const d = structuredClone(
                              snapshot.setup_durations!,
                            );
                            delete d[a][b];
                            if (!Object.keys(d[a]).length) delete d[a];
                            changeSnapshot({ setup_durations: d });
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    )),
                )}
                <InkCostMatrix
                  snapshot={snapshot}
                  disabled={physicalLocked || busy}
                  onChange={(ink_costs) => changeSnapshot({ ink_costs })}
                />
              </div>
            )}
          </section>
          <aside className="panel optimizer">
            <p className="eyebrow">Search controls</p>
            <h3>Find the right balance.</h3>
            <div className="presets">
              {[
                ["low", "Quick"],
                ["medium", "Balanced"],
                ["high", "Thorough"],
                ["custom", "Custom"],
              ].map(([key, label]) => (
                <button
                  key={key}
                  disabled={busy}
                  aria-pressed={project.preset === key}
                  onClick={() =>
                    update((p) => ({
                      ...p,
                      preset: key as Project["preset"],
                      custom: key === "custom" ? { ...params } : p.custom,
                    }))
                  }
                >
                  {label}
                  <ArrowUpRight size={13} />
                </button>
              ))}
            </div>
            <p className="note">
              {params.evaluations.toLocaleString("en-US")} total proposals ·{" "}
              {params.starts} starts
            </p>
            {project.preset !== "custom" && (
              <p className="note">
                {parameters(movable, "low").evaluations ===
                parameters(movable, "medium").evaluations
                  ? "Quick and Balanced share settings at this size. "
                  : ""}
                Quality tradeoffs are measured averages, not guarantees.
              </p>
            )}
            {!isIndustryInkMatrix(snapshot.ink_costs) && (
              <p className="warning">
                Custom ink costs: preset quality was calibrated using the
                industry matrix.
              </p>
            )}
            {movable > 100 && (
              <p className="warning">
                Above the calibrated range of 100 movable jobs. Browser runtime
                and preset quality are unvalidated.
              </p>
            )}
            {project.preset === "custom" && (
              <div className="parameter-grid">
                {Object.entries(project.custom).map(([key, value]) => (
                  <label key={key}>
                    {key}
                    <input
                      disabled={busy}
                      aria-label={key}
                      type="number"
                      step="any"
                      value={value}
                      onChange={(e) =>
                        update((p) => ({
                          ...p,
                          custom: { ...p.custom, [key]: +e.target.value },
                        }))
                      }
                    />
                  </label>
                ))}
              </div>
            )}
            <label>
              Random seed
              <input
                disabled={busy}
                aria-label="Random seed"
                inputMode="numeric"
                value={project.seed}
                onChange={(e) =>
                  update((p) => ({ ...p, seed: e.target.value }))
                }
              />
            </label>
            <div className="weights">
              <label>
                Ink weight
                <input
                  disabled={busy}
                  type="number"
                  min={0}
                  step="any"
                  value={snapshot.ink_weight}
                  onChange={(e) =>
                    changeSnapshot({ ink_weight: +e.target.value })
                  }
                />
              </label>
              <label>
                Flow weight
                <input
                  disabled={busy}
                  type="number"
                  min={0}
                  step="any"
                  value={snapshot.batch_flow_time_weight}
                  onChange={(e) =>
                    changeSnapshot({ batch_flow_time_weight: +e.target.value })
                  }
                />
              </label>
            </div>
            <Button
              className="run-button"
              disabled={busy || !ready}
              onClick={optimize}
            >
              <Play size={14} /> Optimize schedule
            </Button>
            {busy && (
              <>
                <div
                  role="progressbar"
                  aria-valuenow={Math.round(progress * 100)}
                  className="run-progress"
                >
                  <i style={{ width: `${progress * 100}%` }} />
                </div>
                <p role="status">
                  Running locally · {Math.round(progress * 100)}% of starts
                  complete
                </p>
                <Button
                  variant="outline"
                  onClick={() => active.current?.cancel()}
                >
                  <Square size={12} /> Cancel
                </Button>
              </>
            )}
            <p className="note privacy">
              Your work stays on this device.
              <br />
              <span role="status">
                {saveError
                  ? "Autosave unavailable"
                  : savedProject === project
                    ? "Saved locally"
                    : "Saving locally..."}
              </span>
              . Export a copy to keep it elsewhere.
            </p>
          </aside>
        </div>
        <input
          ref={csv}
          type="file"
          accept=".csv"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f)
              try {
                const parsed = Papa.parse<Record<string, string>>(
                  await f.text(),
                  { header: true, skipEmptyLines: true },
                );
                if (parsed.errors.length) throw Error(parsed.errors[0].message);
                if (tab === "machines") {
                  if (physicalLocked) throw Error("Equipment is locked");
                  const machines: Record<string, number> = {};
                  for (const row of parsed.data) {
                    if (!row.name || row.name in machines || !(+row.rate > 0))
                      throw Error("Invalid or duplicate machine CSV row");
                    machines[row.name] = +row.rate;
                  }
                  changeSnapshot({
                    machines,
                    machine_states: Object.fromEntries(
                      parsed.data.map((row) => [
                        row.name,
                        {
                          available_time: Number(row.available_time ?? 0),
                          inks: (row.inks ?? "")
                            .split(/[ ,]+/)
                            .filter(Boolean)
                            .map(Number),
                        },
                      ]),
                    ),
                  });
                } else {
                  const jobs = parsed.data.map((row) => ({
                    id: row.id,
                    quantity: Number(row.quantity),
                    inks: (row.inks ?? "")
                      .split(/[ ,]+/)
                      .filter(Boolean)
                      .map(Number),
                    arrival_time: snapshot.now,
                  }));
                  if (
                    jobs.some(
                      (j) =>
                        !j.id ||
                        !Number.isInteger(j.quantity) ||
                        j.quantity < 1,
                    ) ||
                    new Set([...snapshot.jobs, ...jobs].map((j) => j.id))
                      .size !==
                      snapshot.jobs.length + jobs.length
                  )
                    throw Error("Invalid or duplicate job CSV rows");
                  appendJobs(jobs);
                }
              } catch (e) {
                setError(String(e));
              }
            e.target.value = "";
          }}
        />
        {result && (
          <>
            {history.at(-1)?.inputSnapshot &&
              JSON.stringify(history.at(-1)?.inputSnapshot) !==
                JSON.stringify(snapshot) && (
                <p className="warning">
                  Inputs changed. The timeline shows the last successful result;
                  optimize again to update it.
                </p>
              )}
            <div className="results-heading">
              <div>
                <p className="eyebrow">Measured output</p>
                <h2>A schedule, with perspective.</h2>
              </div>
              <select
                aria-label="Schedule history"
                value={historyIndex < 0 ? history.length - 1 : historyIndex}
                onChange={(e) => setHistoryIndex(+e.target.value)}
              >
                {history.map((r, i) => (
                  <option key={i} value={i}>
                    Horizon {i + 1} · {r.now}h
                  </option>
                ))}
              </select>
            </div>
            <div className="metrics">
              {[
                ["Fitness", result.fitness.toFixed(5)],
                ["Ink cost", result.ink_changes.toFixed(2)],
                ["Batch flow", `${result.batch_flow_time.toFixed(3)}h`],
                ["Makespan", `${result.makespan.toFixed(3)}h`],
                ["Compute time", `${result.seconds.toFixed(3)}s`],
              ].map(([label, value]) => (
                <div key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
            <Timeline
              key={historyIndex}
              result={result}
              preferences={project.view}
              onPreferences={(view) => update((p) => ({ ...p, view }))}
            />
            <details className="panel schedule-details">
              <summary>Schedule details & export</summary>
              <Button
                variant="outline"
                onClick={() =>
                  download(
                    "schedule.csv",
                    Papa.unparse(
                      Object.entries(result.schedule).flatMap(
                        ([machine, jobs]) =>
                          jobs.map((j) => ({
                            ...j,
                            machine,
                            inks: j.inks.join(","),
                          })),
                      ),
                      { escapeFormulae: true },
                    ),
                    "text/csv",
                  )
                }
              >
                Export schedule CSV
              </Button>
              <div className="grid-scroll">
                <table>
                  <thead>
                    <tr>
                      {[
                        "Machine",
                        "Job",
                        "Setup",
                        "Start",
                        "Complete",
                        "Locked",
                      ].map((x) => (
                        <th key={x}>{x}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(result.schedule).flatMap(([m, jobs]) =>
                      jobs.map((j) => (
                        <tr key={j.id}>
                          <td>{m}</td>
                          <td>{j.id}</td>
                          <td>{j.setup_start?.toFixed(3)}</td>
                          <td>{j.start?.toFixed(3)}</td>
                          <td>{j.completion?.toFixed(3)}</td>
                          <td>{j.locked ? "Yes" : "No"}</td>
                        </tr>
                      )),
                    )}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        )}
      </div>
      <footer className="portfolio-footer">
        <GridBackground
          enabled={!busy}
          config={{
            seed: 7,
            cameraY: 0,
            cameraX: 0,
            noiseBrightness: 0.36,
            noiseContrast: 24,
          }}
          gradation={{ rowCount: 2, direction: "up" }}
        >
          <div className="portfolio-footer-content">
            <h2>
              Javier <br /> Reansyah
            </h2>
            <ContactLinks />
          </div>
        </GridBackground>
      </footer>
    </main>
  );
}
