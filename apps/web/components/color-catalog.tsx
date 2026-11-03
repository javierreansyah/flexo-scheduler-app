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
    [c.name, c.hex, String(c.darkness ?? "")].some((value) =>
      value.toLowerCase().includes(query.toLowerCase()),
    ),
  );
  return (
    <section>
      <TableToolbar>
        <TableFilter
          label="Search colors"
          query={query}
          onQueryChange={setQuery}
          count={filtered.length}
        />
        <div className="ml-auto">
          <Button
            variant="outline"
            disabled={disabled}
            onClick={() => {
              const id = Math.max(0, ...colors.map((c) => c.id)) + 1;
              onChange([
                ...colors,
                { id, name: `New color ${id}`, hex: "#808080" },
              ]);
            }}
          >
            Add color
          </Button>
        </div>
      </TableToolbar>
      <TableScroll>
        <Table aria-label="Colors">
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Swatch</TableHead>
              <TableHead scope="col">Color name</TableHead>
              <TableHead>Darkness</TableHead>
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
                    aria-label={`Color name ${c.id}`}
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
                <TableCell>{c.darkness ?? "—"}</TableCell>
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
                { key: "hex", label: "color swatch", type: "color" },
                { key: "name", label: "color name" },
                { key: "darkness", label: "color darkness", type: "number" },
              ]}
              onCommit={(row) => {
                const name = row.name?.trim(),
                  hex = row.hex ?? "#808080",
                  darkness = row.darkness?.trim()
                    ? Number(row.darkness)
                    : undefined;
                if (!name || name.includes(","))
                  return "Enter a color name without commas.";
                if (
                  colors.some(
                    (color) => color.name.toLowerCase() === name.toLowerCase(),
                  )
                )
                  return "Color names must be unique.";
                if (
                  darkness !== undefined &&
                  (!Number.isInteger(darkness) || darkness < 1 || darkness > 9)
                )
                  return "Darkness must be a whole number from 1 to 9.";
                onChange([
                  ...colors,
                  {
                    id: Math.max(0, ...colors.map((color) => color.id)) + 1,
                    name,
                    hex,
                    ...(darkness !== undefined ? { darkness } : {}),
                  },
                ]);
                return null;
              }}
            />
          </TableBody>
        </Table>
      </TableScroll>
    </section>
  );
}
