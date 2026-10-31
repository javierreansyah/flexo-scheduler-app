import type { GridBackgroundConfig } from "./types";

export const VERTEX_SHADER = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPosition;
out vec2 vUv;
void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

// ───────────────────────────────────────────────────────────────
// PASS 1: Generate Noise (Rendered to a low-res texture)
// ───────────────────────────────────────────────────────────────
export const NOISE_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform vec2 uCamera;
uniform vec2 uAnchor;
uniform float uZoom;
uniform float uTime;
uniform float uSeed;
uniform vec2 uGridColsRows;
uniform float uContrast;
uniform float uBrightness;
uniform float uWarp;
uniform float uFrequency;
uniform float uRidgedMix;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColor3;
uniform vec3 uColor4;
uniform vec3 uColor5;

uniform float uGradationRowCount;
uniform float uGradationDir;
uniform float uScrollDissolveProgress;
uniform float uScrollDissolveMode;
uniform float uScrollDissolveDir;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// 2D Simplex Noise function (from Ashima Arts)
vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }
float snoise(vec2 v){
  const vec4 C = vec4(0.211324865405187, 0.366025403784439,
           -0.577350269189626, 0.024390243902439);
  vec2 i  = floor(v + dot(v, C.yy) );
  vec2 x0 = v -   i + dot(i, C.xx);
  vec2 i1;
  i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 ))
  + i.x + vec3(0.0, i1.x, 1.0 ));
  vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy),
    dot(x12.zw,x12.zw)), 0.0);
  m = m*m ;
  m = m*m ;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
  vec3 g;
  g.x  = a0.x  * x0.x  + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

// Seed offset — converts the scalar seed into a 2D domain offset
vec2 seedOffset() {
  return vec2(
    sin(uSeed * 0.1731) * 100.0 + uSeed * 0.37,
    cos(uSeed * 0.2693) * 100.0 + uSeed * 0.53
  );
}

// Ridged FBM for distinct peaks
float ridgedFbm(vec2 x) {
  float v = 0.0;
  float a = 0.5;
  vec2 shift = vec2(100.0);
  mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.50));
  for (int i = 0; i < 4; ++i) {
    float n = snoise(x);
    n = 1.0 - abs(n); // ridge
    n = n * n; // sharpen peak
    v += a * n;
    x = rot * x * 2.0 + shift;
    a *= 0.5;
  }
  return v;
}

// Organic FBM
float fbm(vec2 x) {
  float v = 0.0;
  float a = 0.5;
  vec2 shift = vec2(100.0);
  mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.50));
  for (int i = 0; i < 4; ++i) {
    v += a * snoise(x);
    x = rot * x * 2.0 + shift;
    a *= 0.5;
  }
  return v;
}

// ─── Procedural Palette ─────────────────────────────────────
// Simplified 5-color palette based on ColourLovers / Jacqueline Casey style
vec3 getPaletteColor(float t) {
  if (t > 0.85) return mix(uColor4, uColor5, (t - 0.85) / 0.15);
  if (t > 0.60) return mix(uColor3, uColor4, (t - 0.60) / 0.25);
  if (t > 0.35) return mix(uColor2, uColor3, (t - 0.35) / 0.25);
  if (t > 0.15) return mix(uColor1, uColor2, (t - 0.15) / 0.20);
  return uColor1; // Bottom 15% is solid deep navy
}

