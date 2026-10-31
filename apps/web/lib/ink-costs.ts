import industry from "./industry.json";
import type { Snapshot } from "./model";
export type InkCosts = Record<string, Record<string, number>>;
export function industryInkCost(from: string, to: string) {
  return Number(
    Number(from === "empty" ? 0 : from) > Number(to === "empty" ? 0 : to),
  );
}
export function inkLabels(snapshot: Snapshot, includeIndustry = true) {
  return [
    "empty",
    ...new Set([
      ...(includeIndustry ? industry.jobs.flatMap((j) => j.inks) : []),
      ...snapshot.jobs.flatMap((j) => j.inks),
      ...Object.values(snapshot.machine_states ?? {}).flatMap((s) => s.inks),
      ...Object.keys(snapshot.ink_costs ?? {})
        .filter((k) => k !== "empty")
        .map(Number),
    ]),
  ]
    .filter((v, i) => i === 0 || (Number.isInteger(v) && Number(v) > 0))
    .map(String)
    .sort((a, b) =>
      a === "empty" ? -1 : b === "empty" ? 1 : Number(a) - Number(b),
    );
}
export function inkCostMatrix(labels: string[], existing?: InkCosts): InkCosts {
  return Object.fromEntries(
    labels.map((from) => [
      from,
      Object.fromEntries(
        labels.map((to) => [
          to,
          existing?.[from]?.[to] ?? industryInkCost(from, to),
        ]),
      ),
    ]),
  );
}
export function isIndustryInkMatrix(costs?: InkCosts) {
  return (
    !costs ||
    Object.entries(costs).every(([from, row]) =>
      Object.entries(row).every(
        ([to, cost]) => cost === industryInkCost(from, to),
      ),
    )
  );
}
