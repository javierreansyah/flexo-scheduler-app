/** Mutable control surface shared by the scheduler and development HUD. */
export interface BackgroundState {
  needsRender: boolean;
  currentDissolveProgress: number;
  containerWidth: number;
  containerHeight: number;
  resizeFn: ((width: number, height: number) => void) | null;
  wakeLoop: (() => void) | null;
}

export function createBackgroundState(): BackgroundState {
  return {
    needsRender: true,
    currentDissolveProgress: 0,
    containerWidth: 0,
    containerHeight: 0,
    resizeFn: null,
    wakeLoop: null,
  };
}
