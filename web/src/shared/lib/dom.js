export var SVG_NS = 'http://www.w3.org/2000/svg';

export function el(tag, cls, text) {
  var n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
