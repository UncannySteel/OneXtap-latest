import { embeddedFontCSS } from './font-embed.js';

/* ===========================================================================
   DOM → canvas. No API paints an element into a canvas, but an SVG image can
   carry HTML inside <foreignObject>, and the browser renders that with its
   own engine — pseudo-elements, masks, variable fonts and all. So a section
   is cloned (inside empty shells of its ancestors, so every selector still
   matches), wrapped with the page's stylesheets and fonts, serialised into
   an SVG, loaded as an image and drawn into a canvas the GPU can use.

   Two steps, because they have different timing needs: capture() is
   synchronous and must run at the exact moment the section looks right;
   render() is slow and asynchronous and can happen whenever.
   =========================================================================== */

var XHTML = 'http://www.w3.org/1999/xhtml';

// An image is one frame: anything that moves is frozen where it stands.
var FREEZE = '*,*::before,*::after{animation:none!important;transition:none!important}';

// The page's own rules. Cross-origin sheets (the Google Fonts link) refuse to
// be read and are skipped; their faces arrive through embeddedFontCSS().
function pageCSS() {
  var out = [];
  for (var i = 0; i < document.styleSheets.length; i++) {
    var rules;
    try { rules = document.styleSheets[i].cssRules; } catch (e) { continue; }
    if (!rules) continue;
    for (var j = 0; j < rules.length; j++) out.push(rules[j].cssText);
  }
  return out.join('\n');
}

// Viewport units as they are right now — measured, not assumed: 100vw
// includes a classic scrollbar, and on phones svh, dvh and lvh all differ.
function measureViewport() {
  var probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;visibility:hidden;pointer-events:none';
  document.body.appendChild(probe);
  var box = probe.getBoundingClientRect();
  var units = { vw: box.width, vh: box.height };
  probe.style.height = '100svh';
  units.svh = probe.getBoundingClientRect().height;
  probe.style.height = '100dvh';
  units.dvh = probe.getBoundingClientRect().height;
  probe.remove();
  return units;
}

// Inside the image there are no toolbars, so svh/dvh/lvh would all collapse
// to its height. Pin them to what they measure on the page.
function pinViewportUnits(css, units) {
  return css.replace(/(-?\d*\.?\d+)(svh|dvh|lvh)\b/g, function (all, n, unit) {
    var base = unit === 'svh' ? units.svh : unit === 'dvh' ? units.dvh : units.vh;
    return (parseFloat(n) * base / 100).toFixed(2) + 'px';
  });
}

/* Clones `el` as it looks at this instant. `frame` is the element the
   snapshot is cropped to (the stage): it is pinned to its live pixel size so
   the layout inside the image is the layout on screen. */
export function capture(el, frame) {
  var frameRect = frame.getBoundingClientRect();
  var elRect = el.getBoundingClientRect();
  var tree = el.cloneNode(true);
  tree.querySelectorAll('canvas, video, iframe, script').forEach(function (n) { n.remove(); });

  for (var a = el.parentElement; a && a !== document.body; a = a.parentElement) {
    var shell = a.cloneNode(false);
    if (a === frame) {
      shell.style.width = frameRect.width + 'px';
      shell.style.height = frameRect.height + 'px';
    }
    shell.appendChild(tree);
    tree = shell;
  }

  var body = getComputedStyle(document.body);
  return {
    tree: tree,
    units: measureViewport(),
    frame: { x: frameRect.left, y: frameRect.top },
    rect: {
      x: elRect.left - frameRect.left, y: elRect.top - frameRect.top,
      w: elRect.width, h: elRect.height
    },
    bodyStyle: [
      'font-family:' + body.fontFamily, 'font-size:' + body.fontSize,
      'line-height:' + body.lineHeight, 'color:' + body.color,
      '-webkit-font-smoothing:antialiased'
    ].join(';')
  };
}

function loadImage(src) {
  return new Promise(function (resolve, reject) {
    var img = new Image();
    img.onload = function () { resolve(img); };
    img.onerror = function () { reject(new Error('snapshot: SVG image failed to load')); };
    img.src = src;
  });
}

function nextFrame() {
  return new Promise(function (resolve) { requestAnimationFrame(function () { resolve(); }); });
}

/* Resolves to { canvas, rect }: the element drawn at `scale` device pixels
   per CSS pixel, and its rect within the frame. */
export function render(shot, opts) {
  var fontsReady = document.fonts && document.fonts.ready ? document.fonts.ready : null;
  return Promise.all([embeddedFontCSS(), fontsReady]).then(function (res) {
    var W = shot.units.vw, H = shot.units.vh;
    // The SVG's own viewport is the page's viewport, so vw, vh and every
    // media query resolve inside the image exactly as they do on the page.
    var root = document.createElementNS(XHTML, 'div');
    root.setAttribute('style', 'margin:0;position:relative;overflow:hidden;width:' + W +
      'px;height:' + H + 'px;' + shot.bodyStyle);
    var style = document.createElementNS(XHTML, 'style');
    style.textContent = res[0] + '\n' + pinViewportUnits(pageCSS(), shot.units) + '\n' + FREEZE;
    root.appendChild(style);
    // The frame sits wherever it sits in the viewport (normally 0,0).
    var offset = document.createElementNS(XHTML, 'div');
    offset.setAttribute('style', 'position:absolute;left:' + shot.frame.x + 'px;top:' + shot.frame.y + 'px;width:100%');
    offset.appendChild(shot.tree);
    root.appendChild(offset);

    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '">' +
      '<foreignObject x="0" y="0" width="100%" height="100%">' +
      new XMLSerializer().serializeToString(root) + '</foreignObject></svg>';
    return loadImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg));
  }).then(function (img) {
    // WebKit can report the image loaded a beat before its fonts are laid
    // out inside it; one frame is enough for them to land.
    return nextFrame().then(function () { return img; });
  }).then(function (img) {
    var r = shot.rect;
    var scale = Math.min(opts.scale, opts.maxSize / Math.max(r.w, r.h));
    var canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(r.w * scale));
    canvas.height = Math.max(1, Math.round(r.h * scale));
    canvas.getContext('2d').drawImage(img,
      shot.frame.x + r.x, shot.frame.y + r.y, r.w, r.h,
      0, 0, canvas.width, canvas.height);
    return { canvas: canvas, rect: r };
  });
}
