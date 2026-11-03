"use client";
import { useState, type RefObject } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { randomJobs, random } from "@/lib/model";
import { useWorkspace } from "./workspace-context";
export function GenerationDialog({
  kind,
  open,
  onOpenChange,
  trigger,
}: {
  kind: "jobs" | "machines";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: RefObject<HTMLElement | null>;
}) {
  const [count, setCount] = useState(kind === "jobs" ? 30 : 3),
    [error, setError] = useState("");
  const {
    project,
    snapshot,
    history,
    colors,
    appendJobs,
    changeSnapshot,
    busy,
    ready,
    physicalLocked,
  } = useWorkspace();
  const disabled = busy || !ready || (kind === "machines" && physicalLocked);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent finalFocus={trigger}>
        <DialogTitle>Generate {kind}</DialogTitle>
        <DialogDescription>
          {kind === "jobs"
            ? "Append generated jobs to this batch."
            : "Replace the machine list and reset initial machine states."}
        </DialogDescription>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (disabled) return;
            try {
              if (kind === "jobs")
                appendJobs(
                  randomJobs(
                    count,
                    Number(project.seed),
                    snapshot.now,
                    "B" + history.length + "-" + snapshot.jobs.length + "-",
                    colors,
                  ),
                );
              else {
                if (!Number.isInteger(count) || count < 1 || count > 100)
                  throw Error("Generate 1–100 machines");
                const rng = random(Number(project.seed));
                changeSnapshot({
                  machines: Object.fromEntries(
                    Array.from({ length: count }, (_, i) => [
                      "Machine " + (i + 1),
                      Math.round(
                        [112, 224, 175][Math.floor(rng() * 3)] *
                          (0.85 + 0.3 * rng()) *
                          100,
                      ) / 100,
                    ]),
                  ),
                  machine_states: {},
                });
              }
              setError("");
              onOpenChange(false);
            } catch (error) {
              setError(String(error));
            }
          }}
        >
          <Field>
            Count
            <Input
              aria-label={
                kind === "jobs" ? "Jobs to generate" : "Machines to generate"
              }
              type="number"
              required
              min={1}
              max={kind === "jobs" ? 10000 : 100}
              value={count}
              onChange={(e) => setCount(+e.target.value)}
              disabled={disabled}
            />
          </Field>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={disabled}>
              Generate {kind}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
