import type React from "react";

export interface GridBackgroundConfig {
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
  /** How often (in ms) to check the probability and potentially trigger a sequence */
  checkInterval: number;
  /** List of possible sequences to run */
  sequences: AnimationSequence[];
}

export interface ScrollDissolveConfig {
  /** Distance in px over which the transition occurs. */
  distance?: number;
  /** Transition mode: "dissolve" (visible -> hidden) or "appear" (hidden -> visible). Defaults to "dissolve". */
  mode?: "dissolve" | "appear";
  /** Transition direction. Defaults to "down-to-up". */
  direction?: "down-to-up" | "up-to-down";
  /** Target scroll boundary: "top" (based on scrollY from top) or "bottom" (based on approaching bottom of document). Defaults to "top" for dissolve, "bottom" for appear. */
  target?: "top" | "bottom";
}

export interface GradationConfig {
  rowCount: number;
  direction: "up" | "down";
}

export interface GridBackgroundProps extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode;
  className?: string;
  /** Enable developer camera inspection mode: drag to pan, adjust zoom via HUD, with live HUD in top right */
  devMode?: boolean;
  /** Defer GPU initialization while retaining the same DOM and children. */
  enabled?: boolean;
  /** Enable scroll-driven cell disappearance/appearance. */
  scrollDissolve?: boolean | ScrollDissolveConfig;
  config?: Partial<GridBackgroundConfig>;
  /** Optional array of probabilistic animation sequences to apply over time */
  sequences?: AnimationSequenceConfig;
  /** Optional array of events to run exactly once when the canvas first loads */
  initialEvents?: AnimationEvent[];
  /** Optional cell gradation (fade out effect) */
  gradation?: GradationConfig;
}

export interface DevStats {
  cameraX: number;
  cameraY: number;
  zoom: number;
  anchorX: number;
  anchorY: number;
  gridCellSizePx: number;
  warpAmount: number;
  noiseFrequency: number;
  noiseRidgedMix: number;
  noiseBrightness: number;
  noiseContrast: number;
  seed: number;
  time: number;
  lineDisplaceAmount: number;
  ldSmoothness: number;
  hScanPeriod: number;
  hScanIntensity: number;
  hScanFuzziness: number;
  hBleedSpread: number;
  hBleedIntensity: number;
  vScanSoftness: number;
  phosphorIntensity: number;
}
