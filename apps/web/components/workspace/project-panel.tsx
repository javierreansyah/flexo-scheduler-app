"use client";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { activeNode, branchIds, deleteBranch } from "@/lib/horizons";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

import { HorizonGraph } from "@/components/ui/horizon-graph";

import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";

import { isIndustryInkMatrix } from "@/lib/ink-costs";

import { useWorkspace } from "./workspace-context";
const parameterLabels: Record<keyof import("@/lib/model").Parameters, string> =
  {
    evaluations: "Evaluations",
    starts: "Independent Starts",
    stage_length: "Evaluations per Temperature",
    t_max: "Starting Temperature",
    t_min: "Final Temperature",
    rcl_alpha: "Construction Randomness (RCL alpha)",
    p_inter: "Between-Machine Move Probability",
    p_shift: "Shift Move Probability",
    p_block: "Block Move Probability",
  };
export function ProjectPanel() {
  const {
    project,
    action,
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
  const [deleting, setDeleting] = useState<string | null>(null);
  const removed = deleting
    ? project.horizons!.nodes.filter((n) =>
        branchIds(project, deleting).has(n.id),
      )
    : [];
  const disabled = busy || !ready || unavailable;
  return (
    <section className="flex flex-col gap-6">
      <HorizonGraph
        project={project}
        labels={labels}
        disabled={busy || !ready}
        onSelect={selectCheckpoint}
      />

      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          {labels.get(project.horizons!.active)}
        </p>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Delete branch"
          disabled={busy || !ready || activeNode(project).parent === null}
          onClick={() => setDeleting(project.horizons!.active)}
        >
          <Trash2 />
        </Button>
      </div>
      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <DialogContent
          finalFocus={() =>
            document.querySelector<HTMLButtonElement>(
              '[aria-label="Horizon graph"] button[aria-pressed="true"]',
            )
          }
        >
          <DialogTitle>Delete Branch?</DialogTitle>
          <DialogDescription>
            {deleting ? labels.get(deleting) : ""}. This permanently deletes{" "}
            {removed.filter((n) => n.result !== undefined).length} checkpoints
            and {removed.filter((n) => n.result === undefined).length} drafts,
            including all descendants. Its parent and other branches are
            preserved.
          </DialogDescription>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Confirm delete branch"
              disabled={busy || !ready}
              onClick={() => {
                if (deleting) {
                  action(() => update((p) => deleteBranch(p, deleting)));
                  setDeleting(null);
                }
              }}
            >
              <Trash2 />
            </Button>
          </div>
        </DialogContent>
      </Dialog>

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
      <div className="flex flex-col gap-4">
        {project.preset === "custom" && (
          <fieldset className="flex flex-col gap-4">
            <legend className="mb-4 text-base font-medium">
              Optimizer Parameters
            </legend>
            <div className="grid w-full max-w-xl grid-cols-1 gap-4 sm:grid-cols-2">
              {Object.entries(project.custom).map(([key, value]) => (
                <Field key={key}>
                  {parameterLabels[key as keyof typeof parameterLabels]}
                  <Input
                    disabled={disabled}
                    aria-label={
                      parameterLabels[key as keyof typeof parameterLabels]
                    }
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
          </fieldset>
        )}
        <div className="grid w-full max-w-xl grid-cols-1 gap-4 sm:grid-cols-2">
          <Field>
            Random Seed
            <Input
              disabled={disabled}
              aria-label="Random Seed"
              inputMode="numeric"
              value={project.seed}
              onChange={(e) => update((p) => ({ ...p, seed: e.target.value }))}
            />
          </Field>
        </div>
        <div className="grid w-full max-w-xl grid-cols-1 gap-4 sm:grid-cols-2">
          <Field>
            {snapshot.transition_times ? "Cleaning Weight" : "Ink Weight"}
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
            Flow Weight
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
