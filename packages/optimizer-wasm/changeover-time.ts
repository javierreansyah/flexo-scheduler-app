export type TimeMatrix = Record<string, Record<string, number>>;
/** Cancel retained inks, then minimize the longest cleaning among parallel workers. */
export function parallelChangeoverTime(
  from: number[],
  to: number[],
  times: TimeMatrix,
): number {
  const remaining = [...to];
  const removed: number[] = [];
  for (const ink of from) {
    const i = remaining.indexOf(ink);
    if (i < 0) removed.push(ink);
    else remaining.splice(i, 1);
  }
  const n = Math.max(removed.length, remaining.length);
  if (!n) return 0;
  while (removed.length < n) removed.push(0);
  while (remaining.length < n) remaining.push(0);
  const edges = removed.map((a) =>
    remaining.map((b) => times[a || "empty"][b || "empty"]),
  );
  const levels = [...new Set(edges.flat())].sort((a, b) => a - b);
  function feasible(limit: number) {
    const matched = Array<number>(n).fill(-1);
    function match(i: number, seen: boolean[]): boolean {
      for (let j = 0; j < n; j++) {
        if (seen[j] || edges[i][j] > limit) continue;
        seen[j] = true;
        if (matched[j] < 0 || match(matched[j], seen)) {
          matched[j] = i;
          return true;
        }
      }
      return false;
    }
    return removed.every((_, i) => match(i, Array<boolean>(n).fill(false)));
  }
  let low = 0,
    high = levels.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (feasible(levels[mid])) high = mid;
    else low = mid + 1;
  }
  return levels[low];
}
