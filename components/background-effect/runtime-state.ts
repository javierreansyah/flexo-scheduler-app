/** Mutable rendering state shared by the button effect and its runtime. */
export interface BackgroundState {
  needsRender: boolean;
  containerWidth: number;
  containerHeight: number;
}

export function createBackgroundState(): BackgroundState {
  return {
    needsRender: true,
    containerWidth: 0,
    containerHeight: 0,
  };
}
