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
  const { project, update, colors, result, snapshot } = useWorkspace();
  const cleaningTime = result
    ? !!result.inputSnapshot?.transition_times
    : !!snapshot.transition_times;
  return (
    <>
      {result && activeNode(project).result === undefined && (
        <p className="border-l-2 border-warning pl-3 text-sm leading-relaxed text-warning">
          Inputs changed. The timeline shows the last successful result;
          optimize again to update it.
        </p>
      )}

      <Timeline
        key={project.horizons!.active}
        colorNames={(ids) => colorNames(ids, colors)}
        result={result}
        snapshot={snapshot}
        preferences={project.view}
        onPreferences={(view) => update((p) => ({ ...p, view }))}
      />
      <div
        data-slot="metrics"
        className="mt-6 grid grid-cols-2 gap-6 lg:grid-cols-5 [&_span]:block [&_span]:text-sm [&_span]:text-muted-foreground [&_strong]:mt-2 [&_strong]:block [&_strong]:text-lg [&_strong]:font-medium"
      >
        {[
          ["Fitness", (result?.fitness ?? 0).toFixed(2)],
          [
            cleaningTime ? "Cleaning Time" : "Ink Cost",
            cleaningTime
              ? `${(result?.ink_changes ?? 0).toFixed(2)}h`
              : (result?.ink_changes ?? 0).toFixed(2),
          ],
          ["Batch Flow", `${(result?.batch_flow_time ?? 0).toFixed(2)}h`],
          ["Makespan", `${(result?.makespan ?? 0).toFixed(2)}h`],
          ["Compute Time", `${(result?.seconds ?? 0).toFixed(2)}s`],
        ].map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <section
        className="mt-6 flex flex-col gap-4"
        aria-label="Schedule Details"
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h3>Schedule Details</h3>
          <Button
            disabled={!result}
            onClick={() =>
              result &&
              download("schedule.csv", scheduleCsv(result, colors), "text/csv")
            }
          >
            Export Schedule CSV
          </Button>
        </div>
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
              {!result && (
                <TableRow>
                  <TableCell colSpan={6}>
                    <span className="text-muted-foreground">
                      No jobs scheduled yet.
                    </span>
                  </TableCell>
                </TableRow>
              )}
              {Object.entries(result?.schedule ?? {}).flatMap(([m, jobs]) =>
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
      </section>
    </>
  );
}
