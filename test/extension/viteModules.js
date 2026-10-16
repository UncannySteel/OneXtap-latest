/**
 * Lets `node --test` import the modules Vite bundles: src/extensionClient.js,
 * src/resumeParse.js and extension/background.js. Not a test file (the glob
 * only picks up *.test.js).
 *
 * Bare Node cannot load them as they are, for two reasons:
 *   - src/ imports its siblings with no file extension ('./config'), which
 *     Vite resolves and Node's ESM loader does not;
 *   - src/config.js and the worker read `import.meta.env` at module scope,
 *     which Vite fills in at build time and is undefined in Node.
 *
 * So, for files under src/ and extension/ only, a resolve hook tries '.js'
 * after an extensionless relative specifier, and a load hook prefixes the
 * source with `import.meta.env = TEST_ENV` (on its first line, so stack line
 * numbers still match the file). `stubModule()` swaps a src/ module for a
 * stand-in before anything imports it.
 *
 * Call registerViteModules() before the first dynamic import(). Each test file
 * runs in its own process, so the hooks never leak into other files.
 */
import * as nodeModule from 'node:module';

const ROOT = new URL('../../', import.meta.url);
const SCOPES = [new URL('src/', ROOT).href, new URL('extension/', ROOT).href];
const inScope = (url) => typeof url === 'string' && SCOPES.some((s) => url.startsWith(s));

/**
 * What `import.meta.env` holds in the loaded modules. Every address is
 * unresolvable (.invalid, RFC 2606): a call a test forgot to stub fails
 * instead of reaching a real service. VITE_LOG_LEVEL keeps the loggers to
 * errors, which the tests that expect them silence.
 */
export const TEST_ENV = Object.freeze({
  VITE_API_URL: 'https://api.test.invalid',
  VITE_SUPABASE_URL: 'https://supabase.test.invalid',
  VITE_SUPABASE_ANON_KEY: 'test-anon-key',
  VITE_DASHBOARD_URL: 'https://www.onextap.com',
  VITE_LOG_LEVEL: 'error',
  MODE: 'test',
  DEV: false,
  PROD: false,
});

const stubs = new Map();
let registered = false;

/** `registerHooks` arrived in Node 22.15 / 23.5; older Nodes skip these tests. */
export const canLoadViteModules = typeof nodeModule.registerHooks === 'function';

export function registerViteModules() {
  if (registered) return;
  if (!canLoadViteModules) throw new Error('module.registerHooks is not available in this Node');
  registered = true;
  globalThis.__ONEXTAP_TEST_ENV__ = TEST_ENV;
  nodeModule.registerHooks({
    resolve(specifier, context, nextResolve) {
      let resolved;
      if (inScope(context.parentURL) && specifier.startsWith('.') && !/\.[cm]?jsx?$/.test(specifier)) {
        try {
          resolved = nextResolve(`${specifier}.js`, context);
        } catch {
          resolved = null;
        }
      }
      resolved = resolved || nextResolve(specifier, context);
      const stub = stubs.get(resolved.url);
      return stub ? { url: stub, format: 'module', shortCircuit: true } : resolved;
    },
    load(url, context, nextLoad) {
      const loaded = nextLoad(url, context);
      if (!inScope(url) || loaded.format !== 'module') return loaded;
      const source = `import.meta.env = globalThis.__ONEXTAP_TEST_ENV__;${String(loaded.source)}`;
      return { ...loaded, source, shortCircuit: true };
    },
  });
}

/**
 * Serve `stand-in` wherever `repoPath` (e.g. 'src/auth.js') is imported.
 * Both are paths relative to the repo root.
 */
export function stubModule(repoPath, standIn) {
  stubs.set(new URL(repoPath, ROOT).href, new URL(standIn, ROOT).href);
}
