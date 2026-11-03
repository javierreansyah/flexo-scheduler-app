import { inkCostMatrix } from "./ink-costs";
import type { Snapshot } from "./model";
export function transitionTimes(
  labels: string[],
  snapshot: Pick<Snapshot, "transition_times" | "ink_costs" | "setup_time">,
) {
  const costs = inkCostMatrix(labels, snapshot.ink_costs);
  return Object.fromEntries(
    labels.map((from) => [
      from,
      Object.fromEntries(
        labels.map((to) => [
          to,
          from === to
            ? 0
            : (snapshot.transition_times?.[from]?.[to] ??
              (costs[from][to] > 0 ? snapshot.setup_time : 0)),
        ]),
      ),
    ]),
  );
}
export function validateTransitionTimes(
  matrix: Record<string, Record<string, number>>,
) {
  const labels = Object.keys(matrix);
  if (
    !labels.includes("empty") ||
    labels.some((x) => x !== "empty" && !/^[1-9]\d*$/.test(x))
  )
    throw Error("Invalid transition time labels");
  for (const from of labels) {
    const row = matrix[from];
    if (
      !row ||
      typeof row !== "object" ||
      Object.keys(row).length !== labels.length
    )
      throw Error("Incomplete transition time matrix");
    for (const to of labels) {
      const value = row[to];
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < 0 ||
        value > 8 ||
        (from === to && value !== 0)
      )
        throw Error(
          "Transition times must be between 0 and 8 hours, with zero diagonal",
        );
    }
  }
}
