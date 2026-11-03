"use client";

import { HorizonGraph } from "@/components/ui/horizon-graph";

import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";

import { isIndustryInkMatrix } from "@/lib/ink-costs";

import { useWorkspace } from "./workspace-context";
export function ProjectPanel() {
  const {
    project,
    update,
    ready,
    busy,
    snapshot,
    movable,
    changeSnapshot,
    progress,
    elapsed,
    bestFitness,
    saveError,
    savedProject,
    selectCheckpoint,
    labels,
    unavailable,
  } = useWorkspace();
  const disabled = busy || !ready || unavailable;
  return (
    <section className="flex flex-col gap-6">
      <HorizonGraph
        project={project}
        labels={labels}
        disabled={busy || !ready}
        onSelect={selectCheckpoint}
      />{" "}
      {!isIndustryInkMatrix(snapshot.ink_costs) && (
        <p className="border-l-2 border-warning pl-3 text-sm leading-relaxed text-warning">
          Custom ink costs: preset quality was calibrated using the industry
          matrix.
        </p>
      )}
      {movable > 100 && (
        <p className="border-l-2 border-warning pl-3 text-sm leading-relaxed text-warning">
          Above the calibrated range of 100 movable jobs. Browser runtime and
          preset quality are unvalidated.
        </p>
      )}
      {project.preset === "custom" && (
        <div className="grid grid-cols-2 gap-4">
          {Object.entries(project.custom).map(([key, value]) => (
            <Field key={key}>
              {key}
              <Input
                disabled={disabled}
                aria-label={key}
                type="number"
                step="any"
                value={value}
                onChange={(e) =>
                  update((p) => ({
                    ...p,
                    custom: { ...p.custom, [key]: +e.target.value },
                  }))
                }
              />
            </Field>
          ))}
        </div>
      )}
      <Field>
        Random seed
        <Input
          disabled={disabled}
          aria-label="Random seed"
          inputMode="numeric"
          value={project.seed}
          onChange={(e) => update((p) => ({ ...p, seed: e.target.value }))}
        />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field>
          {snapshot.transition_times ? "Cleaning weight" : "Ink weight"}
          <Input
            disabled={disabled}
            type="number"
            min={0}
            step="any"
            value={snapshot.ink_weight}
            onChange={(e) => changeSnapshot({ ink_weight: +e.target.value })}
          />
        </Field>
        <Field>
          Flow weight
          <Input
            disabled={disabled}
            type="number"
            min={0}
            step="any"
            value={snapshot.batch_flow_time_weight}
            onChange={(e) =>
              changeSnapshot({ batch_flow_time_weight: +e.target.value })
            }
          />
        </Field>
      </div>
      {busy && (
        <>
          <div
            role="progressbar"
            aria-label="Optimization progress"
            aria-valuenow={Math.round(progress * 100)}
            className="run-progress"
          >
            <i
              style={
                { "--progress": progress * 100 + "%" } as React.CSSProperties
              }
            />
          </div>
          <p role="status" className="text-sm text-muted-foreground">
            {Math.round(progress * 100)}% · {elapsed.toFixed(1)}s
            {bestFitness !== null ? " · Best " + bestFitness.toFixed(5) : ""}
          </p>
        </>
      )}
      <p className="text-xs text-muted-foreground" role="status">
        {saveError
          ? "Autosave unavailable"
          : savedProject === project
            ? "Saved locally"
            : "Saving..."}
      </p>
    </section>
  );
}
