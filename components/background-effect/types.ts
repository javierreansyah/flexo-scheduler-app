import type React from "react";

export interface GridBackgroundConfig {
  /** Render one elongated CRT cell instead of the full grid. */
  singleCell?: boolean;
  /** Space outside the lit cell reserved for CRT displacement and glow. */
  singleCellBleedPx?: [number, number];
  gridCellSizePx: number;
  seed: number;
  cameraX: number;
  cameraY: number;
  zoom: number;
  anchorX?: number;
  anchorY?: number;
  time: number;
  noiseContrast: number;
  noiseBrightness: number;
  warpAmount?: number;
  noiseFrequency?: number;
  noiseRidgedMix?: number;
  color1: [number, number, number];
  color2: [number, number, number];
  color3: [number, number, number];
  color4: [number, number, number];
  color5: [number, number, number];
  caStrengthBase: number;
  caStrengthCurve: number;
  bloomSpread: number;
  bloomIntensity: number;
  bloomThresholdMin: number;
  bloomThresholdMax: number;
  wideBloomSpread: number;
  wideBloomIntensity: number;
  wideBloomThresholdMin: number;
  wideBloomThresholdMax: number;
  vScanPeriod: number;
  vScanGapDark: number;
  vScanGapLight: number;
  vScanFloorDark: number;
  vScanFloorLight: number;
  vScanSoftness: number;
  lineDisplacePeriod: number;
  lineDisplaceThickRatio: number;
  lineDisplaceAmount: number;
  ldSmoothness: number;
  hScanPeriod: number;
  hScanIntensity: number;
  hScanFuzziness: number;
  hBleedSpread: number;
  hBleedIntensity: number;
  phosphorIntensity: number;
  staticNoiseIntensityBase: number;
  staticNoiseIntensityEdge: number;
}

export interface AnimationKeyframe {
  /** Target value to animate to (use [x, y, zoom] array for camera). If omitted, holds/pauses current value for duration */
  target?: number | [number, number, number];
  /** Duration in ms for this keyframe (or pause duration) */
  duration?: number;
  /** Optional shorthand for pausing: holds current value for specified ms */
  pause?: number;
  /** Delay in ms before starting this keyframe */
  delay?: number;
  /** Timing curve for interpolation */
  ease?: "linear" | "easeOut" | "easeInOut";
}

export interface AnimationEvent {
  property: keyof GridBackgroundConfig | "camera";
  /** Optional step size to quantize the output value (e.g., 0.001) for a blocky effect */
  stepSize?: number;
  /** Array of keyframes to execute in series */
  keyframes: AnimationKeyframe[];
}

export interface AnimationSequence {
  /** The events that execute when this sequence triggers */
  events: AnimationEvent[];
  /** Probability of triggering this specific sequence if checked (0.0 to 1.0) */
  probability: number;
}

export interface AnimationSequenceConfig {
  /** Advance shader time continuously in units per second while this sequence is active. */
  timeSpeed?: number;
  /** Generate a fresh burst after the previous one finishes. */
  generateEvents?: (
    current: Readonly<GridBackgroundConfig>,
  ) => AnimationEvent[];
  /** How often (in ms) to check the probability and potentially trigger a sequence */
  checkInterval: number;
  /** List of possible sequences to run */
  sequences: AnimationSequence[];
}

export interface GridBackgroundProps extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode;
  className?: string;
  /** Defer GPU initialization while retaining the same DOM and children. */
  enabled?: boolean;
  config?: Partial<GridBackgroundConfig>;
  /** Optional array of probabilistic animation sequences to apply over time */
  sequences?: AnimationSequenceConfig;
}
