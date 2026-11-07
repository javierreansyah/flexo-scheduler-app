"use client";
import { useState } from "react";

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
import { Tabs, TabsList, TabsTrigger, TabsPanel } from "@/components/ui/tabs";

import { Timeline, TimelineControls } from "../timeline";

import { download } from "@/lib/download";
import { useWorkspace } from "./workspace-context";

export function ScheduleResults() {
  const { project, update, colors, result, snapshot, setError } =
    useWorkspace();
  const [tab, setTab] = useState("timeline");
  const preferences = project.view ?? { mode: "full", shift: 0, scale: 80 };
  const cleaningTime = result
    ? !!result.inputSnapshot?.transition_times
    : !!snapshot.transition_times;
  return (
    <section className="schedule-results" aria-label="Schedule results">
      <Tabs value={tab} onValueChange={(value) => setTab(String(value))}>
        <div className="flex items-center justify-between gap-x-2 border-b border-border">
          <div className="shrink-0">
            <TabsList aria-label="Schedule views" borderless>
              <TabsTrigger value="timeline">Timeline</TabsTrigger>
              <TabsTrigger value="table">Table</TabsTrigger>
            </TabsList>
          </div>
          <div
            className={
              tab === "timeline"
                ? "min-w-0 flex-1 py-2 sm:flex-none"
                : "min-w-0 py-2"
            }
          >
            {tab === "timeline" ? (
              <TimelineControls
                preferences={preferences}
                onPreferences={(view) => update((p) => ({ ...p, view }))}
                end={Math.max(
                  result?.makespan ?? 0,
                  result?.now ?? snapshot.now,
                  1,
                )}
              />
            ) : (
              <Button
                disabled={!result}
                onClick={async () => {
                  if (!result) return;
                  try {
                    const { scheduleCsv } = await import("@/lib/csv");
                    download(
                      "schedule.csv",
                      scheduleCsv(result, colors),
                      "text/csv",
                    );
                  } catch (error) {
                    setError(String(error));
                  }
                }}
              >
                Export Schedule CSV
              </Button>
            )}
          </div>
        </div>
        <TabsPanel value="timeline">
          <Timeline
            key={project.horizons!.active}
            colorNames={(ids) => colorNames(ids, colors)}
            result={result}
            snapshot={snapshot}
            preferences={preferences}
          />
        </TabsPanel>
        <TabsPanel value="table">
          <section
            className="mt-6 flex flex-col gap-4"
            aria-label="Schedule Table"
          >
            <TableScroll>
              <Table>
                <TableHeader>
                  <TableRow>
                    {[
                      "Machine",
                      "Job",
                      "Setup",
                      "Start",
                      "Complete",
                      "Locked",
                    ].map((x) => (
                      <TableHead key={x}>{x}</TableHead>
                    ))}
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
        </TabsPanel>
      </Tabs>
      <div data-slot="metrics" className="metrics">
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
          <div key={label} className="metric">
            <span className="metric-label">{label}</span>
            <strong className="metric-value">{value}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}