void main() {
  vec2 cellIndex = floor(vUv * uGridColsRows);

  // ── Scroll Dissolve / Appear Effect ──
  if (uScrollDissolveMode < 0.5) {
    // ══ MODE: DISSOLVE (Default - Hero Section) ══
    if (uScrollDissolveProgress > 0.0) {
      float cellRow = cellIndex.y;
      float totalRows = uGridColsRows.y;
      float physicalRow = (uScrollDissolveDir < 0.5)
        ? (totalRows - 1.0 - cellRow)
        : cellRow;

      float bandRows = max(3.0, totalRows * 0.35);
      float totalTravel = totalRows + bandRows;
      float currentWave = uScrollDissolveProgress * totalTravel;
      float rowDiff = physicalRow - (currentWave - bandRows);

      if (rowDiff <= 0.0) {
        fragColor = vec4(0.0);
        return;
      } else if (rowDiff < bandRows) {
        float probability = rowDiff / bandRows;
        float r = hash(cellIndex * 13.37 + 73.1 + uSeed * 0.17);
        if (r > probability) {
          fragColor = vec4(0.0);
          return;
        }
      }
    }
  } else {
    // ══ MODE: APPEAR (Reverse Dissolve - Footer Section) ══
    if (uScrollDissolveProgress < 1.0) {
      float cellRow = cellIndex.y;
      float totalRows = uGridColsRows.y;
      float physicalRow = (uScrollDissolveDir < 0.5)
        ? cellRow
        : (totalRows - 1.0 - cellRow);

      float bandRows = max(3.0, totalRows * 0.35);
      float totalTravel = totalRows + bandRows;
      float currentWave = uScrollDissolveProgress * totalTravel;
      float rowDiff = physicalRow - (currentWave - bandRows);

      if (rowDiff <= 0.0) {
        // Passed wave front: fully visible
      } else if (rowDiff < bandRows) {
        float probability = 1.0 - (rowDiff / bandRows);
        float r = hash(cellIndex * 13.37 + 73.1 + uSeed * 0.17);
        if (r > probability) {
          fragColor = vec4(0.0);
          return;
        }
      } else {
        // Not reached yet: completely invisible
        fragColor = vec4(0.0);
        return;
      }
    }
  }

  if (uGradationRowCount > 0.0) {
    float cellRow = cellIndex.y;
    float totalRows = uGridColsRows.y;
    float distFromFadeEdge = 0.0;

    if (uGradationDir > 0.5) { // 'up' -> fade out at screen top (texture bottom)
      distFromFadeEdge = cellRow;
    } else { // 'down' -> fade out at screen bottom (texture top)
      distFromFadeEdge = totalRows - 1.0 - cellRow;
    }

    if (distFromFadeEdge < uGradationRowCount) {
      float probability = (distFromFadeEdge + 0.5) / uGradationRowCount;
      float r = hash(cellIndex * 13.37 + 73.1);
      if (r > probability) {
        fragColor = vec4(0.0);
        return;
      }
    }
  }

  // Build world-space noise coordinate with frequency multiplier
  vec2 seedOff = seedOffset();
  vec2 centeredUv = vUv - uAnchor;
  float freq = max(0.01, uFrequency);
  vec2 noiseUv = ((centeredUv * uGridColsRows + uCamera + seedOff) / uZoom) * freq;

  // Domain Warping: distorts coordinates with secondary noise for organic ribbons/streams
  if (uWarp > 0.001) {
    vec2 warpOff = vec2(
      snoise(noiseUv * 1.2 + vec2(1.7, 9.2) + uTime * 0.05),
      snoise(noiseUv * 1.2 + vec2(8.3, 2.8) - uTime * 0.05)
    );
    noiseUv += warpOff * uWarp;
  }

  // Blend regular FBM for base shapes and Ridged FBM for distinct bright peaks
  float n1 = fbm(noiseUv + uTime * 0.1);
  float n2 = ridgedFbm(noiseUv * 1.5 - uTime * 0.05);

  // Combine the two noise layers with adjustable mix (0 = clouds, 1 = ridges)
  float finalVal = mix(n1, n2, clamp(uRidgedMix, 0.0, 1.0));

  // Classic contrast curve — pow() pushes lows darker and highs brighter
  finalVal = clamp(finalVal * 0.5 + 0.5 + uBrightness, 0.0, 1.0);
  finalVal = pow(finalVal, uContrast);

  vec3 col = getPaletteColor(finalVal);
  fragColor = vec4(col, 1.0);
}
`;

// ───────────────────────────────────────────────────────────────
// PASS 2: Main Render (Post-processing)
// ───────────────────────────────────────────────────────────────
export const getMainFragmentShader = (
  config: GridBackgroundConfig,
) => `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uGrid;
uniform vec2 uResolution;
uniform vec2 uGridColsRows;
uniform float uLineDisplaceAmount;
uniform float uPhosphorIntensity;
uniform float uHScanPeriod;
uniform float uHScanIntensity;
uniform float uHScanFuzziness;
uniform float uHBleedSpread;
uniform float uHBleedIntensity;
uniform float uLdSmoothness;
uniform float uVScanSoftness;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec4 sampleGrid(vec2 uv) {
  return texture(uGrid, uv);
}

