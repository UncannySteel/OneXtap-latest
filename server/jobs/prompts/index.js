/**
 * The versioned prompt library.
 *
 * ═══ WHY VERSIONS LIVE HERE AND NOT IN THE MARKDOWN ═══
 *
 * Every prompt has a version, and that version is attached to the LLM span as
 * metadata. That is the entire reason the versioning exists: when answer
 * quality moves, the only way to attribute the move to a prompt revision
 * rather than to a model change, a data change, or chance is to have recorded
 * which revision produced each traced call.
 *
 * The number lives in this file rather than in a front-matter block inside the
 * .md, so that editing a prompt and bumping its version are a single reviewable
 * diff in a single file that a reviewer is already looking at. A version
 * embedded in the prompt text is a version people forget to bump, and an
 * unbumped version is worse than no version — it silently attributes new
 * behaviour to the old revision.
 *
 * BUMP THE VERSION WHENEVER THE TEXT CHANGES in a way that could move output.
 * Typo fixes do not need it; a changed instruction does.
 *
 * ═══ LOADING ═══
 *
 * Prompts are read from disk once and memoized for the life of the process.
 * On a serverless runtime that means once per cold start, which is the right
 * trade for files of this size.
 *
 * The paths are built from import.meta.url so the .md files are resolved
 * relative to this module rather than to process.cwd() — a Vercel function's
 * working directory is not the directory it was bundled from.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Absolute path of this directory. Exported so tests can list the .md files. */
export const PROMPTS_DIR = fileURLToPath(new URL('./', import.meta.url));

/**
 * Prompt name -> version. One entry per .md file in this directory; a test
 * asserts that correspondence in both directions, so adding a prompt without
 * a version (or a version without a prompt) fails the build.
 *
 * @type {Readonly<Record<string, number>>}
 */
export const PROMPT_VERSIONS = Object.freeze({
  rank: 4,
  reformulate: 2,
  explain: 2,
  suggest_tailoring: 2,
});

/** name -> file text, filled on first getPrompt() for that name. */
const cache = new Map();

/**
 * Load one prompt.
 *
 * @param {string} name One of the keys of PROMPT_VERSIONS.
 * @returns {{name: string, version: number, text: string}}
 * @throws {Error} On an unknown name, or on an unreadable file. Both are
 *   programmer errors — a prompt name is a literal in our own source, never
 *   user input — so they throw rather than degrade. A caller that silently
 *   fell back to an empty prompt would send a request with no instructions
 *   and get back plausible nonsense.
 */
export function getPrompt(name) {
  // hasOwn, not a bare lookup: without it 'toString' and 'constructor' reach
  // Object.prototype and would have to be rejected by the type check below as
  // a side effect rather than on purpose.
  const version = Object.hasOwn(PROMPT_VERSIONS, name) ? PROMPT_VERSIONS[name] : undefined;
  if (typeof version !== 'number') {
    const known = Object.keys(PROMPT_VERSIONS).join(', ');
    throw new Error(`Unknown prompt "${name}". Known prompts: ${known}`);
  }

  let text = cache.get(name);
  if (text === undefined) {
    try {
      text = readFileSync(new URL(`./${name}.md`, import.meta.url), 'utf8');
    } catch (err) {
      throw new Error(`Prompt "${name}" is versioned but unreadable: ${err?.message || err}`);
    }
    cache.set(name, text);
  }

  return { name, version, text };
}

export default getPrompt;
