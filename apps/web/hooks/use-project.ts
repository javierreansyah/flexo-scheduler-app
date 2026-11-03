"use client";
import { normalizeHorizons, trackChanges } from "@/lib/horizons";
import { initial, importProject, type Project } from "@/lib/model";
import { get, set } from "idb-keyval";
import { useEffect, useRef, useState } from "react";
export function useProject() {
  const saves = useRef(Promise.resolve());
  const persisted = useRef<Project | null>(null);
  function persist(next: Project) {
    saves.current = saves.current
      .catch(() => {})
      .then(() => set("flexo-project-v1", next))
      .then(() => {
        persisted.current = next;
      });
    return saves.current;
  }
  const [project, rawUpdate] = useState<Project>(() =>
      normalizeHorizons(initial()),
    ),
    [ready, setReady] = useState(false),
    [savedProject, setSavedProject] = useState<Project | null>(null),
    [saveError, setSaveError] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    get("flexo-project-v1")
      .then((v) => {
        if (v) {
          if (
            v.version !== 1 ||
            !v.snapshot ||
            !Array.isArray(v.snapshot.jobs) ||
            !Array.isArray(v.history)
          )
            throw Error("Unsupported local workspace");
          rawUpdate(normalizeHorizons(importProject(v)));
        }
      })
      .catch((e) => setError(`Could not restore saved work: ${e}`))
      .finally(() => setReady(true));
  }, []);
  useEffect(() => {
    if (!ready) return;
    let current = true;
    setSaveError(false);
    const pending =
      persisted.current === project ? Promise.resolve() : persist(project);
    pending
      .then(() => {
        if (current) setSavedProject(project);
      })
      .catch((e) => {
        if (current) {
          setSaveError(true);
          setError(
            `Autosave unavailable: ${e}. Export your project to keep it.`,
          );
        }
      });
    return () => {
      current = false;
    };
  }, [project, ready]);

  return {
    persist,
    project,
    update: (value: React.SetStateAction<Project>) =>
      rawUpdate((previous) =>
        trackChanges(
          previous,
          typeof value === "function" ? value(previous) : value,
        ),
      ),
    ready,
    savedProject,
    saveError,
    error,
    setError,
  };
}
