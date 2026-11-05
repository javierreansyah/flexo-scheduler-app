"use client";
import { useRef, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";
import { Field } from "./ui/field";
import { Input } from "./ui/input";
import { InkCombobox } from "./ui/ink-combobox";
import type { EntryColumn } from "./new-table-row";

export function AddEntryDialog({
  title,
  columns,
  disabled,
  onCommit,
}: {
  title: string;
  columns: EntryColumn[];
  disabled: boolean;
  onCommit: (values: Record<string, string>) => string | null;
}) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button
        ref={trigger}
        variant="outline"
        disabled={disabled}
        onClick={() => {
          setValues({});
          setError("");
          setOpen(true);
        }}
      >
        <Plus size={14} />
        {title}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent finalFocus={trigger}>
          <DialogTitle>{title}</DialogTitle>
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (disabled) return;
              const message = onCommit(values);
              setError(message ?? "");
              if (!message) setOpen(false);
            }}
          >
            {columns.map((column) => (
              <Field key={column.key} compact={column.type === "color"}>
                {column.label}
                {column.options ? (
                  <InkCombobox
                    label={column.label}
                    variant="default"
                    options={column.options}
                    value={values[column.key] ?? ""}
                    disabled={disabled}
                    onChange={(value) =>
                      setValues((old) => ({ ...old, [column.key]: value }))
                    }
                  />
                ) : (
                  <Input
                    aria-label={column.label}
                    type={column.type ?? "text"}
                    step={column.type === "number" ? "any" : undefined}
                    variant={column.type === "color" ? "swatch" : "default"}
                    placeholder={column.placeholder ?? column.label}
                    value={
                      values[column.key] ??
                      (column.type === "color" ? "#808080" : "")
                    }
                    disabled={disabled}
                    onChange={(event) =>
                      setValues((old) => ({
                        ...old,
                        [column.key]: event.target.value,
                      }))
                    }
                  />
                )}
              </Field>
            ))}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={disabled}>
                {title}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
