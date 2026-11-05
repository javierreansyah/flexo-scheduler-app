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
    changeSnapshot,
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
        <p className="border-l-2 border-warning pl-4 text-sm leading-relaxed text-warning">
          Presets were calibrated for standard ink costs.
        </p>
      )}
      <section className="flex flex-col gap-6">
        <h3 className="section-heading">Optimizer Parameters</h3>
        <div className="grid grid-cols-1 items-end gap-x-4 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
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
          {project.preset === "custom" &&
            (
              [
                "evaluations",
                "starts",
                "stage_length",
                "t_max",
                "t_min",
                "rcl_alpha",
                "p_inter",
                "p_shift",
                "p_block",
              ] as const
            ).map((key) => (
              <Field key={key}>
                {parameterLabels[key]}
                <Input
                  disabled={disabled}
                  aria-label={parameterLabels[key]}
                  type="number"
                  step="any"
                  value={project.custom[key]}
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
      </section>
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
