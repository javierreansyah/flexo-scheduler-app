import {
  NOISE_FRAGMENT_SHADER,
  VERTEX_SHADER,
  getMainFragmentShader,
} from "./shaders";
import type {
  GradationConfig,
  GridBackgroundConfig,
  ScrollDissolveConfig,
} from "./types";
import {
  QUAD_VERTS,
  createGpuResources,
  createProgram,
  getUniformLocations,
} from "./webgl-utils";

/** Owns GPU resources and the original noise + CRT passes. No scheduling or DOM observers. */
export function createGridRenderer(
  canvas: HTMLCanvasElement,
  config: GridBackgroundConfig,
) {
  const context = canvas.getContext("webgl2", {
    alpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: false,
    powerPreference: "high-performance",
  });
  if (!context) throw new Error("WebGL2 is unavailable");
  const gl = context;
  const state = createGpuResources();
  let shaderSource = getMainFragmentShader(config);
  let vbo: WebGLBuffer | null = null;
  let cssWidth = 1,
    cssHeight = 1;

  function dispose() {
    gl.deleteFramebuffer(state.fbo);
    gl.deleteTexture(state.fboTexture);
    gl.deleteBuffer(vbo);
    gl.deleteVertexArray(state.vao);
    gl.deleteProgram(state.noiseProgram);
    gl.deleteProgram(state.mainProgram);
  }

  try {
    state.noiseProgram = createProgram(
      gl,
      VERTEX_SHADER,
      NOISE_FRAGMENT_SHADER,
    );
    state.mainProgram = createProgram(gl, VERTEX_SHADER, shaderSource);
    // Setup geometry (fullscreen quad)
    const vao = gl.createVertexArray();
    state.vao = vao;
    if (!vao) throw new Error("Unable to allocate vertex array");
    gl.bindVertexArray(vao);

    vbo = gl.createBuffer();
    if (!vbo) throw new Error("Unable to allocate vertex buffer");
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, QUAD_VERTS, gl.STATIC_DRAW);
    const aPos = 0;
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    // Setup Framebuffer Object (FBO) for pass 1
    state.fbo = gl.createFramebuffer();
    state.fboTexture = gl.createTexture();
    if (!state.fbo || !state.fboTexture)
      throw new Error("Unable to allocate grid framebuffer");

    gl.bindTexture(gl.TEXTURE_2D, state.fboTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.bindFramebuffer(gl.FRAMEBUFFER, state.fbo);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      state.fboTexture,
      0,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  } catch (error) {
    dispose();
    throw error;
  }

  const noise = getUniformLocations(gl, state.noiseProgram!, [
    "uCamera",
    "uAnchor",
    "uZoom",
    "uTime",
    "uSeed",
    "uGridColsRows",
    "uContrast",
    "uBrightness",
    "uWarp",
    "uFrequency",
    "uRidgedMix",
    "uColor1",
    "uColor2",
    "uColor3",
    "uColor4",
    "uColor5",
    "uGradationRowCount",
    "uGradationDir",
    "uScrollDissolveProgress",
    "uScrollDissolveMode",
    "uScrollDissolveDir",
  ] as const);
  const mainNames = [
    "uCellInset",
    "uTime",
    "uResolution",
    "uGridColsRows",
    "uLineDisplaceAmount",
    "uPhosphorIntensity",
    "uHScanPeriod",
    "uHScanIntensity",
    "uHScanFuzziness",
    "uHBleedSpread",
    "uHBleedIntensity",
    "uLdSmoothness",
    "uVScanSoftness",
    "uGrid",
  ] as const;
  let main = getUniformLocations(gl, state.mainProgram!, mainNames);

  function configure(config: GridBackgroundConfig) {
    const source = getMainFragmentShader(config);
    if (source === shaderSource) return;
    const nextProgram = createProgram(gl, VERTEX_SHADER, source);
    gl.deleteProgram(state.mainProgram);
    state.mainProgram = nextProgram;
    shaderSource = source;
    main = getUniformLocations(gl, nextProgram, mainNames);
  }

  function resize(width: number, height: number, cellSize: number) {
    if (width <= 0 || height <= 0) return;
    cssWidth = width;
    cssHeight = height;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(height * dpr));
    // Reassigning canvas dimensions clears the buffer even when unchanged.
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    const cols = Math.max(1, Math.ceil(width / Math.max(1, cellSize)));
    const rows = Math.max(4, Math.round((cols * height) / width));
    if (cols !== state.gridCols || rows !== state.gridRows) {
      state.gridCols = cols;
      state.gridRows = rows;
      gl.bindTexture(gl.TEXTURE_2D, state.fboTexture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        cols,
        rows,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        null,
      );
      gl.bindFramebuffer(gl.FRAMEBUFFER, state.fbo);
      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      if (status !== gl.FRAMEBUFFER_COMPLETE)
        throw new Error(`Incomplete grid framebuffer: ${status}`);
    }
  }

  const draw = (
    activeConfig: GridBackgroundConfig,
    progress: number,
    gradation?: GradationConfig,
    dissolve?: ScrollDissolveConfig,
  ) => {
    // Pass 1: Render continuous noise to low-res FBO texture
    gl.bindFramebuffer(gl.FRAMEBUFFER, state.fbo);
    gl.viewport(0, 0, state.gridCols, state.gridRows);

    gl.useProgram(state.noiseProgram);
    gl.uniform2f(noise.uCamera, activeConfig.cameraX, activeConfig.cameraY);
    const rawAx = activeConfig.anchorX ?? 0.5;
    const rawAy = activeConfig.anchorY ?? 0.5;
    const normAx = rawAx > 1 ? rawAx / 100 : rawAx;
    const normAy = rawAy > 1 ? rawAy / 100 : rawAy;
    gl.uniform2f(noise.uAnchor, normAx, normAy);
    gl.uniform1f(noise.uZoom, activeConfig.zoom);
    gl.uniform1f(noise.uTime, activeConfig.time);
    gl.uniform1f(noise.uSeed, activeConfig.seed);
    gl.uniform2f(noise.uGridColsRows, state.gridCols, state.gridRows);
    gl.uniform1f(noise.uContrast, activeConfig.noiseContrast);
    gl.uniform1f(noise.uBrightness, activeConfig.noiseBrightness);
    gl.uniform1f(noise.uWarp, activeConfig.warpAmount ?? 0);
    gl.uniform1f(noise.uFrequency, activeConfig.noiseFrequency ?? 1.0);
    gl.uniform1f(noise.uRidgedMix, activeConfig.noiseRidgedMix ?? 0.5);
    gl.uniform3f(
      noise.uColor1,
      activeConfig.color1[0] / 255,
      activeConfig.color1[1] / 255,
      activeConfig.color1[2] / 255,
    );
    gl.uniform3f(
      noise.uColor2,
      activeConfig.color2[0] / 255,
      activeConfig.color2[1] / 255,
      activeConfig.color2[2] / 255,
    );
    gl.uniform3f(
      noise.uColor3,
      activeConfig.color3[0] / 255,
      activeConfig.color3[1] / 255,
      activeConfig.color3[2] / 255,
    );
    gl.uniform3f(
      noise.uColor4,
      activeConfig.color4[0] / 255,
      activeConfig.color4[1] / 255,
      activeConfig.color4[2] / 255,
    );
    gl.uniform3f(
      noise.uColor5,
      activeConfig.color5[0] / 255,
      activeConfig.color5[1] / 255,
      activeConfig.color5[2] / 255,
    );

    const g = gradation;
    const gRows = g?.rowCount || 0;
    const gDir = g ? (g.direction === "up" ? 1.0 : 0.0) : -1.0;
    gl.uniform1f(noise.uGradationRowCount, gRows);
    gl.uniform1f(noise.uGradationDir, gDir);
    gl.uniform1f(noise.uScrollDissolveProgress, progress);
    gl.uniform1f(
      noise.uScrollDissolveMode,
      dissolve?.mode === "appear" ? 1.0 : 0.0,
    );
    gl.uniform1f(
      noise.uScrollDissolveDir,
      dissolve?.direction === "up-to-down" ? 1.0 : 0.0,
    );

    gl.bindVertexArray(state.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Pass 2: Main Render (Upscale & Post-process)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

    gl.useProgram(state.mainProgram);
    const bleed = activeConfig.singleCellBleedPx;
    gl.uniform2f(
      main.uCellInset,
      bleed ? bleed[0] / cssWidth : 0.025,
      bleed ? bleed[1] / cssHeight : 0.08,
    );
    gl.uniform1f(main.uTime, activeConfig.time);
    gl.uniform2f(main.uResolution, gl.canvas.width, gl.canvas.height);
    gl.uniform2f(main.uGridColsRows, state.gridCols, state.gridRows);

    gl.uniform1f(main.uLineDisplaceAmount, activeConfig.lineDisplaceAmount);
    gl.uniform1f(main.uPhosphorIntensity, activeConfig.phosphorIntensity);
    gl.uniform1f(main.uHScanPeriod, activeConfig.hScanPeriod);
    gl.uniform1f(main.uHScanIntensity, activeConfig.hScanIntensity);
    gl.uniform1f(main.uHScanFuzziness, activeConfig.hScanFuzziness);
    gl.uniform1f(main.uHBleedSpread, activeConfig.hBleedSpread);
    gl.uniform1f(main.uHBleedIntensity, activeConfig.hBleedIntensity);
    gl.uniform1f(main.uLdSmoothness, activeConfig.ldSmoothness);
    gl.uniform1f(main.uVScanSoftness, activeConfig.vScanSoftness);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, state.fboTexture);
    gl.uniform1i(main.uGrid, 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };

  return { draw, resize, configure, dispose };
}

export type GridRenderer = ReturnType<typeof createGridRenderer>;
