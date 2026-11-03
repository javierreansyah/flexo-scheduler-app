import { expect, test } from "vitest";
import { initial, advance, importProject } from "./model";
import {
  normalizeHorizons,
  commitResult,
  activeNode,
  trackChanges,
  selectNode,
  selectedResult,
  nodeLabels,
} from "./horizons";
function result(p: ReturnType<typeof initial>) {
  return {
    inputSnapshot: structuredClone(p.snapshot),
    schedule: {},
    fitness: 1,
    ink_changes: 0,
    batch_flow_time: 0,
    makespan: 0,
    seconds: 0,
    parameters: p.custom,
    seed: p.seed,
    now: p.snapshot.now,
  };
}
test("same-time checkpoints branch and drafts survive switching", () => {
  let p = normalizeHorizons(initial());
  p = commitResult(p, result(p));
  const first = activeNode(p).id;
  p = commitResult(p, result(p));
  expect(p.horizons!.nodes).toHaveLength(2);
  expect([...nodeLabels(p).values()]).toEqual([
    "Horizon 1 · 0h · C1",
    "Horizon 1 · 0h · C2",
  ]);
  p = selectNode(p, first);
  p = trackChanges(p, { ...p, seed: "99" });
  const draft = activeNode(p).id;
  p = selectNode(p, first);
  expect(p.seed).toBe("42");
  p = selectNode(p, draft);
  expect(p.seed).toBe("99");
  p = commitResult(p, result(p));
  expect(activeNode(p).parent).toBe(first);
  expect(selectedResult(p)?.seed).toBe("99");
  expect(importProject(JSON.parse(JSON.stringify(p)))).toEqual(p);
});
test("advance uses selected checkpoint and strictly later time", () => {
  let p = normalizeHorizons(initial());
  p = commitResult(p, result(p));
  const first = activeNode(p).id;
  p = trackChanges(p, { ...p, snapshot: { ...p.snapshot, now: 2 } });
  p = commitResult(p, result(p));
  p = selectNode(p, first);
  expect(advance(p, 1).snapshot.now).toBe(1);
  expect(() => advance(p, 0)).toThrow();
  p = trackChanges(p, { ...p, seed: "8" });
  expect(() => advance(p, 1)).toThrow(/draft/);
});
test("legacy migration and graph validation", () => {
  const legacy = initial();
  legacy.history = [result(legacy)];
  const p = normalizeHorizons(legacy);
  expect(p.history).toEqual(legacy.history);
  expect(p.horizons!.nodes[0].result).toBe(0);
  const broken = structuredClone(p);
  broken.horizons!.nodes[0].parent = broken.horizons!.active;
  expect(() => importProject(broken)).toThrow();
});
