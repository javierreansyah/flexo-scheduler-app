"use client";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableScroll,
  TableToolbar,
  TableFilter,
} from "@/components/ui/table";

import {
  createColumnHelper,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { NewTableRow, type EntryColumn } from "./new-table-row";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Input } from "./ui/input";
import { InkCombobox } from "./ui/ink-combobox";
function GridInput({
  value,
  onCommit,
  ...props
}: Omit<React.ComponentProps<"input">, "value" | "onChange"> & {
  value: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <Input
      variant="cell"
      {...props}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== value) onCommit(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setDraft(value);
          e.preventDefault();
        }
      }}
    />
  );
}
const features = tableFeatures({});
export function DataGrid({
  rows,
  columns,
  onChange,
  onDelete,
  onPasteCells,
  onDeleteMany,
  disabled = false,
  toolbarActions,
  onAppend,
}: {
  rows: Record<string, string>[];
  columns: EntryColumn[];
  onAppend?: (row: Record<string, string>) => string | null;
  onChange: (i: number, key: string, value: string) => void;
  onDelete: (i: number) => void;
  disabled?: boolean;
  toolbarActions?: React.ReactNode;
  onDeleteMany?: (indices: number[]) => void;
  onPasteCells?: (
    cells: { i: number; key: string; value: string }[],
    append: Record<string, string>[],
  ) => void;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("");
  const [descending, setDescending] = useState(false);
  const data = useMemo(
    () =>
      rows
        .map((r, i): Record<string, string> => ({ ...r, _index: String(i) }))
        .filter((r) =>
          Object.values(r).some((v) =>
            v.toLowerCase().includes(query.toLowerCase()),
          ),
        )
        .sort((a, b) =>
          sort
            ? (descending ? -1 : 1) *
              ((a as Record<string, string>)[sort] ?? "").localeCompare(
                (b as Record<string, string>)[sort] ?? "",
                undefined,
                { numeric: true },
              )
            : 0,
        ),
    [rows, query, sort, descending],
  );
  const helper = createColumnHelper<typeof features, Record<string, string>>();
  const defs = useMemo(
    () =>
      helper.columns(
        columns.map((c) => helper.accessor(c.key, { header: c.label })),
      ),
    [columns],
  );
  const table = useTable({ features, columns: defs, data });
  const ref = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({
    count: data.length,
    getScrollElement: () => ref.current,
    estimateSize: () => 44,
    overscan: 8,
  });
  const model = table.getRowModel().rows;
  return (
    <>
      <TableToolbar>
        <TableFilter
          query={query}
          onQueryChange={setQuery}
          count={data.length}
        />
        <div className="ml-auto flex flex-wrap items-center gap-2 max-sm:w-full max-sm:justify-between">
          {toolbarActions}
        </div>
        {selected.size > 0 && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Delete ${selected.size} selected`}
            title={`Delete ${selected.size} selected`}
            disabled={disabled}
            onClick={() => {
              onDeleteMany?.([...selected]);
              setSelected(new Set());
            }}
          >
            <Trash2 />
          </Button>
        )}
      </TableToolbar>
      <TableScroll ref={ref}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead variant="selection">
                <Checkbox
                  aria-label="Select visible rows"
                  disabled={disabled}
                  checked={
                    data.length > 0 &&
                    data.every(
                      (r) =>
                        selected.has(Number(r._index)) || r.status === "Locked",
                    )
                  }
                  onCheckedChange={(checked) =>
                    setSelected(
                      checked
                        ? new Set(
                            data
                              .filter((r) => r.status !== "Locked")
                              .map((r) => Number(r._index)),
                          )
                        : new Set(),
                    )
                  }
                />
              </TableHead>
              {columns.map((c) => (
                <TableHead key={c.key}>
                  <Button
                    variant="ghost"
                    size="header"
                    onClick={() => {
                      setSort(c.key);
                      setDescending(sort === c.key ? !descending : false);
                    }}
                  >
                    {c.label}{" "}
                    {sort === c.key &&
                      (descending ? <ArrowDown /> : <ArrowUp />)}
                  </Button>
                </TableHead>
              ))}
              <TableHead variant="actions" />
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow
              variant="spacer"
              style={
                {
                  "--spacer-height": `${virtual.getVirtualItems()[0]?.start ?? 0}px`,
                } as React.CSSProperties
              }
            />
            <>
              {virtual.getVirtualItems().map((item) => {
                const row = model[item.index];
                const original = row.original;
                const i = Number(original._index);
                const locked = original.status === "Locked";
                return (
                  <TableRow key={row.id}>
                    <TableCell variant="selection">
                      <Checkbox
                        aria-label={`Select row ${i + 1}`}
                        disabled={disabled || locked}
                        checked={selected.has(i)}
                        onCheckedChange={(checked) =>
                          setSelected((old) => {
                            const next = new Set(old);
                            if (checked) next.add(i);
                            else next.delete(i);
                            return next;
                          })
                        }
                      />
                    </TableCell>
                    {columns.map((c, col) => (
                      <TableCell
                        key={c.key}
                        onPaste={(e) => {
                          const text = e.clipboardData.getData("text");
                          if (!text.includes("\t") && !text.includes("\n"))
                            return;
                          e.preventDefault();
                          const cells: {
                              i: number;
                              key: string;
                              value: string;
                            }[] = [],
                            append: Record<string, string>[] = [];
                          text
                            .trimEnd()
                            .split(/\r?\n/)
                            .forEach((line, ri) => {
                              const target = data[item.index + ri];
                              const values: Record<string, string> = {};
                              line.split("\t").forEach((value, ci) => {
                                const column = columns[col + ci];
                                if (
                                  column &&
                                  !["status", "arrival"].includes(column.key)
                                ) {
                                  if (target) {
                                    const index = Number(target._index);
                                    if (rows[index].status !== "Locked")
                                      cells.push({
                                        i: index,
                                        key: column.key,
                                        value,
                                      });
                                  } else values[column.key] = value;
                                }
                              });
                              if (!target) append.push(values);
                            });
                          if (onPasteCells) onPasteCells(cells, append);
                          else
                            cells.forEach((c) => onChange(c.i, c.key, c.value));
                        }}
                      >
                        {c.options ? (
                          <InkCombobox
                            label={`${c.label} row ${i + 1}`}
                            options={c.options}
                            value={original[c.key] ?? ""}
                            disabled={disabled || locked}
                            onChange={(value) => onChange(i, c.key, value)}
                          />
                        ) : (
                          <GridInput
                            aria-label={`${c.label} row ${i + 1}`}
                            disabled={
                              disabled ||
                              locked ||
                              c.key === "status" ||
                              c.key === "arrival"
                            }
                            value={original[c.key] ?? ""}
                            onCommit={(value) => onChange(i, c.key, value)}
                          />
                        )}
                      </TableCell>
                    ))}
                    <TableCell variant="actions">
                      <Button
                        variant="ghost"
                        size="icon"
                        title={`Delete row ${i + 1}`}
                        aria-label={`Delete row ${i + 1}`}
                        disabled={disabled || locked}
                        onClick={() => onDelete(i)}
                      >
                        <Trash2 />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </>
            <TableRow
              variant="spacer"
              style={
                {
                  "--spacer-height":
                    Math.max(
                      0,
                      virtual.getTotalSize() -
                        (virtual.getVirtualItems().at(-1)?.end ?? 0),
                    ) + "px",
                } as React.CSSProperties
              }
            />
            {onAppend && (
              <NewTableRow
                columns={columns}
                selection
                disabled={disabled}
                onCommit={onAppend}
              />
            )}
          </TableBody>
        </Table>
      </TableScroll>
    </>
  );
}
