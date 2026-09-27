import { createProgram } from './gl.js';

/* ===========================================================================
   Ink soaking into paper: a full-screen fill that spreads from one point with
   a wet, fingered edge, then settles into a flat, hole-free field of exactly
   the ink colour — so the section that takes over underneath it is already
   the same colour and the hand-off is invisible.
   =========================================================================== */

var VS = [
  'ATTR vec2 aPos;',
  'void main() { gl_Position = vec4(aPos, 0.0, 1.0); }'
].join('\n');

var FS = [
  'uniform vec2 uRes;',         // canvas, device px
  'uniform vec2 uOrigin;',      // 0..1, from the top-left
  'uniform float uReach;',      // origin to the farthest corner, aspect-corrected
  'uniform float uP;',
  'uniform float uTime;',
  'uniform vec3 uInk;',
  'uniform vec3 uRim;',
  'float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
  'float vnoise(vec2 p) {',
  '  vec2 i = floor(p), f = fract(p);',
  '  vec2 u = f * f * (3.0 - 2.0 * f);',
  '  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),',
  '             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);',
  '}',
  'float fbm(vec2 p) {',
  '  float v = 0.0, a = 0.5;',
  '  for (int i = 0; i < 5; i++) { v += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }',
  '  return v / 0.97;',
  '}',
  'void main() {',
  '  vec2 uv = gl_FragCoord.xy / uRes;',
  '  uv.y = 1.0 - uv.y;',
  '  vec2 asp = vec2(uRes.x / uRes.y, 1.0);',
  '  float r = length((uv - uOrigin) * asp) / uReach;',
  // A slowly flowing warp field drags the edge about, so it creeps like
  // liquid rather than growing as a clean circle.
  '  vec2 w = vec2(fbm(uv * 2.4 + uTime * 0.11), fbm(uv * 2.4 + 5.2 - uTime * 0.09)) - 0.5;',
  '  float edge = fbm((uv + w * 0.5) * asp * 3.2 + uTime * 0.05);',
  '  float fingers = 1.0 - abs(fbm((uv + w) * asp * 7.0) * 2.0 - 1.0);',
  // Wild while it spreads, then the distortion is let go so the last of the
  // paper is covered without leaving holes.
  '  float settle = 1.0 - smoothstep(0.55, 1.0, uP);',
  '  float reach = uP * 1.32 - 0.12;',
  '  float cov = reach - r + ((edge - 0.5) * 0.42 + (fingers - 0.5) * 0.14) * settle * clamp(r * 2.0, 0.0, 1.0);',
  '  float aa = 1.5 / uRes.y;',
  '  float a = smoothstep(-aa, aa, cov);',
  '  float rim = (1.0 - smoothstep(0.0, 0.06, cov)) * settle;',
  '  vec3 col = mix(uInk, uRim, rim * 0.55);',
  '  FRAG = vec4(col * a, a);',   // premultiplied
  '}'
].join('\n');

function program(fx) {
  if (!fx.cache.blot) fx.cache.blot = createProgram(fx.ctx, VS, FS);
  return fx.cache.blot;
}

// One oversized triangle covers the viewport with no diagonal seam.
function triangle(fx) {
  if (fx.cache.tri) return fx.cache.tri;
  var gl = fx.gl;
  var buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  return (fx.cache.tri = buf);
}

// Distance from the landing point to the farthest corner, aspect-corrected:
// the blot's radius is measured against it, so it always ends exactly as
// the last corner is covered.
function reachFrom(origin, aspect) {
  var reach = 0;
  [[0, 0], [1, 0], [0, 1], [1, 1]].forEach(function (k) {
    reach = Math.max(reach, Math.hypot((k[0] - origin[0]) * aspect, k[1] - origin[1]));
  });
  return reach;
}

export function createInkBlot(fx, opts) {
  var gl = fx.gl;
  var p = 0;
  var origin = [0.5, 0.5];

  var blot = {
    visible: false,
    // Mid-spread the edge keeps flowing even while the page is still.
    get animating() { return blot.visible && p > 0 && p < 1; },

    set: function (progress, o) { p = progress; if (o) origin = o; },

    // Whether the ink has reached (x, y) of a w × h stage — ignoring the
    // ragged edge, which is close enough for the header to choose its ink.
    covers: function (x, y, w, h) {
      if (p <= 0 || p >= 1) return false;
      var aspect = w / h;
      var r = Math.hypot((x / w - origin[0]) * aspect, y / h - origin[1]) / reachFrom(origin, aspect);
      return r < p * 1.32 - 0.12;
    },

    draw: function (size) {
      var prog = program(fx);
      var u = prog.u;
      var reach = reachFrom(origin, size.w / size.h);

      gl.useProgram(prog.prog);
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindBuffer(gl.ARRAY_BUFFER, triangle(fx));
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

      gl.uniform2f(u.uRes, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.uniform2f(u.uOrigin, origin[0], origin[1]);
      gl.uniform1f(u.uReach, reach);
      gl.uniform1f(u.uP, p);
      gl.uniform1f(u.uTime, performance.now() / 1000);
      gl.uniform3fv(u.uInk, opts.ink);
      gl.uniform3fv(u.uRim, opts.rim);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.disable(gl.BLEND);
    }
  };
  return blot;
}
