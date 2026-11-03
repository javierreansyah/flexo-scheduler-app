"use client";

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
    update,
    ready,
    busy,
    params,
    unavailable,
    optimize,
    cancel,
  } = useWorkspace();
  const disabled = busy || !ready;
  return (
    <section className="flex flex-col gap-4">
      <h3 className="text-base font-medium">Optimizer</h3>
      <Field>
        Speed preset
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
          <SelectTrigger aria-label="Speed preset">
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
        disabled={!ready || unavailable}
        onClick={optimize}
        onCancel={cancel}
      />
    </section>
  );
}
