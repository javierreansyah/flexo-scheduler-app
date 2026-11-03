"use client";
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
    [progress, setProgress] = useState(0),
    [elapsed, setElapsed] = useState(0),
    [bestFitness, setBestFitness] = useState<number | null>(null);
  const active = useRef<ReturnType<typeof run> | null>(null);
  useEffect(() => {
    if (!busy) return;
    const start = performance.now();
    const id = setInterval(
      () => setElapsed((performance.now() - start) / 1000),
      250,
    );
    return () => clearInterval(id);
  }, [busy]);

  useEffect(() => () => active.current?.cancel(), []);
  async function optimize() {
    setError("");
    setBusy(true);
    setProgress(0);
    setElapsed(0);
    setBestFitness(null);
    try {
      if (
        !/^\d+$/.test(project.seed) ||
        BigInt(project.seed) > 18446744073709551615n
      )
        throw Error("Seed must be an unsigned 64-bit integer");
      if (!snapshot.jobs.length) throw Error("Add jobs before optimizing");
      const task = run(snapshot, params, project.seed, (value, best) => {
        setProgress(value);
        if (best !== undefined) setBestFitness(best);
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
      setError(String(e));
    } finally {
      setBusy(false);
      active.current = null;
    }
  }

  return {
    busy,
    progress,
    elapsed,
    bestFitness,
    optimize,
    cancel: () => active.current?.cancel(),
  };
}
