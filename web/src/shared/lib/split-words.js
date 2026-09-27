/* --- split headlines into masked words -------------------------------- */
export function splitWords(el) {
  var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
  var nodes = [], n;
  while ((n = walker.nextNode())) { if (n.nodeValue.trim()) nodes.push(n); }
  nodes.forEach(function (node) {
    var frag = document.createDocumentFragment();
    node.nodeValue.split(/(\s+)/).forEach(function (chunk) {
      if (!chunk) return;
      if (/^\s+$/.test(chunk)) { frag.appendChild(document.createTextNode(' ')); return; }
      var outer = document.createElement('span'); outer.className = 'w';
      var inner = document.createElement('span'); inner.className = 'wi';
      inner.textContent = chunk;
      outer.appendChild(inner); frag.appendChild(outer);
    });
    node.parentNode.replaceChild(frag, node);
  });
  return el.querySelectorAll('.wi');
}
