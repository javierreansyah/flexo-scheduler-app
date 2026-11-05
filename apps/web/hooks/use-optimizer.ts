"use client";
import { canOptimize } from "@/lib/can-optimize";
import { commitResult } from "@/lib/horizons";
import type { Project } from "@/lib/model";
import { run } from "@/lib/runner";
import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
export function useOptimizer(
  project: Project,
  persist: (next: Project) => Promise<void>,
  params: Project["custom"],
  update: Dispatch<SetStateAction<Project>>,
  setError: Dispatch<SetStateAction<string>>,
) {
  const snapshot = project.snapshot;
  const [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0);
  const active = useRef<ReturnType<typeof run> | null>(null);
  const cancelled = useRef(false);

  useEffect(() => () => active.current?.cancel(), []);
  async function optimize() {
    if (busy || !canOptimize(project, params)) return;
    cancelled.current = false;
    setError("");
    setBusy(true);
    setProgress(0);
    try {
      const task = run(snapshot, params, project.seed, (value) => {
        setProgress(value);
      });
      active.current = task;
      const output = await task.promise;
      const next = commitResult(project, output);
      try {
        await persist(next);
      } catch (error) {
        setError(
          `Result is ready, but autosave failed: ${error}. Export your project.`,
        );
      }
      update(next);
    } catch (e) {
      if (!cancelled.current) setError(String(e));
    } finally {
      setBusy(false);
      active.current = null;
    }
  }

  return {
    busy,
    progress,
    optimize,
    cancel: () => {
      cancelled.current = true;
      active.current?.cancel();
    },
  };
}
