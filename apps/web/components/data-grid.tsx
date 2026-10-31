"use client";
import { useMemo, useRef, useState, useEffect } from "react";
import {
  useTable,
  tableFeatures,
  createColumnHelper,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
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
    <input
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
}: {
  rows: Record<string, string>[];
  columns: { key: string; label: string }[];
  onChange: (i: number, key: string, value: string) => void;
  onDelete: (i: number) => void;
  disabled?: boolean;
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
    estimateSize: () => 45,
    overscan: 8,
  });
  const model = table.getRowModel().rows;
  return (
    <>
      <div className="table-toolbar">
        <input
          aria-label="Search table"
          placeholder="Filter rows..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {selected.size > 0 && (
          <button
            disabled={disabled}
            onClick={() => {
              onDeleteMany?.([...selected]);
              setSelected(new Set());
            }}
          >
            Delete {selected.size} selected
          </button>
        )}
        <span>{data.length} rows · Tab to edit · paste spreadsheet cells</span>
      </div>
      <div ref={ref} className="grid-scroll">
        <table>
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  aria-label="Select visible rows"
                  disabled={disabled}
                  checked={
                    data.length > 0 &&
                    data.every(
                      (r) =>
                        selected.has(Number(r._index)) || r.status === "Locked",
                    )
                  }
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? new Set(
                            data
                              .filter((r) => r.status !== "Locked")
                              .map((r) => Number(r._index)),
                          )
                        : new Set(),
                    )
                  }
                />
              </th>
              {columns.map((c) => (
                <th key={c.key}>
                  <button
                    onClick={() => {
                      setSort(c.key);
                      setDescending(sort === c.key ? !descending : false);
                    }}
                  >
                    {c.label} {sort === c.key ? (descending ? "v" : "^") : ""}
                  </button>
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            <tr style={{ height: virtual.getVirtualItems()[0]?.start ?? 0 }} />
            <>
              {virtual.getVirtualItems().map((item) => {
                const row = model[item.index];
                const original = row.original;
                const i = Number(original._index);
                const locked = original.status === "Locked";
                return (
                  <tr key={row.id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Select row ${i + 1}`}
                        disabled={disabled || locked}
                        checked={selected.has(i)}
                        onChange={(e) =>
                          setSelected((old) => {
                            const next = new Set(old);
                            e.target.checked ? next.add(i) : next.delete(i);
                            return next;
                          })
                        }
                      />
                    </td>
                    {columns.map((c, col) => (
                      <td key={c.key}>
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
                              cells.forEach((c) =>
                                onChange(c.i, c.key, c.value),
                              );
                          }}
                        />
                      </td>
                    ))}
                    <td>
                      <button
                        aria-label={`Delete row ${i + 1}`}
                        disabled={disabled || locked}
                        onClick={() => onDelete(i)}
                      >
                        &times;
                      </button>
                    </td>
                  </tr>
                );
              })}
            </>
            <tr
              style={{
                height: Math.max(
                  0,
                  virtual.getTotalSize() -
                    (virtual.getVirtualItems().at(-1)?.end ?? 0),
                ),
              }}
            />
          </tbody>
        </table>
      </div>
    </>
  );
}
