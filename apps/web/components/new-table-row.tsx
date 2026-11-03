"use client";
import { useRef, useState } from "react";
import { TableRow, TableCell } from "./ui/table";
import { Input } from "./ui/input";
export type EntryColumn = {
  key: string;
  label: string;
  type?: "text" | "number" | "color";
  placeholder?: string;
  value?: string;
  readOnly?: boolean;
};
export function NewTableRow({
  columns,
  selection = false,
  disabled,
  onCommit,
}: {
  columns: EntryColumn[];
  selection?: boolean;
  disabled: boolean;
  onCommit: (row: Record<string, string>) => string | null;
}) {
  const [draft, setDraft] = useState<Record<string, string>>({}),
    [error, setError] = useState("");
  const ref = useRef<HTMLTableRowElement>(null);
  function commit() {
    if (disabled || !Object.values(draft).some((value) => value.trim())) return;
    const message = onCommit(draft);
    setError(message ?? "");
    if (!message) setDraft({});
  }
  return (
    <>
      <TableRow
        ref={ref}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) commit();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
            ref.current?.querySelector<HTMLInputElement>("input")?.focus();
          }
          if (event.key === "Escape") {
            setDraft({});
            setError("");
          }
        }}
      >
        {selection && <TableCell variant="selection" />}
        {columns.map((column) => (
          <TableCell key={column.key}>
            {column.readOnly ? (
              <span className="text-muted-foreground">
                {column.value ?? "—"}
              </span>
            ) : (
              <Input
                variant={column.type === "color" ? "swatch" : "cell"}
                aria-label={"New " + column.label}
                type={column.type ?? "text"}
                placeholder={column.placeholder ?? column.label}
                value={
                  draft[column.key] ??
                  (column.type === "color" ? "#808080" : "")
                }
                disabled={disabled}
                onChange={(event) => {
                  setDraft((old) => ({
                    ...old,
                    [column.key]: event.target.value,
                  }));
                  setError("");
                }}
              />
            )}
          </TableCell>
        ))}
        <TableCell variant="actions" />
      </TableRow>
      {error && (
        <TableRow>
          <TableCell colSpan={columns.length + (selection ? 2 : 1)}>
            <p role="alert" className="py-2 text-sm text-destructive">
              {error}
            </p>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}
