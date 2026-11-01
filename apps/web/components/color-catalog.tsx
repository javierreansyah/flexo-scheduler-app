"use client";
import { Button } from "./ui/button";
import type { InkColor } from "@/lib/colors";
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
  return (
    <section className="color-catalog">
      <div className="section-head">
        <div>
          <h4>Colors</h4>
          <p>
            Name your colors first, then set the cost of each transition below.
            Industry sample names are placeholders; rename them to your actual
            inks.
          </p>
        </div>
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
      <div className="color-list">
        {colors.map((c) => (
          <div className="color-row" key={c.id}>
            <input
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
            <input
              key={`${c.id}:${c.name}`}
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
            <button
              disabled={disabled || used.has(c.id)}
              title={
                used.has(c.id)
                  ? "This color is used by jobs or machine states"
                  : "Remove color"
              }
              onClick={() => onChange(colors.filter((x) => x.id !== c.id))}
            >
              Remove
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
