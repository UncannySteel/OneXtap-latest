/* ===========================================================================
   Web fonts for snapshots. A section is snapshotted by rendering it inside an
   SVG image (snapshot.js), and an SVG image is sealed off from the page: it
   cannot see the page's web fonts. So every face has to travel inside it as
   a data: URL. This re-reads the Google Fonts stylesheet the page already
   links, keeps the latin faces — all the copy uses — and inlines them. The
   woff2 files are already in the HTTP cache from the page's own load.
   =========================================================================== */
var pending = null;

function toDataURL(blob) {
  return new Promise(function (resolve, reject) {
    var r = new FileReader();
    r.onload = function () { resolve(r.result); };
    r.onerror = function () { reject(r.error); };
    r.readAsDataURL(blob);
  });
}

function get(url, as) {
  return fetch(url, { mode: 'cors', credentials: 'omit' }).then(function (res) {
    if (!res.ok) throw new Error('font fetch ' + res.status + ' ' + url);
    return as === 'text' ? res.text() : res.blob();
  });
}

export function embeddedFontCSS() {
  if (pending) return pending;
  var link = document.querySelector('link[rel="stylesheet"][href*="fonts.googleapis.com"]');
  if (!link) return (pending = Promise.resolve(''));

  pending = get(link.href, 'text').then(function (css) {
    var faces = [], m;
    var re = /\/\*\s*([\w-]+)\s*\*\/\s*(@font-face\s*\{[^}]*\})/g;
    while ((m = re.exec(css))) if (m[1] === 'latin') faces.push(m[2]);

    var urlRe = /url\((['"]?)([^'")]+)\1\)/;
    var files = {};
    faces.forEach(function (f) { var u = urlRe.exec(f); if (u) files[u[2]] = null; });
    return Promise.all(Object.keys(files).map(function (url) {
      return get(url, 'blob').then(toDataURL).then(function (data) { files[url] = data; });
    })).then(function () {
      return faces.map(function (f) {
        return f.replace(urlRe, function (all, q, url) { return 'url(' + files[url] + ')'; });
      }).join('\n');
    });
  });
  // A failed fetch (offline, blocked) must not poison every later attempt.
  pending.catch(function () { pending = null; });
  return pending;
}
