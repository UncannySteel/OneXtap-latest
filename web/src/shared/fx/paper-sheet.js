import { createProgram, perspective, translation, rotation, chain } from './gl.js';

/* ===========================================================================
   A sheet of paper: a snapshot of a live section on a finely divided plane,
   bent in the vertex shader. Two ways to bend it —

   crumple  The sheet wraps around a ball whose curvature grows with
            progress, so it bends the way paper does (arc length is kept)
            instead of simply scaling down. Ridged noise, pinned to the
            paper rather than to the screen, raises the creases; the finished
            ball is then thrown clear of the frame.
   curl     A page peel: everything behind a moving fold line rolls round a
            cylinder and comes back over the page, showing the paper's back.

   Every deformation and every lighting term is exactly zero at progress 0,
   so the first WebGL frame is indistinguishable from the DOM it replaces.
   =========================================================================== */

var VS = [
  'ATTR vec2 aPos;',            // -0.5..0.5 grid, y up
  'uniform mat4 uProj;',
  'uniform mat4 uView;',
  'uniform mat4 uModel;',
  'uniform vec2 uSize;',        // sheet size, px
  'uniform float uP;',
  'uniform float uSeed;',
  'uniform float uReach;',      // half-diagonal, px
  'uniform vec2 uCurlDir;',
  'uniform vec2 uCurlOrigin;',
  'uniform float uCurlTravel;',
  'uniform float uRadius;',
  'VARY vec2 vUv;',
  'VARY vec3 vWorld;',
  'VARY vec3 vNormal;',         // analytic normal (the curl's smooth shading)
  'VARY float vOcc;',

  'vec2 hash2(vec2 p) {',
  '  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));',
  '  return fract(sin(p) * 43758.5453) * 2.0 - 1.0;',
  '}',
  // Gradient noise, roughly -0.7..0.7.
  'float gnoise(vec2 p) {',
  '  vec2 i = floor(p), f = fract(p);',
  '  vec2 u = f * f * (3.0 - 2.0 * f);',
  '  return mix(mix(dot(hash2(i), f), dot(hash2(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0)), u.x),',
  '             mix(dot(hash2(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0)),',
  '                 dot(hash2(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0)), u.x), u.y);',
  '}',
  // 1 on a crease line, falling away either side — a fold, not a hill.
  'float ridge(vec2 p) { return 1.0 - abs(gnoise(p) * 1.45); }',
  'mat2 rot(float a) { float s = sin(a), c = cos(a); return mat2(c, s, -s, c); }',

  '#ifdef CRUMPLE',
  // Straight fold lines across the sheet, each bending it into a sharp V
  // that flattens out a little way either side. Summed, they give the flat
  // facets and hard ridges of paper that has really been screwed up —
  // noise alone only ever makes it look like cloth.
  'float folds(vec2 m, out float valley) {',
  '  float z = 0.0;',
  '  valley = 0.0;',
  '  for (int i = 0; i < 9; i++) {',
  '    float fi = float(i) + 1.0;',
  '    float a = fract(sin(fi * 12.9898 + uSeed * 4.1) * 43758.5453) * 3.14159;',
  '    float o = (fract(sin(fi * 78.233 + uSeed) * 12345.678) - 0.5) * 1.5;',
  '    float w = 0.16 + 0.3 * fract(sin(fi * 39.35 + uSeed * 2.3) * 9631.17);',
  '    float s = abs(dot(m, vec2(cos(a), sin(a))) - o);',
  '    float side = mod(fi, 2.0) * 2.0 - 1.0;',   // ridges and valleys alternate
  '    z += side * (min(s, w) - w) / (1.0 + fi * 0.18);',
  '    valley = max(valley, (1.0 - s / w) * step(0.0, side));',
  '  }',
  '  return z;',
  '}',
  'vec3 deform(vec2 q, out float occ) {',
  '  float p = uP;',
  '  float r = length(q);',
  '  vec2 dir = r > 0.001 ? q / r : vec2(0.0, 1.0);',
  '  vec2 m = q / uReach;',
  '  float crease = ridge(m * 2.4 + uSeed) * 0.6 + ridge(rot(1.1) * m * 5.8 + uSeed * 1.9) * 0.4;',
  '  float valley;',
  '  float fold = folds(m, valley);',
  // Gathered toward the middle, unevenly, so the outline goes ragged early.
  '  float gather = smoothstep(0.0, 1.0, p);',
  '  float lobe = gnoise(dir * 1.6 + uSeed * 3.1) + 0.6 * gnoise(dir * 4.3 - uSeed);',
  '  float rc = r * mix(1.0, 0.34 + lobe * 0.16, gather) * (1.0 - 0.1 * smoothstep(0.0, 0.3, p) * (lobe + 0.5));',
  // Wrapped round a ball that tightens with p. Late, so the sheet is folded
  // and crushed first and only then balled — not bulged like a screen.
  '  float k = pow(p, 1.8) * 2.95 / (uReach * 0.34);',
  '  vec3 pos = vec3(q, 0.0);',
  '  vec3 nrm = vec3(0.0, 0.0, 1.0);',
  '  if (k > 1e-7) {',
  '    float a = k * rc;',
  '    float h = sin(a * 0.5);',
  '    pos = vec3(dir * (sin(a) / k), -2.0 * h * h / k);',
  '    nrm = vec3(dir * sin(a), cos(a));',
  '  } else {',
  '    pos = vec3(dir * rc, 0.0);',
  '  }',
  // Fine creases come in late: early on the broad folds carry the look, and
  // fine detail across a still-large sheet only shows off the mesh.
  '  float amp = uReach * 0.085 * smoothstep(0.12, 0.7, p);',
  '  float famp = uReach * 0.26 * smoothstep(0.0, 0.28, p) * (1.0 - 0.45 * gather);',
  '  pos += nrm * ((crease - 0.55) * amp + fold * famp);',
  '  pos.xy += vec2(gnoise(m * 4.1 + 7.3), gnoise(m * 4.1 - 3.7)) * amp * 0.9 * gather;',
  '  occ = mix(1.0, (0.6 + 0.4 * crease) * (1.0 - 0.35 * valley), smoothstep(0.03, 0.4, p));',
  '  vNormal = nrm;',
  '  return pos;',
  '}',
  '#else',
  'vec3 deform(vec2 q, out float occ) {',
  '  float f = uP * uCurlTravel;',            // fold line, measured from the corner
  '  float d = dot(q - uCurlOrigin, uCurlDir);',
  '  float a = f - d;',                        // > 0: already lifted
  '  float R = uRadius;',
  '  vec3 pos = vec3(q, 0.0);',
  '  vNormal = vec3(0.0, 0.0, 1.0);',
  '  occ = 1.0;',
  '  if (a > 0.0) {',
  '    float th = min(a / R, 3.14159265);',
  '    float nd = a / R < 3.14159265 ? f - R * sin(th) : f + (a - 3.14159265 * R);',
  '    pos.z = R * (1.0 - cos(th));',
  '    pos.xy = q + uCurlDir * (nd - d);',
  // The printed face turns in toward the roll's axis as it goes round.
  '    vNormal = vec3(uCurlDir * sin(th), cos(th));',
  '  } else if (uP > 0.0) {',
  // The roll's own shadow, on the flat page just ahead of the fold.
  '    float s = clamp(-a / (R * 2.2), 0.0, 1.0);',
  '    occ = mix(0.68, 1.0, s * s * (3.0 - 2.0 * s));',
  '  }',
  '  return pos;',
  '}',
  '#endif',

  'void main() {',
  '  vec2 q = aPos * uSize;',
  '  vUv = aPos + 0.5;',
  '  float occ;',
  '  vec3 p = deform(q, occ);',
  '  vec4 w = uModel * vec4(p, 1.0);',
  '  vWorld = w.xyz;',
  '  vOcc = occ;',
  '  gl_Position = uProj * uView * w;',
  '}'
].join('\n');

