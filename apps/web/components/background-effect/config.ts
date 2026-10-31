import type { GridBackgroundConfig } from "./types";

export const DEFAULT_CONFIG: GridBackgroundConfig = {
  // --- Grid / Resolution ---
  gridCellSizePx: 120, // Base pixel size for grid cells (finest resolution)

  // --- Noise Parameters (GPU) ---
  seed: 13,
  cameraX: 12,
  cameraY: 5,
  zoom: 50,
  anchorX: 0.5, // Expand center / camera anchor X (0.0=left, 0.5=center, 1.0=right)
  anchorY: 0.5, // Expand center / camera anchor Y (0.0=top, 0.5=center, 1.0=bottom)
  time: 0.0,
  noiseContrast: 20,
  noiseBrightness: 0.34,
  warpAmount: 0.0, // Domain warp distortion strength (0.0 to 2.5)
  noiseFrequency: 1.0, // Spatial frequency multiplier (0.2 to 10.0)
  noiseRidgedMix: 0.5, // 0.0 = pure clouds/organic, 1.0 = pure sharp ridges

  // --- Palette Colors (RGB 0-255) ---
  color1: [4.0, 4.0, 20.0],
  color2: [20.0, 90.0, 50.0],
  color3: [50.0, 160.0, 195.0],
  color4: [245.0, 240.0, 180.0],
  color5: [255.0, 252.0, 235.0],

  // --- Chromatic Aberration (GPU) ---
  caStrengthBase: 0.005,
  caStrengthCurve: 0.001,

  // --- Bloom (GPU) ---
  bloomSpread: 5.0,
  bloomIntensity: 1.2,
  bloomThresholdMin: 0.15,
  bloomThresholdMax: 5.5,

  wideBloomSpread: 8.0,
  wideBloomIntensity: 0.25,
  wideBloomThresholdMin: 0.2,
  wideBloomThresholdMax: 0.6,

  // --- Vertical Scanlines (GPU) ---
  vScanPeriod: 16.0,
  vScanGapDark: 16.0, // Dark gap width in dark areas
  vScanGapLight: 4.0, // Dark gap width in bright areas
  vScanFloorDark: 0.1, // How dark the gap gets in dark areas
  vScanFloorLight: 0.1, // How dark the gap gets in bright areas
  vScanSoftness: 0.45, // Edge softness for vertical gaps (creates rounded phosphor dots)

  // --- Horizontal Line Displacement (GPU) ---
  lineDisplacePeriod: 16.0, // Total height of one thick+thin cycle (px) — bigger = fewer bands
  lineDisplaceThickRatio: 0.65, // Fraction of period for the thick band (0.5 = symmetric)
  lineDisplaceAmount: 0.04, // Displacement in texels — how far each band shifts
  ldSmoothness: 0.35, // Smoothness of the band transition (removes harsh 90-degree step)

  // --- Horizontal Scanlines & Beam Fuzziness (GPU) ---
  hScanPeriod: 6.0, // Period of horizontal raster lines
  hScanIntensity: 0.45, // Intensity of horizontal scanlines (0 = off, 1 = maximum contrast)
  hScanFuzziness: 0.65, // Gaussian beam softness/bloom (0 = sharp beam, 1 = diffuse bloom)

  // --- Horizontal Beam Bleed & Edge Fuzziness (GPU) ---
  hBleedSpread: 5.5, // How far the beam bleeds horizontally across cell borders (in screen px)
  hBleedIntensity: 0.4, // Strength of the horizontal beam bleed (0 = sharp, 1 = full analog smear)

  // --- Phosphor Sub-pixel RGB (GPU) ---
  phosphorIntensity: 1.0,

  // --- Static Noise & Vignette (GPU) ---
  staticNoiseIntensityBase: 0.08,
  staticNoiseIntensityEdge: 1.6,
};
