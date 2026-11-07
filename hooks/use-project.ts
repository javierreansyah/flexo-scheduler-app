"use client";
import { normalizeHorizons, trackChanges } from "@/lib/horizons";
import { initial, importProject, type Project } from "@/lib/model";
import { get, set } from "idb-keyval";
import { useEffect, useRef, useState } from "react";
export function useProject() {
  const restoreFailed = useRef(false);
  const saves = useRef(Promise.resolve());
  const persisted = useRef<Project | null>(null);
  function persist(next: Project) {
    if (restoreFailed.current)
      return Promise.reject(
        Error(
          "Saved workspace could not be restored. Import a backup or create a new project to replace it.",
        ),
      );
    try {
      importProject(next);
    } catch (error) {
      return Promise.reject(error);
    }
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
      .catch((e) => {
        restoreFailed.current = true;
        setSaveError(true);
        setError(
          `Could not restore saved work: ${e}. The saved copy has been preserved.`,
        );
      })
      .finally(() => setReady(true));
  }, []);
  useEffect(() => {
    if (!ready || restoreFailed.current) return;
    let current = true;
    setSaveError(false);
    const pending =
      persisted.current === project ? Promise.resolve() : persist(project);
    pending
      .then(() => {
        if (current) {
          setSavedProject(project);
          setError((previous) =>
            previous.startsWith("Autosave unavailable:") ? "" : previous,
          );
        }
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
    replaceProject: (next: Project) => {
      restoreFailed.current = false;
      rawUpdate(normalizeHorizons(next));
    },
    project,
    update: (value: React.SetStateAction<Project>) => {
      rawUpdate((previous) =>
        trackChanges(
          previous,
          typeof value === "function" ? value(previous) : value,
        ),
      );
    },
    ready,
    savedProject,
    saveError,
    error,
    setError,
  };
}
