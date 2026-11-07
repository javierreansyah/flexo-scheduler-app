"use client";
import { validateJobs, validateMachines } from "@/lib/validation";
import {
  activeNode,
  selectNode,
  selectedResult,
  nodeLabels,
} from "@/lib/horizons";
import { transitionTimes } from "@/lib/transition-times";

import { useOptimizer } from "@/hooks/use-optimizer";
import { useProject } from "@/hooks/use-project";
import { projectColors } from "@/lib/colors";
import { inkCostMatrix } from "@/lib/ink-costs";
import { parameters, type Job, type Project } from "@/lib/model";
import { createContext, useContext, useEffect, type ReactNode } from "react";
function useWorkspaceState() {
  const {
    persist,
    replaceProject,
    project,
    update,
    ready,
    savedProject,
    saveError,
    error,
    setError,
  } = useProject();
  const snapshot = project.snapshot,
    history = project.history;
  const physicalLocked = history.length > 0;
  const colors = projectColors(project);
  const usedColors = new Set([
    ...snapshot.jobs.flatMap((j) => j.inks),
    ...Object.values(snapshot.machine_states ?? {}).flatMap((s) => s.inks),
  ]);
  useEffect(() => {
    if (activeNode(project).unavailable) return;
    const complete = inkCostMatrix(
      ["empty", ...colors.map((c) => String(c.id))],
      snapshot.ink_costs,
    );
    const times =
      snapshot.transition_times || !physicalLocked
        ? transitionTimes(
            ["empty", ...colors.map((c) => String(c.id))],
            snapshot,
          )
        : undefined;
    if (
      JSON.stringify(complete) !== JSON.stringify(snapshot.ink_costs) ||
      JSON.stringify(times) !== JSON.stringify(snapshot.transition_times)
    )
      update((p) => ({
        ...p,
        snapshot: {
          ...p.snapshot,
          ink_costs: complete,
          ...(times ? { transition_times: times } : {}),
        },
      }));
  }, [
    snapshot.jobs,
    snapshot.machine_states,
    snapshot.ink_costs,
    snapshot.transition_times,
    physicalLocked,
  ]);

  const fixed = new Set(
    Object.values(snapshot.locked)
      .flat()
      .map((j) => String(j.id)),
  );
  const movable = snapshot.jobs.filter((j) => !fixed.has(String(j.id))).length;
  const params =
    project.preset === "custom"
      ? project.custom
      : parameters(movable, project.preset);
  const result = selectedResult(project);
  const unavailable = !!activeNode(project).unavailable;
  const labels = nodeLabels(project);
  function selectCheckpoint(id: string) {
    update((p) => selectNode(p, id));
  }

  function changeSnapshot(change: Partial<Project["snapshot"]>) {
    const next = { ...snapshot, ...change };
    validateJobs(next.jobs, colors);
    validateMachines(next.machines, next.machine_states, colors);
    update((p) => ({ ...p, snapshot: { ...p.snapshot, ...change } }));
  }
  function action(fn: () => void) {
    try {
      setError("");
      fn();
    } catch (e) {
      setError(String(e));
    }
  }
  function replace(p: Project) {
    if (
      history.length &&
      !confirm(
        "Replace this project and its history? Export your project first if you want to retain it.",
      )
    )
      return;
    replaceProject(p);
    setError("");
  }
  function appendJobs(jobs: Job[]) {
    changeSnapshot({ jobs: [...snapshot.jobs, ...jobs] });
  }

  const optimizer = useOptimizer(project, persist, params, update, setError);
  return {
    project,
    update,
    ready,
    savedProject,
    saveError,
    error,
    setError,
    unavailable,
    labels,
    selectCheckpoint,
    snapshot,
    history,
    physicalLocked,
    colors,
    fixed,
    movable,
    params,
    result,
    changeSnapshot,
    action,
    replace,
    appendJobs,
    usedColors,
    ...optimizer,
  };
}
const WorkspaceContext = createContext<ReturnType<
  typeof useWorkspaceState
> | null>(null);
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const state = useWorkspaceState();
  return (
    <WorkspaceContext.Provider value={state}>
      {children}
    </WorkspaceContext.Provider>
  );
}
export function useWorkspace() {
  const state = useContext(WorkspaceContext);
  if (!state) throw Error("WorkspaceProvider is missing");
  return state;
}
