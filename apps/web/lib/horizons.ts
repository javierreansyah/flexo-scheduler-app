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
  const times = [
    ...new Set(p.horizons!.nodes.map((n) => n.state.snapshot.now)),
  ].sort((a, b) => a - b);
  return new Map(
    p.horizons!.nodes.map((n) => [
      n.id,
      "Horizon " +
        (times.indexOf(n.state.snapshot.now) + 1) +
        " · " +
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
