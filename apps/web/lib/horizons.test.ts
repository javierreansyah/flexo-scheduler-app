import { expect, test } from "vitest";
import { initial, advance, importProject } from "./model";
import {
  deleteBranch,
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
    "Horizon 0h · C1",
    "Horizon 0h · C2",
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

test("deletion removes descendants and remaps only deleted results", () => {
  let p = normalizeHorizons(initial());
  p = commitResult(p, result(p));
  const root = activeNode(p).id;
  p = commitResult(p, result(p));
  const branch = activeNode(p).id;
  p = trackChanges(p, { ...p, snapshot: { ...p.snapshot, now: 1 } });
  p = commitResult(p, result(p));
  p = trackChanges(p, { ...p, seed: "55" });
  const draft = activeNode(p).id;
  p = selectNode(p, root);
  p = commitResult(p, result(p));
  const sibling = activeNode(p).id;
  p = selectNode(p, draft);
  const before = structuredClone(p);
  const next = deleteBranch(p, branch);
  expect(next.horizons!.nodes.map((n) => n.id)).toEqual([root, sibling]);
  expect(next.history).toHaveLength(2);
  expect(next.horizons!.nodes[1].result).toBe(1);
  expect(activeNode(next).id).toBe(root);
  expect(next.seed).toBe("42");
  expect(next.snapshot.now).toBe(0);
  expect(importProject(JSON.parse(JSON.stringify(next)))).toEqual(next);
  expect(p).toEqual(before);
  expect(() => deleteBranch(next, root)).toThrow(/root/);
  expect(() => deleteBranch(next, "missing")).toThrow();
});
test("deleting a draft preserves sibling work and removes no results", () => {
  let p = normalizeHorizons(initial());
  p = commitResult(p, result(p));
  const root = activeNode(p).id;
  p = trackChanges(p, { ...p, seed: "99" });
  const draft = activeNode(p).id;
  p = selectNode(p, root);
  p = trackChanges(p, { ...p, seed: "88" });
  const sibling = activeNode(p).id;
  const next = deleteBranch(p, draft);
  expect(activeNode(next).id).toBe(sibling);
  expect(next.seed).toBe("88");
  expect(next.history).toEqual(p.history);
  expect(next.horizons!.nodes.some((n) => n.id === draft)).toBe(false);
});
