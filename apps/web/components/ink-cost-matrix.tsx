"use client";
import { useEffect, useState } from "react";
import { Button } from "./ui/button";
import { inkCostMatrix, industryInkCost } from "@/lib/ink-costs";
import type { Snapshot } from "@/lib/model";
function CostCell({
  from,
  to,
  value,
  disabled,
  onCommit,
  onError,
}: {
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
    <input
      aria-label={`Ink cost ${from} to ${to}`}
      type="number"
      min="0"
      step="any"
      value={draft}
      disabled={disabled || from === to}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const next = Number(draft);
        if (!draft.trim() || !Number.isFinite(next) || next < 0) {
          setDraft(String(value));
          onError("Cost was not applied. Enter a finite, nonnegative number.");
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
export function InkCostMatrix({
  snapshot,
  disabled,
  onChange,
  colors,
}: {
  colors: import("@/lib/colors").InkColor[];
  snapshot: Snapshot;
  disabled: boolean;
  onChange: (costs: NonNullable<Snapshot["ink_costs"]>) => void;
}) {
  const labels = ["empty", ...colors.map((c) => String(c.id))],
    matrix = inkCostMatrix(labels, snapshot.ink_costs);
  const [error, setError] = useState("");
  const name = (id: string) =>
    id === "empty"
      ? "Empty"
      : (colors.find((c) => String(c.id) === id)?.name ?? id);
  return (
    <section className="ink-matrix-section">
      <div className="section-head">
        <div>
          <h4>Ink transition cost matrix</h4>
          <p>
            Rows are the source color; columns are the replacement color. Edit
            each directed transition independently.
          </p>
        </div>
        <Button
          variant="outline"
          disabled={disabled}
          onClick={() => {
            setError("");
            onChange(inkCostMatrix(labels));
          }}
        >
          Restore industry defaults
        </Button>
      </div>
      <p className="note">
        The industry preset follows the original darkness ordering. For your own
        palette, set the costs explicitly. Matching colors are retained; these
        values are costs, not setup hours.
      </p>
      {disabled && (
        <p className="note">
          This matrix is fixed after the first schedule. Start a new project to
          change it.
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="ink-matrix-scroll">
        <table
          className="ink-cost-matrix"
          aria-label="Ink transition cost matrix"
        >
          <thead>
            <tr>
              <th scope="col">From / To</th>
              {labels.map((to) => (
                <th scope="col" key={to}>
                  {name(to)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {labels.map((from) => (
              <tr key={from}>
                <th scope="row">{name(from)}</th>
                {labels.map((to) => (
                  <td
                    key={to}
                    data-custom={matrix[from][to] !== industryInkCost(from, to)}
                  >
                    <CostCell
                      from={name(from)}
                      to={name(to)}
                      value={matrix[from][to]}
                      disabled={disabled}
                      onError={setError}
                      onCommit={(value) =>
                        onChange({
                          ...matrix,
                          [from]: { ...matrix[from], [to]: value },
                        })
                      }
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note">
        Diagonal costs stay zero. Highlighted cells differ from the industry
        defaults. New inks receive the industry defaults while existing custom
        costs are preserved.
      </p>
    </section>
  );
}
