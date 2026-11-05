export const QUAD_VERTS = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);

export function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Unable to allocate shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile error: ${info}`);
  }
  return shader;
}

export function createProgram(
  gl: WebGL2RenderingContext,
  vsSource: string,
  fsSource: string,
): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSource);
  let fs: WebGLShader | null = null;
  let program: WebGLProgram | null = null;
  try {
    fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSource);
    program = gl.createProgram();
    if (!program) throw new Error("Unable to allocate shader program");
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Program link error: ${gl.getProgramInfoLog(program)}`);
    }
    return program;
  } catch (error) {
    gl.deleteProgram(program);
    program = null;
    throw error;
  } finally {
    // Linked programs retain their executables; shader objects can be released.
    if (program) {
      gl.detachShader(program, vs);
      if (fs) gl.detachShader(program, fs);
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
  }
}

/** Resources are initialized to null so partial setup can always be disposed safely. */
export function createGpuResources() {
  return {
    noiseProgram: null as WebGLProgram | null,
    mainProgram: null as WebGLProgram | null,
    fbo: null as WebGLFramebuffer | null,
    fboTexture: null as WebGLTexture | null,
    vao: null as WebGLVertexArrayObject | null,
    gridCols: 0,
    gridRows: 0,
  };
}

export function getUniformLocations<T extends string>(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  names: readonly T[],
) {
  return Object.fromEntries(
    names.map((name) => [name, gl.getUniformLocation(program, name)]),
  ) as Record<T, WebGLUniformLocation | null>;
}
