"use client";
import { ColorCatalog } from "../color-catalog";
import { inkCostMatrix } from "@/lib/ink-costs";
import { transitionTimes } from "@/lib/transition-times";
import { useWorkspace } from "./workspace-context";
export function ColorsPanel() {
  const { update, ready, busy, physicalLocked, colors, usedColors } =
    useWorkspace();
  return (
    <ColorCatalog
      colors={colors}
      used={usedColors}
      disabled={physicalLocked || busy || !ready}
      onChange={(next) => {
        const ids = ["empty", ...next.map((c) => String(c.id))];
        update((p) => ({
          ...p,
          colors: next,
          snapshot: {
            ...p.snapshot,
            ink_costs: inkCostMatrix(ids, p.snapshot.ink_costs),
            ...(p.snapshot.transition_times
              ? { transition_times: transitionTimes(ids, p.snapshot) }
              : {}),
          },
        }));
      }}
    />
  );
}
