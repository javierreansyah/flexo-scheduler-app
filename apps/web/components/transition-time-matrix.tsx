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

import { transitionTimes } from "@/lib/transition-times";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "./ui/select";
import type { Snapshot } from "@/lib/model";
import { useEffect, useState } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
function TimeCell({
  from,
  to,
  value,
  disabled,
  onCommit,
  onError,
  unit,
}: {
  unit: "minutes" | "hours";
  from: string;
  to: string;
  value: number;
  disabled: boolean;
  onCommit: (value: number) => void;
  onError: (message: string) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <Input
      variant="matrix"
      aria-label={`Transition time ${from} to ${to} (${unit})`}
      type="number"
      min="0"
      max={unit === "minutes" ? 480 : 8}
      step="any"
      value={draft}
      disabled={disabled || from === to}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const next = Number(draft);
        if (
          !draft.trim() ||
          !Number.isFinite(next) ||
          next < 0 ||
          next > (unit === "minutes" ? 480 : 8)
        ) {
          setDraft(String(value));
          onError(
            "Time was not applied. Enter a value between 0 and 8 hours (480 minutes).",
          );
          return;
        }
        onError("");
        if (next !== value) onCommit(next);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") setDraft(String(value));
      }}
    />
  );
}
export function TransitionTimeMatrix({
  snapshot,
  disabled,
  onChange,
  colors,
}: {
  colors: import("@/lib/colors").InkColor[];
  snapshot: Snapshot;
  disabled: boolean;
  onChange: (costs: NonNullable<Snapshot["transition_times"]>) => void;
}) {
  const labels = ["empty", ...colors.map((c) => String(c.id))],
    matrix = transitionTimes(labels, snapshot),
    defaults = transitionTimes(labels, { setup_time: 0.75 });
  const [unit, setUnit] = useState<"minutes" | "hours">("minutes");
  const factor = unit === "minutes" ? 60 : 1;
  const [error, setError] = useState("");
  const name = (id: string) =>
    id === "empty"
      ? "Empty"
      : (colors.find((c) => String(c.id) === id)?.name ?? id);
  const [query, setQuery] = useState("");
  const visibleRows = labels.filter((id) =>
    name(id).toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <section>
      <TableToolbar>
        <TableFilter
          label="Search Transitions"
          query={query}
          onQueryChange={setQuery}
        />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="w-32">
            <Select
              value={unit}
              items={[
                { value: "minutes", label: "Minutes" },
                { value: "hours", label: "Hours" },
              ]}
              onValueChange={(value) => {
                if (value) setUnit(value);
              }}
            >
              <SelectTrigger aria-label="Transition time unit">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="minutes">Minutes</SelectItem>
                <SelectItem value="hours">Hours</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            variant="outline"
            disabled={disabled}
            onClick={() => {
              setError("");
              onChange(defaults);
            }}
          >
            Restore Defaults
          </Button>
        </div>
      </TableToolbar>

      {error && (
        <p
          className="my-4 border border-destructive p-4 text-sm text-destructive"
          role="alert"
        >
          {error}
        </p>
      )}
      <TableScroll>
        <Table variant="matrix" aria-label="Ink transition time matrix">
          <TableHeader>
            <TableRow>
              <TableHead variant="matrix" scope="col">
                From / To
              </TableHead>
              {labels.map((to) => (
                <TableHead scope="col" key={to}>
                  {name(to)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleRows.map((from) => (
              <TableRow key={from}>
                <TableHead scope="row">{name(from)}</TableHead>
                {labels.map((to) => (
                  <TableCell
                    variant="matrix"
                    key={to}
                    data-custom={matrix[from][to] !== defaults[from][to]}
                  >
                    <TimeCell
                      key={unit}
                      unit={unit}
                      from={name(from)}
                      to={name(to)}
                      value={Number(
                        (matrix[from][to] * factor).toPrecision(12),
                      )}
                      disabled={disabled}
                      onError={setError}
                      onCommit={(value) =>
                        onChange({
                          ...matrix,
                          [from]: { ...matrix[from], [to]: value / factor },
                        })
                      }
                    />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableScroll>
      <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
        Rows: from · Columns: to. Parallel cleaning uses the longest transition.
      </p>
      {disabled && !snapshot.transition_times && (
        <p className="text-sm leading-relaxed text-muted-foreground">
          This saved schedule uses legacy setup settings. Create a new project
          to use parallel cleaning times.
        </p>
      )}
    </section>
  );
}
