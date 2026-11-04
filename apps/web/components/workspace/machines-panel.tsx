"use client";
import { TableFooter } from "@/components/ui/table";

import { colorNames, parseColors } from "@/lib/colors";
import { AddEntryDialog } from "../add-entry-dialog";
import { DataGrid } from "../data-grid";

import { CsvActions } from "./csv-actions";
import { useWorkspace } from "./workspace-context";
const machineColumns = [
  { key: "name", label: "Machine" },
  { key: "rate", label: "Pieces / min" },
  { key: "available", label: "Available (h)" },
  { key: "inks", label: "Initial Inks" },
];

export function MachinesPanel() {
  const {
    ready,
    busy,
    snapshot,
    physicalLocked,
    colors,
    changeSnapshot,
    action,
  } = useWorkspace();
  const rows = Object.entries(snapshot.machines).map(([name, rate]) => ({
    name,
    rate: String(rate),
    available: String(snapshot.machine_states?.[name]?.available_time ?? 0),
    inks: colorNames(snapshot.machine_states?.[name]?.inks ?? [], colors),
  }));
  function commitCells(
    cells: { i: number; key: string; value: string }[],
    append: Record<string, string>[] = [],
  ) {
    const next = rows.map((row) => ({ ...row }));
    for (const { i, key, value } of cells) {
      if (
        key === "name" ||
        key === "rate" ||
        key === "available" ||
        key === "inks"
      )
        next[i][key] = value;
    }
    for (const row of append)
      next.push({
        name: row.name || "Machine " + (next.length + 1),
        rate: row.rate ?? "150",
        available: row.available ?? "0",
        inks: row.inks ?? "",
      });
    if (new Set(next.map((row) => row.name)).size !== next.length)
      throw Error("Machine names must be unique");
    changeSnapshot({
      machines: Object.fromEntries(
        next.map((row) => [row.name, Number(row.rate)]),
      ),
      machine_states: Object.fromEntries(
        next.map((row) => [
          row.name,
          {
            available_time: Number(row.available),
            inks: parseColors(row.inks, colors),
          },
        ]),
      ),
    });
  }
  function removeMachines(indices: number[]) {
    const machines = Object.fromEntries(
      Object.entries(snapshot.machines).filter((_, i) => !indices.includes(i)),
    );
    changeSnapshot({
      machines,
      machine_states: Object.fromEntries(
        Object.entries(snapshot.machine_states ?? {}).filter(
          ([name]) => name in machines,
        ),
      ),
    });
  }
  function addMachine(row: Record<string, string>) {
    const name = row.name?.trim(),
      rate = Number(row.rate),
      available = Number(row.available ?? 0),
      inks = parseColors(row.inks ?? "", colors);
    if (!name || !Number.isFinite(rate) || rate <= 0)
      return "Enter a machine name and a positive rate.";
    if (name in snapshot.machines) return "Machine names must be unique.";
    if (!Number.isFinite(available) || available < 0)
      return "Availability must be a nonnegative number.";
    if (
      inks.some(
        (ink) =>
          !Number.isInteger(ink) || !colors.some((color) => color.id === ink),
      )
    )
      return "Choose inks from the color catalog.";
    changeSnapshot({
      machines: { ...snapshot.machines, [name]: rate },
      machine_states: {
        ...snapshot.machine_states,
        [name]: { available_time: available, inks },
      },
    });
    return null;
  }
  return (
    <>
      <DataGrid
        toolbarActions={
          <>
            <AddEntryDialog
              title="Add Machine"
              columns={[
                { key: "name", label: "Machine" },
                { key: "rate", label: "Pieces / min", type: "number" },
                { key: "available", label: "Available (h)", type: "number" },
                {
                  key: "inks",
                  label: "Initial Inks",
                  options: colors.map((color) => color.name),
                },
              ]}
              defaults={{
                name: `Machine ${Object.keys(snapshot.machines).length + 1}`,
                rate: "150",
                available: "0",
                inks: "",
              }}
              disabled={busy || !ready || physicalLocked}
              onCommit={addMachine}
            />
            <CsvActions kind="machines" />
          </>
        }
        rows={rows}
        columns={machineColumns}
        onAppend={addMachine}
        onDeleteMany={removeMachines}
        onPasteCells={(cells, append) =>
          action(() => commitCells(cells, append))
        }
        disabled={busy || !ready || physicalLocked}
        onDelete={(i) => removeMachines([i])}
        onChange={(i, key, value) =>
          action(() => commitCells([{ i, key, value }]))
        }
      />
      {physicalLocked && (
        <TableFooter>
          Equipment locked. Create a new project to edit.
        </TableFooter>
      )}
    </>
  );
}