var FS = [
  'uniform sampler2D uTex;',
  'uniform vec3 uBack;',        // colour of the paper's reverse
  'uniform vec3 uEye;',
  'VARY vec2 vUv;',
  'VARY vec3 vWorld;',
  'VARY vec3 vNormal;',
  'VARY float vOcc;',
  'float grain(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }',
  'void main() {',
  '#ifdef CRUMPLE',
  // Per-triangle normal from screen-space derivatives: the hard-edged
  // facets of creased paper come for free, and nothing has to be stored.
  '  vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));',
  '#else',
  // A curl is one smooth bend, so it gets the smooth normal instead.
  '  vec3 n = normalize(vNormal);',
  '#endif',
  '  vec3 V = normalize(uEye - vWorld);',
  '  if (dot(n, V) < 0.0) n = -n;',
  '  vec3 L = normalize(vec3(-0.42, 0.55, 0.72));',
  // Everything below is relative to a flat sheet facing the camera, and
  // scaled by how far this facet has turned from flat — so an untouched
  // sheet renders as exactly the snapshot, grain and gloss included.
  '  float bend = clamp(1.0 - n.z, 0.0, 1.0);',
  '  float diffuse = dot(n, L) - L.z;',
  '  float spec = pow(max(dot(n, normalize(L + V)), 0.0), 30.0) * bend;',
  '  float g = (grain(floor(vUv * 900.0)) - 0.5) * 0.06 * min(bend * 4.0, 1.0);',
  '  vec3 base = gl_FrontFacing ? TEX(uTex, vUv).rgb : uBack;',
  // Shade alone cannot show a fold on near-black paper — a fraction of
  // almost nothing is still almost nothing. Dark paper shows its creases as
  // sheen on the facets that catch the light; light paper stays matte.
  '  float lum = dot(base, vec3(0.299, 0.587, 0.114));',
  '  vec3 sheen = vec3(0.93, 0.95, 0.88) * (max(diffuse, 0.0) * mix(0.3, 0.04, lum) + spec * mix(0.22, 0.05, lum));',
  '  vec3 col = base * (1.0 + diffuse * 1.35 + g) * vOcc + sheen;',
  '  FRAG = vec4(col, 1.0);',
  '}'
].join('\n');

