import Papa from "papaparse";
import { colorNames, parseColors, type InkColor } from "./colors";
import type { Result, Snapshot } from "./model";
export function importCsv(
  text: string,
  kind: "jobs" | "machines",
  snapshot: Snapshot,
  colors: InkColor[],
  physicalLocked: boolean,
): Partial<Snapshot> {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  });
  if (parsed.errors.length) throw Error(parsed.errors[0].message);
  if (kind === "machines") {
    if (physicalLocked) throw Error("Equipment is locked");
    const machines: Record<string, number> = {};
    for (const row of parsed.data) {
      if (!row.name || row.name in machines || !(+row.rate > 0))
        throw Error("Invalid or duplicate machine CSV row");
      machines[row.name] = +row.rate;
    }
    return {
      machines,
      machine_states: Object.fromEntries(
        parsed.data.map((row) => [
          row.name,
          {
            available_time: Number(row.available_time ?? 0),
            inks: parseColors(row.inks ?? "", colors),
          },
        ]),
      ),
    };
  } else {
    const jobs = parsed.data.map((row) => ({
      id: row.id,
      quantity: Number(row.quantity),
      inks: parseColors(row.inks ?? "", colors),
      arrival_time: snapshot.now,
    }));
    if (
      jobs.some(
        (j) => !j.id || !Number.isInteger(j.quantity) || j.quantity < 1,
      ) ||
      new Set([...snapshot.jobs, ...jobs].map((j) => j.id)).size !==
        snapshot.jobs.length + jobs.length
    )
      throw Error("Invalid or duplicate job CSV rows");
    return { jobs: [...snapshot.jobs, ...jobs] };
  }
}
export function exportCsv(rows: Record<string, unknown>[]) {
  return Papa.unparse(rows, { escapeFormulae: true });
}
export function jobCsv(snapshot: Snapshot, colors: InkColor[]) {
  return exportCsv(
    snapshot.jobs.map((j) => ({
      id: j.id,
      quantity: j.quantity,
      inks: colorNames(j.inks, colors),
      arrival_time: j.arrival_time,
    })),
  );
}
export function machineCsv(snapshot: Snapshot, colors: InkColor[]) {
  return exportCsv(
    Object.entries(snapshot.machines).map(([name, rate]) => ({
      name,
      rate,
      ...snapshot.machine_states?.[name],
      inks: colorNames(snapshot.machine_states?.[name]?.inks ?? [], colors),
    })),
  );
}
export function scheduleCsv(result: Result, colors: InkColor[]) {
  return exportCsv(
    Object.entries(result.schedule).flatMap(([machine, jobs]) =>
      jobs.map((j) => ({ ...j, machine, inks: colorNames(j.inks, colors) })),
    ),
  );
}
