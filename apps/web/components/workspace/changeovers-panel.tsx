"use client";
import { TransitionTimeMatrix } from "../transition-time-matrix";
import { useWorkspace } from "./workspace-context";
export function ChangeoversPanel() {
  const { ready, busy, snapshot, physicalLocked, colors, changeSnapshot } =
    useWorkspace();
  return (
    <TransitionTimeMatrix
      colors={colors}
      snapshot={snapshot}
      disabled={physicalLocked || busy || !ready}
      onChange={(transition_times) =>
        changeSnapshot({ transition_times, setup_durations: undefined })
      }
    />
  );
}
