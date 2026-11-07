"use client";

import { activeNode } from "@/lib/horizons";
import { canOptimize } from "@/lib/can-optimize";
import { OptimizeButton } from "@/components/ui/optimize-button";

import { Field } from "@/components/ui/field";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import type { Project } from "@/lib/model";
import { useWorkspace } from "./workspace-context";
const presets: { value: Project["preset"]; label: string }[] = [
  { value: "low", label: "Quick" },
  { value: "medium", label: "Balanced" },
  { value: "high", label: "Thorough" },
  { value: "custom", label: "Custom" },
];
export function OptimizerControls() {
  const {
    project,
    result,
    update,
    ready,
    busy,
    progress,
    params,
    unavailable,
    optimize,
    cancel,
  } = useWorkspace();
  const disabled = busy || !ready || unavailable;
  return (
    <section className="flex w-full flex-col gap-4 md:max-w-sm">
      <h3 className="section-heading">Optimizer</h3>
      <Field>
        Speed Preset
        <Select
          value={project.preset}
          disabled={disabled}
          items={presets}
          onValueChange={(preset) => {
            if (preset)
              update((p) => ({
                ...p,
                preset,
                custom: preset === "custom" ? { ...params } : p.custom,
              }));
          }}
        >
          <SelectTrigger aria-label="Speed Preset">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {presets.map(({ value, label }) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <OptimizeButton
        busy={busy}
        progress={progress}
        disabled={
          !ready || unavailable || (!busy && !canOptimize(project, params))
        }
        onClick={optimize}
        onCancel={cancel}
      />
      {result && activeNode(project).result === undefined && (
        <p className="border-l-2 border-warning pl-4 text-sm leading-relaxed text-warning">
          Inputs changed. Optimize again to update the schedule.
        </p>
      )}
    </section>
  );
}
