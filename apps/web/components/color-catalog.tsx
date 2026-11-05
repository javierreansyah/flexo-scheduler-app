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

import { useState } from "react";
import { NewTableRow } from "./new-table-row";
import { AddEntryDialog } from "./add-entry-dialog";
import { Trash2 } from "lucide-react";
import type { InkColor } from "@/lib/colors";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
export function ColorCatalog({
  colors,
  used,
  disabled,
  onChange,
}: {
  colors: InkColor[];
  used: Set<number>;
  disabled: boolean;
  onChange: (colors: InkColor[]) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = colors.filter((c) =>
    [c.name, c.hex].some((value) =>
      value.toLowerCase().includes(query.toLowerCase()),
    ),
  );
  function addColor(row: Record<string, string>) {
    const name = row.name?.trim(),
      hex = row.hex ?? "#808080";
    if (!name || name.includes(","))
      return "Enter a color name without commas.";
    if (colors.some((color) => color.name.toLowerCase() === name.toLowerCase()))
      return "Color names must be unique.";
    onChange([
      ...colors,
      {
        id: Math.max(0, ...colors.map((color) => color.id)) + 1,
        name,
        hex,
      },
    ]);
    return null;
  }
  return (
    <section>
      <TableToolbar>
        <TableFilter
          label="Search Colors"
          query={query}
          onQueryChange={setQuery}
          count={filtered.length}
        />
        <div className="ml-auto">
          <AddEntryDialog
            title="Add Color"
            columns={[
              { key: "name", label: "Color Name" },
              { key: "hex", label: "Color Swatch", type: "color" },
            ]}
            disabled={disabled}
            onCommit={addColor}
          />
        </div>
      </TableToolbar>
      <TableScroll>
        <Table variant="colors" aria-label="Colors">
          <TableHeader>
            <TableRow>
              <TableHead variant="swatch" scope="col">
                Swatch
              </TableHead>
              <TableHead scope="col">Color Name</TableHead>
              <TableHead variant="actions" aria-label="Actions" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((c) => (
              <TableRow key={c.id}>
                <TableCell>
                  <Input
                    variant="swatch"
                    type="color"
                    aria-label={`Swatch ${c.name}`}
                    value={c.hex}
                    disabled={disabled}
                    onChange={(e) =>
                      onChange(
                        colors.map((x) =>
                          x.id === c.id ? { ...x, hex: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </TableCell>
                <TableCell>
                  <Input
                    key={`${c.id}:${c.name}`}
                    variant="cell"
                    aria-label={`Color Name ${c.id}`}
                    defaultValue={c.name}
                    disabled={disabled}
                    onBlur={(e) => {
                      const name = e.target.value.trim();
                      if (
                        !name ||
                        name.includes(",") ||
                        colors.some(
                          (x) =>
                            x.id !== c.id &&
                            x.name.toLowerCase() === name.toLowerCase(),
                        )
                      ) {
                        e.target.value = c.name;
                        return;
                      }
                      onChange(
                        colors.map((x) => (x.id === c.id ? { ...x, name } : x)),
                      );
                    }}
                  />
                </TableCell>
                <TableCell variant="actions">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete ${c.name}`}
                    disabled={disabled || used.has(c.id)}
                    title={
                      used.has(c.id)
                        ? "This color is used by jobs or machine states"
                        : "Remove color"
                    }
                    onClick={() =>
                      onChange(colors.filter((x) => x.id !== c.id))
                    }
                  >
                    <Trash2 />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            <NewTableRow
              disabled={disabled}
              columns={[
                { key: "hex", label: "Color Swatch", type: "color" },
                { key: "name", label: "Color Name" },
              ]}
              onCommit={addColor}
            />
          </TableBody>
        </Table>
      </TableScroll>
    </section>
  );
}
