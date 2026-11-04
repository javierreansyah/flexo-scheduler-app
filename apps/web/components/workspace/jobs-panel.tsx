"use client";
import { editJob } from "@/lib/job-edits";
import { TableFooter } from "@/components/ui/table";

import { colorNames, parseColors } from "@/lib/colors";
import { AddEntryDialog } from "../add-entry-dialog";
import { DataGrid } from "../data-grid";

import { CsvActions } from "./csv-actions";
import { useWorkspace } from "./workspace-context";
const jobColumns = [
  { key: "id", label: "Job ID" },
  { key: "quantity", label: "Quantity" },
  { key: "inks", label: "Inks" },
  { key: "arrival", label: "Arrival (h)", readOnly: true },
  { key: "status", label: "Status", readOnly: true },
];

export function JobsPanel() {
  const {
    update,
    ready,
    busy,
    snapshot,
    colors,
    fixed,
    movable,
    changeSnapshot,
    action,
    appendJobs,
  } = useWorkspace();
  function addJob(row: Record<string, string>) {
    const id = row.id?.trim(),
      quantity = Number(row.quantity),
      inks = parseColors(row.inks ?? "", colors);
    if (!id || !Number.isInteger(quantity) || quantity < 1)
      return "Enter a job ID and a positive whole quantity.";
    if (snapshot.jobs.some((job) => job.id === id))
      return "Job IDs must be unique.";
    if (
      inks.some(
        (ink) =>
          !Number.isInteger(ink) || !colors.some((color) => color.id === ink),
      )
    )
      return "Choose inks from the color catalog.";
    appendJobs([{ id, quantity, inks, arrival_time: snapshot.now }]);
    return null;
  }
  return (
    <>
      <DataGrid
        toolbarActions={
          <>
            {" "}
            <AddEntryDialog
              title="Add Job"
              columns={[
                { key: "id", label: "Job ID" },
                { key: "quantity", label: "Quantity", type: "number" },
                {
                  key: "inks",
                  label: "Inks",
                  options: colors.map((color) => color.name),
                },
              ]}
              defaults={{ id: `J-${Date.now()}`, quantity: "10000", inks: "" }}
              disabled={busy || !ready}
              onCommit={addJob}
            />
            <CsvActions kind="jobs" />{" "}
          </>
        }
        rows={snapshot.jobs.map((j) => ({
          id: j.id,
          quantity: String(j.quantity),
          inks: colorNames(j.inks, colors),
          arrival: String(j.arrival_time),
          status: fixed.has(String(j.id)) ? "Locked" : "Movable",
        }))}
        columns={jobColumns.map((column) =>
          column.key === "inks"
            ? { ...column, options: colors.map((color) => color.name) }
            : column,
        )}
        onAppend={addJob}
        onDeleteMany={(indices) =>
          changeSnapshot({
            jobs: snapshot.jobs.filter((_, i) => !indices.includes(i)),
          })
        }
        onPasteCells={(cells, append) =>
          action(() => {
            const jobs = structuredClone(snapshot.jobs);
            for (const c of cells) {
              jobs[c.i] = editJob(jobs[c.i], c.key, c.value, colors);
            }
            for (const r of append)
              jobs.push({
                id: r.id || `J-${Date.now()}-${jobs.length}`,
                quantity: Number(r.quantity ?? 10000),
                inks: parseColors(r.inks ?? "", colors),
                arrival_time: snapshot.now,
              });
            changeSnapshot({ jobs });
          })
        }
        disabled={busy || !ready}
        onDelete={(i) =>
          changeSnapshot({
            jobs: snapshot.jobs.filter((_, x) => x !== i),
          })
        }
        onChange={(i, key, value) =>
          update((p) => ({
            ...p,
            snapshot: {
              ...p.snapshot,
              jobs: p.snapshot.jobs.map((j, k) =>
                k !== i ? j : editJob(j, key, value, colors),
              ),
            },
          }))
        }
      />
      <TableFooter>
        {movable} movable · {fixed.size} locked · current time {snapshot.now}h
      </TableFooter>
    </>
  );
}
