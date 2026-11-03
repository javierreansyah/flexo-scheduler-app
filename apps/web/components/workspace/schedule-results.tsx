"use client";
import { activeNode } from "@/lib/horizons";
import { scheduleCsv } from "@/lib/csv";

import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableScroll,
} from "@/components/ui/table";

import { colorNames } from "@/lib/colors";

import { Button } from "@/components/ui/button";

import { Timeline } from "../timeline";

import { download } from "@/lib/download";
import { useWorkspace } from "./workspace-context";

export function ScheduleResults() {
  const { project, update, colors, result } = useWorkspace();
  if (!result) return null;
  return (
    <>
      {activeNode(project).result === undefined && (
        <p className="border-l-2 border-warning pl-3 text-sm leading-relaxed text-warning">
          Inputs changed. The timeline shows the last successful result;
          optimize again to update it.
        </p>
      )}

      <Timeline
        key={project.horizons!.active}
        colorNames={(ids) => colorNames(ids, colors)}
        result={result}
        preferences={project.view}
        onPreferences={(view) => update((p) => ({ ...p, view }))}
      />
      <div
        data-slot="metrics"
        className="mt-6 grid grid-cols-2 gap-6 lg:grid-cols-5 [&_span]:block [&_span]:text-sm [&_span]:text-muted-foreground [&_strong]:mt-2 [&_strong]:block [&_strong]:text-lg [&_strong]:font-medium"
      >
        {[
          ["Fitness", result.fitness.toFixed(5)],
          [
            result.inputSnapshot?.transition_times
              ? "Cleaning time"
              : "Ink cost",
            result.inputSnapshot?.transition_times
              ? `${result.ink_changes.toFixed(3)}h`
              : result.ink_changes.toFixed(2),
          ],
          ["Batch flow", `${result.batch_flow_time.toFixed(3)}h`],
          ["Makespan", `${result.makespan.toFixed(3)}h`],
          ["Compute time", `${result.seconds.toFixed(3)}s`],
        ].map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <details className="mt-6 flex-col gap-4">
        <summary className="mb-4 text-sm">Schedule details & export</summary>
        <Button
          variant="outline"
          onClick={() =>
            download("schedule.csv", scheduleCsv(result, colors), "text/csv")
          }
        >
          Export schedule CSV
        </Button>
        <TableScroll>
          <Table>
            <TableHeader>
              <TableRow>
                {["Machine", "Job", "Setup", "Start", "Complete", "Locked"].map(
                  (x) => (
                    <TableHead key={x}>{x}</TableHead>
                  ),
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {Object.entries(result.schedule).flatMap(([m, jobs]) =>
                jobs.map((j) => (
                  <TableRow key={j.id}>
                    <TableCell>{m}</TableCell>
                    <TableCell>{j.id}</TableCell>
                    <TableCell>{j.setup_start?.toFixed(3)}</TableCell>
                    <TableCell>{j.start?.toFixed(3)}</TableCell>
                    <TableCell>{j.completion?.toFixed(3)}</TableCell>
                    <TableCell>{j.locked ? "Yes" : "No"}</TableCell>
                  </TableRow>
                )),
              )}
            </TableBody>
          </Table>
        </TableScroll>
      </details>
    </>
  );
}
