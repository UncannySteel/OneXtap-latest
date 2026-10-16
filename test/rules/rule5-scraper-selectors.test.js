/**
 * CLAUDE.md rule 5, structurally: both page scrapers start with the same
 * `const SELECTORS = {…}` literal and take every selector from it.
 *
 * scrapeJobPage() (extension/background.js) and scrapePageContext()
 * (public/content.js) cannot share code, so the next best thing is one literal
 * copied verbatim into both and compared here. A selector fix applied to one
 * copy only fails this test instead of drifting silently.
 *
 * The *Academic keys are scrapePageContext()'s alone, on purpose: it also
 * fills college and scholarship applications, and scrapeJobPage() scrapes job
 * pages, where a "school" class could be read as the employer.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { scrapeJobPage, scrapePageContext, walk } from './scrapers.js';

const DOM_QUERIES = new Set(['querySelector', 'querySelectorAll', 'closest', 'matches']);
const ACADEMIC = /Academic$/;
const SELECTORISH = /^[.#[]|\[[\w-]+[*^$~|]?=|^(article|main|meta)\b/;

/** Evaluate a literal-only AST node: strings, arrays of them, plain objects. */
function literalValue(node) {
  switch (node?.type) {
    case 'Literal':
      if (typeof node.value === 'string') return node.value;
      break;
    case 'TemplateLiteral':
      if (node.expressions.length === 0) return node.quasis[0].value.cooked;
      break;
    case 'ArrayExpression':
      return node.elements.map((el) => literalValue(el));
    case 'ObjectExpression':
      return Object.fromEntries(
        node.properties.map((prop) => {
          const key = prop.type === 'Property' && !prop.computed && prop.kind === 'init'
            ? (prop.key.type === 'Identifier' ? prop.key.name : prop.key.value)
            : null;
          if (typeof key !== 'string') throw new Error(`SELECTORS has a non-literal key at line ${prop.loc.start.line}`);
          return [key, literalValue(prop.value)];
        }),
      );
    default:
  }
  throw new Error(`SELECTORS may hold only strings, arrays and objects: found ${node?.type} at line ${node?.loc?.start.line}`);
}

/** The SELECTORS declaration that opens a scraper, its value, and the rest of the body. */
function readScraper({ node, file }) {
  const name = node.id.name;
  const [first, ...rest] = node.body.body;
  const decl = first?.type === 'VariableDeclaration' && first.kind === 'const' && first.declarations.length === 1
    ? first.declarations[0]
    : null;
  assert.ok(
    decl?.id.type === 'Identifier' && decl.id.name === 'SELECTORS' && decl.init?.type === 'ObjectExpression',
    `${file}: ${name}() must start with \`const SELECTORS = {…}\``,
  );
  return { name, file, value: literalValue(decl.init), rest };
}

/** Every SELECTORS.<key> the body reads, plus any other use of SELECTORS. */
function selectorUses(statements) {
  const keys = new Set();
  const otherUses = [];
  for (const statement of statements) {
    walk(statement, (node, parent) => {
      if (node.type !== 'Identifier' || node.name !== 'SELECTORS') return;
      if (parent?.type === 'MemberExpression' && parent.object === node && !parent.computed) {
        keys.add(parent.property.name);
      } else {
        otherUses.push(`line ${node.loc.start.line}`);
      }
    });
  }
  return { keys, otherUses };
}

/** Selector strings written outside SELECTORS, and DOM queries given a literal. */
function strayLiterals(statements, selectorStrings) {
  const stray = [];
  for (const statement of statements) {
    walk(statement, (node) => {
      if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression'
        && DOM_QUERIES.has(node.callee.property.name)) {
        const arg = node.arguments[0];
        if (arg?.type === 'Literal' || arg?.type === 'TemplateLiteral') {
          stray.push(`${node.callee.property.name}() given a literal at line ${node.loc.start.line}`);
        }
      }
      if (node.type === 'Literal' && typeof node.value === 'string'
        && (selectorStrings.has(node.value) || SELECTORISH.test(node.value))) {
        stray.push(`'${node.value}' at line ${node.loc.start.line}`);
      }
    });
  }
  return stray;
}

// Read inside each test, so a scraper that no longer opens with SELECTORS
// fails as a named test rather than as the whole file.
const SCRAPERS = { scrapeJobPage, scrapePageContext };
const read = (name) => readScraper(SCRAPERS[name]());

function allSelectors(value) {
  return new Set(Object.values(value).flat());
}

test('both scrapers open with the same SELECTORS literal', () => {
  assert.deepEqual(
    read('scrapeJobPage').value,
    read('scrapePageContext').value,
    'SELECTORS differs between extension/background.js and public/content.js: apply the change to both',
  );
});

test('SELECTORS holds only non-empty strings and non-empty lists of them', () => {
  for (const [key, value] of Object.entries(read('scrapeJobPage').value)) {
    const list = Array.isArray(value) ? value : [value];
    assert.ok(list.length > 0, `SELECTORS.${key} is empty`);
    for (const selector of list) {
      assert.ok(typeof selector === 'string' && selector.trim() !== '', `SELECTORS.${key} holds a non-string or blank entry`);
    }
  }
});

for (const name of Object.keys(SCRAPERS)) {
  test(`${name}() writes no selector outside SELECTORS`, () => {
    const scraper = read(name);
    assert.deepEqual(strayLiterals(scraper.rest, allSelectors(scraper.value)), []);
  });

  test(`${name}() reads SELECTORS only as SELECTORS.<key>`, () => {
    assert.deepEqual(selectorUses(read(name).rest).otherUses, []);
  });
}

test('scrapeJobPage() reads every job-board key and no *Academic key', () => {
  const jobPage = read('scrapeJobPage');
  const { keys } = selectorUses(jobPage.rest);
  const jobKeys = Object.keys(jobPage.value).filter((k) => !ACADEMIC.test(k)).sort();
  assert.deepEqual([...keys].filter((k) => ACADEMIC.test(k)), [], 'scrapeJobPage() must not read the academic selectors');
  assert.deepEqual([...keys].sort(), jobKeys);
});

test('scrapePageContext() reads every key, the academic ones included', () => {
  const pageContext = read('scrapePageContext');
  const { keys } = selectorUses(pageContext.rest);
  assert.deepEqual([...keys].sort(), Object.keys(pageContext.value).sort());
  assert.ok(Object.keys(pageContext.value).some((k) => ACADEMIC.test(k)), 'expected *Academic keys in SELECTORS');
});
