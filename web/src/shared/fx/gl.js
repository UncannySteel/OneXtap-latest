/* ===========================================================================
   Minimal WebGL plumbing for the paper effects: a context, shader programs,
   and the handful of matrices one perspective camera needs. Deliberately
   small — the page only ever draws one sheet or one blot at a time.
   =========================================================================== */

/* Shaders are written once against a few macros (ATTR, VARY, TEX, FRAG) and
   given the prelude for whichever context the browser hands out: WebGL 2
   (GLSL ES 3.00), or WebGL 1 plus standard derivatives, which the faceted
   paper shading needs for its per-triangle normals. */
function prelude(isGL2, stage) {
  if (isGL2) {
    return '#version 300 es\nprecision highp float;\n' + (stage === 'vs'
      ? '#define ATTR in\n#define VARY out\n'
      : '#define VARY in\n#define TEX texture\nout vec4 fragOut;\n#define FRAG fragOut\n');
  }
  return stage === 'vs'
    ? 'precision highp float;\n#define ATTR attribute\n#define VARY varying\n'
    : '#extension GL_OES_standard_derivatives : enable\n' +
      '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n' +
      '#define VARY varying\n#define TEX texture2D\n#define FRAG gl_FragColor\n';
}

export function createContext(canvas) {
  var attrs = {
    alpha: true, premultipliedAlpha: true, antialias: true, depth: true,
    stencil: false, preserveDrawingBuffer: false, powerPreference: 'high-performance'
  };
  var gl = canvas.getContext('webgl2', attrs);
  if (gl) return { gl: gl, isGL2: true };
  gl = canvas.getContext('webgl', attrs);
  if (gl && gl.getExtension('OES_standard_derivatives')) return { gl: gl, isGL2: false };
  return null;
}

// Attribute 0 is always the vertex position, bound before linking so every
// program shares one layout and the manager never has to look it up.
export function createProgram(ctx, vsSrc, fsSrc) {
  var gl = ctx.gl;
  function compile(type, src, stage) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, prelude(ctx.isGL2, stage) + src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      var log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error(stage + ' shader failed to compile: ' + log);
    }
    return sh;
  }
  var vs = compile(gl.VERTEX_SHADER, vsSrc, 'vs');
  var fs = compile(gl.FRAGMENT_SHADER, fsSrc, 'fs');
  var prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.bindAttribLocation(prog, 0, 'aPos');
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error('shader program failed to link: ' + gl.getProgramInfoLog(prog));
  }
  var u = {};
  var count = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
  for (var i = 0; i < count; i++) {
    var name = gl.getActiveUniform(prog, i).name.replace(/\[0\]$/, '');
    u[name] = gl.getUniformLocation(prog, name);
  }
  return { prog: prog, u: u };
}

/* --- column-major 4x4 matrices ------------------------------------------ */
export function perspective(fovy, aspect, near, far) {
  var f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0
  ]);
}

export function translation(x, y, z) {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
}

// Rotation of `angle` radians about the axis (x, y, z), which need not be unit.
export function rotation(x, y, z, angle) {
  var len = Math.hypot(x, y, z) || 1;
  x /= len; y /= len; z /= len;
  var s = Math.sin(angle), c = Math.cos(angle), t = 1 - c;
  return new Float32Array([
    t * x * x + c,     t * x * y + s * z, t * x * z - s * y, 0,
    t * x * y - s * z, t * y * y + c,     t * y * z + s * x, 0,
    t * x * z + s * y, t * y * z - s * x, t * z * z + c,     0,
    0, 0, 0, 1
  ]);
}

export function multiply(a, b) {
  var o = new Float32Array(16);
  for (var col = 0; col < 4; col++) {
    for (var row = 0; row < 4; row++) {
      o[col * 4 + row] =
        a[row] * b[col * 4] + a[4 + row] * b[col * 4 + 1] +
        a[8 + row] * b[col * 4 + 2] + a[12 + row] * b[col * 4 + 3];
    }
  }
  return o;
}

// Left-to-right product: chain(A, B, C) is A·B·C, so C applies first.
export function chain() {
  var m = arguments[0];
  for (var i = 1; i < arguments.length; i++) m = multiply(m, arguments[i]);
  return m;
}

export function hexToRgb(hex) {
  var n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}

export function cssColorToRgb(value) {
  var m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(value || '');
  return m ? [m[1] / 255, m[2] / 255, m[3] / 255] : [0, 0, 0];
}
