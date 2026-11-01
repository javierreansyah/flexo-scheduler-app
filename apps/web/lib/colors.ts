import type { Project } from "./model";
export type InkColor = { id: number; name: string; hex: string };
export const starterColors: InkColor[] = [
  { id: 1, name: "Red", hex: "#be4545" },
  { id: 2, name: "Green", hex: "#4d916a" },
  { id: 3, name: "Brown", hex: "#8a6147" },
];
export function projectColors(p: Project): InkColor[] {
  const map = new Map((p.colors ?? []).map((c) => [c.id, c]));
  const ids = new Set([
    ...p.snapshot.jobs.flatMap((j) => j.inks),
    ...Object.values(p.snapshot.machine_states ?? {}).flatMap((s) => s.inks),
    ...Object.keys(p.snapshot.ink_costs ?? {})
      .filter((k) => k !== "empty")
      .map(Number),
  ]);
  for (const id of ids)
    if (Number.isInteger(id) && id > 0 && !map.has(id))
      map.set(id, {
        id,
        name: `Color ${String.fromCharCode(64 + id)}`,
        hex: "#808080",
      });
  return [...map.values()];
}
export function colorNames(ids: number[], colors: InkColor[]) {
  return ids
    .map((id) => colors.find((c) => c.id === id)?.name ?? String(id))
    .join(", ");
}
export function parseColors(value: string, colors: InkColor[]) {
  if (/^[\d\s,]*$/.test(value))
    return value.split(/[ ,]+/).filter(Boolean).map(Number);
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(
      (name) =>
        colors.find((c) => c.name.toLowerCase() === name.toLowerCase())?.id ??
        NaN,
    );
}
