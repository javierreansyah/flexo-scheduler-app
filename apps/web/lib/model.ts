import industry from "./industry.json";
import profiles from "./profiles.json";
export type Job = {
  id: string;
  quantity: number;
  inks: number[];
  arrival_time: number;
  setup_start?: number;
  start?: number;
  completion?: number;
  ink_change_cost?: number;
  locked?: boolean;
};
export type Snapshot = {
  now: number;
  machines: Record<string, number>;
  jobs: Job[];
  locked: Record<string, Job[]>;
  machine_states?: Record<string, { available_time: number; inks: number[] }>;
  setup_time: number;
  ink_weight: number;
  batch_flow_time_weight: number;
  ink_costs?: Record<string, Record<string, number>>;
  setup_durations?: Record<string, Record<string, number>>;
};
export type Parameters = {
  evaluations: number;
  starts: number;
  stage_length: number;
  t_max: number;
  t_min: number;
  rcl_alpha: number;
  p_inter: number;
  p_shift: number;
  p_block: number;
};
export type Result = {
  engineVersion?: string;
  profileVersion?: string;
  inputSnapshot?: Snapshot;
  schedule: Record<string, Job[]>;
  fitness: number;
  ink_changes: number;
  batch_flow_time: number;
  makespan: number;
  seconds: number;
  parameters: Parameters;
  seed: string;
  now: number;
};
export type Project = {
  version: 1;
  snapshot: Snapshot;
  history: Result[];
  preset: "low" | "medium" | "high" | "custom";
  custom: Parameters;
  seed: string;
  view?: { mode: string; shift: number; scale: number };
};
export function parameters(n: number, preset = "medium"): Parameters {
  const size = [10, 30, 50, 100].sort(
    (a, b) => Math.abs(a - n) - Math.abs(b - n) || b - a,
  )[0];
  return (profiles as any)[size][preset];
}
export function initial(): Project {
  return {
    version: 1,
    snapshot: {
      now: 0,
      machines: { ...industry.machines },
      jobs: [],
      locked: {},
      setup_time: 0.75,
      ink_weight: 0.4,
      batch_flow_time_weight: 0.6,
    },
    history: [],
    preset: "medium",
    custom: { ...parameters(30) },
    seed: "42",
  };
}
export function example(): Project {
  const p = initial();
  p.snapshot.jobs = industry.jobs.map((j) => ({
    ...j,
    id: String(j.id),
    arrival_time: 0,
  }));
  return p;
}
export function advance(p: Project, now: number): Project {
  if (!Number.isFinite(now) || now < p.snapshot.now)
    throw Error("Arrival time cannot move backwards");
  const last = p.history.at(-1);
  if (!last) throw Error("Create the initial schedule first");
  if (
    last.inputSnapshot &&
    JSON.stringify(last.inputSnapshot) !== JSON.stringify(p.snapshot)
  )
    throw Error(
      "Optimize the current input changes before advancing time again",
    );
  const locked = Object.fromEntries(
    Object.entries(last.schedule).map(([m, jobs]) => [
      m,
      jobs
        .filter((j) => j.setup_start! <= now)
        .map((j) => ({ ...j, locked: true })),
    ]),
  );
  return { ...p, snapshot: { ...p.snapshot, now, locked } };
}
export function randomJobs(
  count: number,
  seed: number,
  now: number,
  prefix: string,
): Job[] {
  if (!Number.isInteger(count) || count < 1 || count > 10000)
    throw Error("Generate 1 to 10,000 jobs per action");
  const rng = random(seed);
  return Array.from({ length: count }, (_, i) => {
    const t = industry.jobs[Math.floor(rng() * industry.jobs.length)];
    return {
      id: `${prefix}${i + 1}`,
      quantity: Math.max(1000, Math.floor(t.quantity * (0.85 + 0.3 * rng()))),
      inks: [...t.inks],
      arrival_time: now,
    };
  });
}
export function random(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function importProject(v: unknown): Project {
  const p = v as Project;
  const finite = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  const job = (j: Job) =>
    j &&
    typeof j.id === "string" &&
    j.id.trim() &&
    Number.isInteger(j.quantity) &&
    j.quantity > 0 &&
    Array.isArray(j.inks) &&
    j.inks.every((i) => Number.isInteger(i) && i > 0) &&
    finite(j.arrival_time) &&
    j.arrival_time >= 0;
  if (
    !p ||
    p.version !== 1 ||
    !p.snapshot ||
    !Array.isArray(p.snapshot.jobs) ||
    !p.snapshot.jobs.every(job) ||
    !Array.isArray(p.history) ||
    !p.snapshot.machines ||
    !Object.keys(p.snapshot.machines).length ||
    Object.entries(p.snapshot.machines).some(
      ([n, r]) => !n.trim() || !finite(r) || r <= 0,
    ) ||
    !finite(p.snapshot.now) ||
    p.snapshot.now < 0 ||
    !p.snapshot.locked ||
    Object.values(p.snapshot.locked).some(
      (a) => !Array.isArray(a) || !a.every(job),
    ) ||
    !["low", "medium", "high", "custom"].includes(p.preset) ||
    !p.custom ||
    typeof p.seed !== "string" ||
    !/^\d+$/.test(p.seed) ||
    new Set(p.snapshot.jobs.map((j) => j.id)).size !== p.snapshot.jobs.length
  )
    throw Error("Invalid or unsupported project file");
  const validParameters = (v: Parameters) =>
    v &&
    ["evaluations", "starts", "stage_length"].every(
      (k) =>
        Number.isInteger((v as any)[k]) &&
        (v as any)[k] >= 1 &&
        (v as any)[k] <= 2000000000,
    ) &&
    v.starts <= 10 &&
    finite(v.t_max) &&
    finite(v.t_min) &&
    v.t_min > 0 &&
    v.t_max > v.t_min &&
    ["rcl_alpha", "p_inter", "p_shift", "p_block"].every(
      (k) => finite((v as any)[k]) && (v as any)[k] >= 0 && (v as any)[k] <= 1,
    );
  if (
    !validParameters(p.custom) ||
    BigInt(p.seed) > 18446744073709551615n ||
    !finite(p.snapshot.setup_time) ||
    !finite(p.snapshot.ink_weight) ||
    !finite(p.snapshot.batch_flow_time_weight)
  )
    throw Error("Invalid project settings");
  for (const r of p.history) {
    if (!validParameters(r.parameters) || typeof r.seed !== "string")
      throw Error("Invalid result settings");
    if (
      !r.schedule ||
      ![
        "fitness",
        "ink_changes",
        "batch_flow_time",
        "makespan",
        "seconds",
        "now",
      ].every((k) => finite((r as any)[k])) ||
      Object.values(r.schedule).some(
        (a) =>
          !Array.isArray(a) ||
          a.some(
            (j) =>
              !job(j) ||
              ![j.setup_start, j.start, j.completion, j.ink_change_cost].every(
                finite,
              ),
          ),
      )
    )
      throw Error("Invalid schedule history");
  }
  return p;
}