// 7-tap anisotropic horizontal blur simulating CRT electron beam slew and edge bleed
vec4 sampleGridBleed(vec2 uv, float spreadPx) {
  if (spreadPx < 0.2) return sampleGrid(uv);
  vec2 stepX = vec2(spreadPx / uResolution.x, 0.0);
  vec4 col = vec4(0.0);
  col += sampleGrid(uv - stepX * 3.0) * 0.031;
  col += sampleGrid(uv - stepX * 2.0) * 0.106;
  col += sampleGrid(uv - stepX * 1.0) * 0.221;
  col += sampleGrid(uv              ) * 0.284;
  col += sampleGrid(uv + stepX * 1.0) * 0.221;
  col += sampleGrid(uv + stepX * 2.0) * 0.106;
  col += sampleGrid(uv + stepX * 3.0) * 0.031;
  return col;
}

void main() {
  vec2 uv = vUv;
  uv.y = 1.0 - uv.y; // Flip Y
  vec2 distUv = uv;

  // ── 0. Horizontal Line Displacement ──
  float lineY = floor(gl_FragCoord.y);
  float ldPeriod = ${config.lineDisplacePeriod.toFixed(4)};
  float ldPos = mod(lineY, ldPeriod);
  float ldThick = ldPeriod * ${config.lineDisplaceThickRatio.toFixed(4)};

  // Softened trapezoid transition to eliminate harsh 90-degree step
  float ldTransWidth = max(0.2, ldPeriod * uLdSmoothness * 0.2);
  float inThick = smoothstep(0.0, ldTransWidth, ldPos) * (1.0 - smoothstep(ldThick - ldTransWidth, ldThick, ldPos));
  float ldDir = mix(-1.0, 1.0, inThick);

  distUv.x += ldDir * uLineDisplaceAmount / uGridColsRows.x;

  // Sample with horizontal beam bleed
  vec4 baseSample = mix(sampleGrid(distUv), sampleGridBleed(distUv, uHBleedSpread), uHBleedIntensity);

  // Mask out transparent areas immediately
  float alpha = baseSample.a;
  if (alpha < 0.01) {
    fragColor = vec4(0.0);
    return;
  }

  // ── 1. Chromatic Aberration (with horizontal beam bleed) ──
  vec2 fromCenter = distUv - 0.5;
  float caStrength = ${config.caStrengthBase.toFixed(4)} + ${config.caStrengthCurve.toFixed(4)} * dot(fromCenter, fromCenter);
  vec2 caDir = normalize(fromCenter + 0.001);

  vec4 rSample = mix(sampleGrid(distUv + caDir * caStrength), sampleGridBleed(distUv + caDir * caStrength, uHBleedSpread), uHBleedIntensity);
  vec4 bSample = mix(sampleGrid(distUv - caDir * caStrength), sampleGridBleed(distUv - caDir * caStrength, uHBleedSpread), uHBleedIntensity);
  vec3 color = vec3(rSample.r, baseSample.g, bSample.b);

  // ── 2. VERTICAL SCANLINES ──
  float pixelX = gl_FragCoord.x;
  float preScanBright = dot(color, vec3(0.299, 0.587, 0.114));

  float vScanPeriod = ${config.vScanPeriod.toFixed(4)};
  float vScan = mod(pixelX, vScanPeriod);

  float gapWidth = mix(${config.vScanGapDark.toFixed(4)}, ${config.vScanGapLight.toFixed(4)}, smoothstep(0.02, 0.35, preScanBright));

  // Softened vertical gap edges to create rounded phosphor spots
  float edgeSoft = max(0.5, gapWidth * uVScanSoftness);
  float vScanMask = smoothstep(0.0, edgeSoft, vScan) * smoothstep(vScanPeriod, vScanPeriod - edgeSoft, vScan);

  float gapFloor = mix(${config.vScanFloorDark.toFixed(4)}, ${config.vScanFloorLight.toFixed(4)}, smoothstep(0.02, 0.4, preScanBright));
  color *= gapFloor + (1.0 - gapFloor) * vScanMask;

  // ── 3. HORIZONTAL SCANLINES (Gaussian Beam Profile) ──
  float pixelY = gl_FragCoord.y;
  float hScan = mod(pixelY, uHScanPeriod);

  // Distance from beam center [-1.0, 1.0]
  float beamDist = (hScan - 0.5 * uHScanPeriod) / (0.5 * uHScanPeriod);
  // Gaussian beam bloom: brighter areas widen the electron beam
  float beamWidth = mix(1.2, 2.8, uHScanFuzziness) * (1.0 + 0.5 * preScanBright);
  float hBeam = exp(-beamDist * beamDist * (4.0 / max(0.2, beamWidth)));

  color *= mix(1.0, hBeam, uHScanIntensity);

  // ── 4. Bloom (Samples beam-blurred grid) ──
  float bloomMask = smoothstep(${config.bloomThresholdMin.toFixed(4)}, ${config.bloomThresholdMax.toFixed(4)}, preScanBright);
  if (bloomMask > 0.0001) {
    vec3 bloom = vec3(0.0);
    float bloomWeight = 0.0;
    for(float x = -2.0; x <= 2.0; x += 1.0) {
      for(float y = -2.0; y <= 2.0; y += 1.0) {
        vec2 offset = vec2(x, y) * ${config.bloomSpread.toFixed(4)} / uResolution;
        float w = exp(-0.5 * (x*x + y*y));
        bloom += sampleGridBleed(distUv + offset, uHBleedSpread * 0.5).rgb * w;
        bloomWeight += w;
      }
    }
    bloom /= bloomWeight;
    color += bloom * (${config.bloomIntensity.toFixed(4)} * bloomMask);
  }

  vec3 wideBloom = vec3(0.0);
  float wbWeight = 0.0;
  for(float x = -2.0; x <= 2.0; x += 1.0) {
    for(float y = -2.0; y <= 2.0; y += 1.0) {
      vec2 offset = vec2(x, y) * ${config.wideBloomSpread.toFixed(4)} * 2.0 / uResolution;
      float w = exp(-0.25 * (x*x + y*y));
      wideBloom += sampleGrid(distUv + offset).rgb * w;
      wbWeight += w;
    }
  }
  wideBloom /= wbWeight;
  float wbBright = dot(wideBloom, vec3(0.299, 0.587, 0.114));
  color += wideBloom * smoothstep(${config.wideBloomThresholdMin.toFixed(4)}, ${config.wideBloomThresholdMax.toFixed(4)}, wbBright) * ${config.wideBloomIntensity.toFixed(4)};

  // ── 5. Phosphor Sub-pixel RGB ──
  float subPixel = mod(pixelX, 3.0);
  vec3 phosphorMask;
  if (subPixel < 1.0) {
    phosphorMask = vec3(1.15, 0.9, 0.9);
  } else if (subPixel < 2.0) {
    phosphorMask = vec3(0.9, 1.15, 0.9);
  } else {
    phosphorMask = vec3(0.9, 0.9, 1.15);
  }
  color *= mix(vec3(1.0), phosphorMask, uPhosphorIntensity);

  // ── 6. Static Noise ──
  float noise = hash(gl_FragCoord.xy);
  float brightness = dot(color, vec3(0.299, 0.587, 0.114));
  float edgeNoise = abs(dFdx(brightness)) + abs(dFdy(brightness));
  float noiseIntensity = ${config.staticNoiseIntensityBase.toFixed(4)} + edgeNoise * ${config.staticNoiseIntensityEdge.toFixed(4)};
  color += (noise - 0.5) * noiseIntensity;

  color = clamp(color, 0.0, 1.0);

  fragColor = vec4(color, alpha);
}
`;