function program(fx, mode) {
  var key = 'paper-' + mode;
  if (!fx.cache[key]) {
    var define = mode === 'crumple' ? '#define CRUMPLE\n' : '';
    fx.cache[key] = createProgram(fx.ctx, define + VS, define + FS);
  }
  return fx.cache[key];
}

// A unit grid, shared by every sheet with the same subdivision. Positions are
// normalised so the same buffers serve any sheet size.
function grid(fx, cols, rows) {
  var key = 'grid-' + cols + 'x' + rows;
  if (fx.cache[key]) return fx.cache[key];
  var gl = fx.gl;
  var verts = new Float32Array((cols + 1) * (rows + 1) * 2);
  var v = 0;
  for (var j = 0; j <= rows; j++) {
    for (var i = 0; i <= cols; i++) {
      verts[v++] = i / cols - 0.5;
      verts[v++] = j / rows - 0.5;
    }
  }
  var idx = new Uint16Array(cols * rows * 6);
  var k = 0;
  for (var y = 0; y < rows; y++) {
    for (var x = 0; x < cols; x++) {
      var a = y * (cols + 1) + x, b = a + 1, c = a + cols + 1, d = c + 1;
      // Counter-clockwise seen from the camera: the printed side is the front.
      idx[k++] = a; idx[k++] = b; idx[k++] = d;
      idx[k++] = a; idx[k++] = d; idx[k++] = c;
    }
  }
  var vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
  var ibo = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
  return (fx.cache[key] = { vbo: vbo, ibo: ibo, count: idx.length });
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

// WebGL 1 only mipmaps power-of-two textures, and without mipmaps a sheet
// balled up to a few hundred pixels shimmers. Stretching into a POT canvas
// costs nothing visible — UVs are normalised.
function toPow2(src, max) {
  var w = Math.min(max, Math.pow(2, Math.round(Math.log2(src.width))));
  var h = Math.min(max, Math.pow(2, Math.round(Math.log2(src.height))));
  if (w === src.width && h === src.height) return src;
  var c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(src, 0, 0, w, h);
  return c;
}

var CRUMPLE_END = 0.8;   // the ball is fully formed here…
var TOSS_START = 0.62;   // …and already on its way out from here

function smooth(t) { return t * t * (3 - 2 * t); }

// The peel's geometry, shared by the shader uniforms and covers() so the
// two can never disagree: it starts at the bottom-right corner and travels
// toward the top-left until the rolled page is clear of the far corner.
function curlGeometry(rect) {
  var dir = [-0.92, 0.39];
  var ox = rect.w / 2, oy = -rect.h / 2;
  var far = 0;
  [[-1, -1], [-1, 1], [1, 1], [1, -1]].forEach(function (k) {
    far = Math.max(far, (k[0] * rect.w / 2 - ox) * dir[0] + (k[1] * rect.h / 2 - oy) * dir[1]);
  });
  var radius = Math.min(rect.w, rect.h) * 0.12;
  return { dir: dir, ox: ox, oy: oy, radius: radius, travel: far + Math.PI * radius + 60 };
}

export function createPaperSheet(fx, opts) {
  var gl = fx.gl;
  var mode = opts.mode;
  var tex = null;
  var rect = null;        // sheet rect within the canvas, CSS px
  var p = 0;

  var sheet = {
    ready: false,
    visible: false,
    animating: false,

    setTexture: function (canvas, r) {
      if (!tex) tex = gl.createTexture();
      var src = fx.ctx.isGL2 ? canvas : toPow2(canvas, gl.getParameter(gl.MAX_TEXTURE_SIZE));
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      var aniso = gl.getExtension('EXT_texture_filter_anisotropic');
      if (aniso) {
        gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT,
          Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
      }
      rect = r;
      sheet.ready = true;
    },

    set: function (progress) { p = progress; },

    /* Roughly whether the sheet is drawn over (x, y) — stage-local CSS px —
       so the fixed header can pick its ink for what is really behind it.
       Exact for the peel; for the crumple, a disc that shrinks as the ball
       forms, which is all the header needs. */
    covers: function (x, y) {
      if (!rect || p <= 0 || p >= 1) return false;
      var qx = x - (rect.x + rect.w / 2), qy = (rect.y + rect.h / 2) - y;
      if (mode === 'crumple') {
        var c = clamp01(p / CRUMPLE_END);
        return Math.hypot(qx, qy) < Math.hypot(rect.w, rect.h) / 2 * (1 - 1.5 * c);
      }
      var g = curlGeometry(rect);
      var d = (qx - g.ox) * g.dir[0] + (qy - g.oy) * g.dir[1];
      return d > smooth(p) * g.travel - g.radius;
    },

    draw: function (size) {
      if (!tex || !rect) return;
      var W = size.w, H = size.h;
      var prog = program(fx, mode);
      // ~12px cells: fine enough that a crease reads as a fold rather than
      // as the zigzag of the triangles it cuts across.
      var mesh = grid(fx,
        Math.max(24, Math.min(160, Math.round(rect.w / 12))),
        Math.max(24, Math.min(160, Math.round(rect.h / 12))));

      // A camera placed so the z = 0 plane maps 1:1 onto the canvas.
      var fov = 30 * Math.PI / 180;
      var dist = (H / 2) / Math.tan(fov / 2);
      var reach = Math.hypot(rect.w, rect.h) / 2;
      var cx = rect.x + rect.w / 2 - W / 2;
      var cy = H / 2 - (rect.y + rect.h / 2);

      var u = prog.u, model, shaderP;
      if (mode === 'crumple') {
        var c = clamp01(p / CRUMPLE_END);
        var t = clamp01((p - TOSS_START) / (1 - TOSS_START));
        var te = t * t;                             // thrown: it accelerates away
        var R = reach * 0.115;                      // the finished ball's radius
        var toss = opts.toss || [1, 0.5];
        var spin = opts.spin || 1;
        model = chain(
          translation(
            cx + te * (W * 0.62 + R * 3) * toss[0],
            cy + te * (H * 0.55 + R * 3) * toss[1] + Math.sin(t * Math.PI) * H * 0.1,
            -te * dist * 0.35),
          translation(0, 0, -R),
          rotation(0, 0, 1, c * 0.32 * spin),
          rotation(1, 0, 0, c * 0.5),
          rotation(0.35, 1, 0.2, t * 7.5 * spin),
          translation(0, 0, R));
        shaderP = c;
      } else {
        var g = curlGeometry(rect);
        gl.useProgram(prog.prog);
        gl.uniform2f(u.uCurlDir, g.dir[0], g.dir[1]);
        gl.uniform2f(u.uCurlOrigin, g.ox, g.oy);
        gl.uniform1f(u.uCurlTravel, g.travel);
        gl.uniform1f(u.uRadius, g.radius);
        model = translation(cx, cy, 0);
        shaderP = smooth(p);
      }

      gl.useProgram(prog.prog);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.BLEND);

      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vbo);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.ibo);

      gl.uniformMatrix4fv(u.uProj, false, perspective(fov, W / H, dist * 0.1, dist * 6));
      gl.uniformMatrix4fv(u.uView, false, translation(0, 0, -dist));
      gl.uniformMatrix4fv(u.uModel, false, model);
      gl.uniform2f(u.uSize, rect.w, rect.h);
      gl.uniform1f(u.uP, shaderP);
      if (u.uSeed) gl.uniform1f(u.uSeed, opts.seed || 0);
      if (u.uReach) gl.uniform1f(u.uReach, reach);
      gl.uniform3fv(u.uBack, opts.back);
      gl.uniform3f(u.uEye, 0, 0, dist);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(u.uTex, 0);
      gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0);
    },

    dispose: function () {
      if (tex && fx.ok) gl.deleteTexture(tex);
      tex = null;
      sheet.ready = false;
      sheet.visible = false;
    }
  };
  return sheet;
}
