import type { Project, Result } from "./model";
export type HorizonState = Pick<
  Project,
  "snapshot" | "colors" | "preset" | "custom" | "seed"
>;
export type HorizonNode = {
  id: string;
  parent: string | null;
  state: HorizonState;
  result?: number;
  unavailable?: boolean;
};
export type Horizons = { active: string; nodes: HorizonNode[] };
export function stateOf(p: Project): HorizonState {
  return structuredClone({
    snapshot: p.snapshot,
    colors: p.colors,
    preset: p.preset,
    custom: p.custom,
    seed: p.seed,
  });
}
export function normalizeHorizons(p: Project): Project {
  if (p.horizons) return p;
  const nodes: HorizonNode[] = p.history.map((r, i) => ({
    id: "legacy-" + i,
    parent: i ? "legacy-" + (i - 1) : null,
    result: i,
    unavailable: !r.inputSnapshot,
    state: {
      ...stateOf(p),
      snapshot: r.inputSnapshot ?? { ...p.snapshot, now: r.now },
      preset: "custom",
      custom: r.parameters,
      seed: r.seed,
    },
  }));
  const draft: HorizonNode = {
    id: crypto.randomUUID(),
    parent: nodes.at(-1)?.id ?? null,
    state: stateOf(p),
  };
  return { ...p, horizons: { active: draft.id, nodes: [...nodes, draft] } };
}
export function activeNode(p: Project) {
  return p.horizons!.nodes.find((n) => n.id === p.horizons!.active)!;
}
export function trackChanges(previous: Project, next: Project): Project {
  if (next.horizons !== previous.horizons) return normalizeHorizons(next);
  if (JSON.stringify(stateOf(previous)) === JSON.stringify(stateOf(next)))
    return next;
  const graph = previous.horizons!,
    node = activeNode(previous),
    state = stateOf(next);
  if (node.result === undefined)
    return {
      ...next,
      horizons: {
        ...graph,
        nodes: graph.nodes.map((n) => (n.id === node.id ? { ...n, state } : n)),
      },
    };
  const draft: HorizonNode = {
    id: crypto.randomUUID(),
    parent: node.id,
    state,
  };
  return {
    ...next,
    horizons: { active: draft.id, nodes: [...graph.nodes, draft] },
  };
}
export function selectNode(p: Project, id: string): Project {
  const node = p.horizons!.nodes.find((n) => n.id === id);
  if (!node) throw Error("Unknown checkpoint");
  return {
    ...p,
    ...structuredClone(node.state),
    horizons: { ...p.horizons!, active: id },
  };
}
export function selectedResult(p: Project): Result | undefined {
  let node: HorizonNode | undefined = activeNode(p);
  while (node) {
    if (node.result !== undefined) return p.history[node.result];
    node = p.horizons!.nodes.find((n) => n.id === node!.parent);
  }
}
export function commitResult(p: Project, result: Result): Project {
  const graph = p.horizons!,
    node = activeNode(p),
    checkpoint: HorizonNode = {
      id: node.result === undefined ? node.id : crypto.randomUUID(),
      parent: node.result === undefined ? node.parent : node.id,
      state: stateOf(p),
      result: p.history.length,
    };
  return {
    ...p,
    history: [...p.history, result],
    horizons: {
      active: checkpoint.id,
      nodes:
        node.result === undefined
          ? graph.nodes.map((n) => (n.id === node.id ? checkpoint : n))
          : [...graph.nodes, checkpoint],
    },
  };
}
export function nodeLabels(p: Project) {
  return new Map(
    p.horizons!.nodes.map((n) => [
      n.id,
      "Horizon " +
        n.state.snapshot.now +
        "h · " +
        (n.result === undefined
          ? "Draft"
          : "C" +
            (1 +
              p
                .horizons!.nodes.filter(
                  (x) =>
                    x.state.snapshot.now === n.state.snapshot.now &&
                    x.result !== undefined,
                )
                .findIndex((x) => x.id === n.id))),
    ]),
  );
}

export function branchIds(p: Project, id: string): Set<string> {
  if (!p.horizons!.nodes.some((n) => n.id === id))
    throw Error("Unknown checkpoint");
  const ids = new Set([id]);
  for (const n of p.horizons!.nodes)
    if (n.parent && ids.has(n.parent)) ids.add(n.id);
  return ids;
}
export function deleteBranch(p: Project, id: string): Project {
  const node = p.horizons!.nodes.find((n) => n.id === id);
  if (!node) throw Error("Unknown checkpoint");
  if (node.parent === null)
    throw Error("The root checkpoint cannot be deleted");
  const ids = branchIds(p, id);
  const deletedResults = new Set(
    p
      .horizons!.nodes.filter((n) => ids.has(n.id) && n.result !== undefined)
      .map((n) => n.result!),
  );
  const indices = new Map<number, number>();
  const history = p.history.filter((_, index) => {
    if (deletedResults.has(index)) return false;
    indices.set(index, indices.size);
    return true;
  });
  const nodes = p
    .horizons!.nodes.filter((n) => !ids.has(n.id))
    .map((n) =>
      n.result === undefined ? n : { ...n, result: indices.get(n.result)! },
    );
  const next = {
    ...p,
    history,
    horizons: {
      active: ids.has(p.horizons!.active) ? node.parent : p.horizons!.active,
      nodes,
    },
  };
  return selectNode(next, next.horizons.active);
}
