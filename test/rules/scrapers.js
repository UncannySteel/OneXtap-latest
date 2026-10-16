/**
 * Shared helpers for the scraper rule tests (rules 5 and 9): pull the two
 * scraper functions out of their files with espree, and run them against a
 * stub document in a bare `vm` context.
 *
 * Not a test file: `npm test`'s glob only picks up *.test.js.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as espree from 'espree';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

export const BACKGROUND_FILE = 'extension/background.js';
export const CONTENT_FILE = 'public/content.js';

const PARSE = { ecmaVersion: 'latest', range: true, loc: true };

/** Depth-first walk over an ESTree node, calling visit(node, parent). */
export function walk(node, visit, parent = null) {
  if (!node || typeof node.type !== 'string') return;
  visit(node, parent);
  for (const key of Object.keys(node)) {
    if (key === 'parent') continue;
    const child = node[key];
    if (Array.isArray(child)) child.forEach((c) => walk(c, visit, node));
    else if (child && typeof child.type === 'string') walk(child, visit, node);
  }
}

/**
 * The FunctionDeclaration `name` in `file` (at any depth), with its source.
 *
 * @returns {{ node: object, source: string, file: string }}
 */
export function extractFunction(file, name, sourceType) {
  const text = readFileSync(path.join(repoRoot, file), 'utf8');
  const ast = espree.parse(text, { ...PARSE, sourceType });
  let found = null;
  walk(ast, (node) => {
    if (node.type === 'FunctionDeclaration' && node.id?.name === name) {
      if (found) throw new Error(`${file} declares ${name}() more than once`);
      found = node;
    }
  });
  if (!found) throw new Error(`${file} declares no ${name}()`);
  return { node: found, source: text.slice(found.range[0], found.range[1]), file };
}

export const scrapeJobPage = () => extractFunction(BACKGROUND_FILE, 'scrapeJobPage', 'module');
export const scrapePageContext = () => extractFunction(CONTENT_FILE, 'scrapePageContext', 'script');

// ------------------------------------------------------------------
// Stub document
// ------------------------------------------------------------------
function attr(el, name) {
  if (name === 'class') return el.className || '';
  if (name === 'id') return el.id || '';
  return el.attrs?.[name] ?? '';
}

/**
 * Match the selector forms the scrapers use. Anything else throws, so a new
 * form of selector extends this stub instead of silently matching nothing.
 */
function matches(el, selector) {
  let m;
  if ((m = /^\[([\w-]+)\*="([^"]+)" i\]$/.exec(selector))) {
    return attr(el, m[1]).toLowerCase().includes(m[2].toLowerCase());
  }
  if ((m = /^([a-z]+)\[([\w:-]+)="([^"]+)"\]$/.exec(selector))) {
    return el.tag === m[1] && attr(el, m[2]) === m[3];
  }
  if ((m = /^\.([\w-]+)$/.exec(selector))) return attr(el, 'class').split(/\s+/).includes(m[1]);
  if ((m = /^#([\w-]+)$/.exec(selector))) return el.id === m[1];
  if (/^[a-z]+$/.test(selector)) return el.tag === selector;
  throw new Error(`the stub document cannot match selector ${selector}; extend test/rules/scrapers.js`);
}

/**
 * A document with querySelector over a flat list of elements in document
 * order. Each element states its own innerText (descendants included, as a
 * browser would report it).
 *
 * @param {{ title?: string, body?: string|null, elements?: object[] }} page
 *   elements: { tag = 'div', id, className, attrs, innerText, content }
 */
export function stubDocument({ title = '', body = '', elements = [] } = {}) {
  const els = elements.map((e) => ({ tag: 'div', innerText: '', ...e }));
  return {
    title,
    body: body === null ? null : { innerText: body },
    querySelector(selector) {
      return els.find((el) => matches(el, selector)) ?? null;
    },
    querySelectorAll(selector) {
      return els.filter((el) => matches(el, selector));
    },
  };
}

/**
 * Run a scraper's source in a fresh context whose only global is `document`,
 * the way executeScript runs it: as a standalone function, nothing in scope.
 *
 * @returns {{ company: string, description: string }}
 */
export function runScraper(source, page) {
  const context = vm.createContext({ document: stubDocument(page) });
  const json = vm.runInContext(`JSON.stringify((${source})())`, context, { timeout: 2000 });
  return JSON.parse(json);
}
