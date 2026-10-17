/**
 * The store build's manifest (completion plan B3-C, D10).
 *
 * extension/manifest.json is the dev manifest: it lists the website dev
 * server (http://localhost:5173) in host_permissions and
 * externally_connectable, and the local API (http://localhost:3001) in
 * host_permissions. A release build (`ONEXTAP_RELEASE=1`, which
 * `npm run build:release` sets) drops those entries and writes to
 * dist-release/, so the zip uploaded to the store never lists them. Dev
 * builds get the manifest exactly as it is, into dist/.
 *
 * The worker's site allowlist is the manifest's externally_connectable, read
 * at run time (extension/messages/senders.js), so dropping the entry here
 * narrows it with no code change.
 *
 * checkReleaseManifest() is step 4 of build:release. The lists it compares
 * against are pinned, not derived from extension/manifest.json, so widening
 * the dev manifest also fails the release check instead of slipping into the
 * store build. Store 1.0.2's permissions, host permissions and
 * externally_connectable match the repo's manifest, localhost entries
 * included (plan §2), so these are 1.0.2's minus localhost. Changing them is a
 * permission change: CLAUDE.md, Escalate.
 *
 * Pure, no I/O: vite.config.js and the unit tests import it.
 */

/** The version build:release ships. Bump it with extension/manifest.json. */
export const RELEASE_VERSION = '1.0.4';

export const RELEASE_PERMISSIONS = Object.freeze(['storage', 'activeTab', 'scripting', 'identity']);

export const RELEASE_HOST_PERMISSIONS = Object.freeze([
  'https://*.supabase.co/*',
  'https://www.onextap.com/*',
  'https://onextap.com/*',
]);

export const RELEASE_EXTERNALLY_CONNECTABLE = Object.freeze([
  'https://www.onextap.com/*',
  'https://onextap.com/*',
]);

export const RELEASE_OUT_DIR = 'dist-release';
const DEV_OUT_DIR = 'dist';

/** A host that resolves to this machine: localhost, *.localhost, 127/8, ::1. */
function isLocalHost(host) {
  const h = String(host || '').toLowerCase();
  return h === 'localhost' || h.endsWith('.localhost') || /^127(\.\d{1,3}){3}$/.test(h) || h === '[::1]';
}

/**
 * True when a match pattern (or URL) points at this machine.
 * @param {string} pattern e.g. 'http://localhost:5173/*'
 */
export function isLocalPattern(pattern) {
  const m = /^[^:/]+:\/\/(\[[^\]]*\]|[^/:]*)/.exec(String(pattern ?? ''));
  return !!m && isLocalHost(m[1]);
}

const withoutLocal = (list) => list.filter((pattern) => !isLocalPattern(pattern));

/**
 * The manifest a release build ships: the same, minus every localhost entry
 * in host_permissions and externally_connectable.matches. Never mutates its
 * input (vite.config.js passes the imported JSON).
 */
export function releaseManifest(manifest) {
  const release = structuredClone(manifest);
  if (Array.isArray(release.host_permissions)) {
    release.host_permissions = withoutLocal(release.host_permissions);
  }
  if (Array.isArray(release.externally_connectable?.matches)) {
    release.externally_connectable.matches = withoutLocal(release.externally_connectable.matches);
  }
  return release;
}

/**
 * What vite.config.js builds: the release manifest into dist-release/ when
 * `ONEXTAP_RELEASE` is exactly '1', otherwise the manifest untouched into
 * dist/ (so `npm run build` and `npm run dev:extension` do not change).
 *
 * @param {object} manifest extension/manifest.json
 * @param {Record<string, string|undefined>} env process.env
 * @returns {{ release: boolean, manifest: object, outDir: string }}
 */
export function extensionBuild(manifest, env) {
  const release = env?.ONEXTAP_RELEASE === '1';
  return release
    ? { release, manifest: releaseManifest(manifest), outDir: RELEASE_OUT_DIR }
    : { release, manifest, outDir: DEV_OUT_DIR };
}

/** One list compared against its pinned value, as problem strings. */
function compareList(label, actual, expected) {
  if (!Array.isArray(actual)) return [`${label} is missing; expected exactly ${expected.join(', ')}`];
  const problems = [];
  const extra = actual.filter((item) => !expected.includes(item));
  const missing = expected.filter((item) => !actual.includes(item));
  const local = extra.filter(isLocalPattern);
  if (local.length) problems.push(`${label} has localhost entries: ${local.join(', ')}`);
  const other = extra.filter((item) => !isLocalPattern(item));
  if (other.length) problems.push(`${label} has entries 1.0.2 does not: ${other.join(', ')}`);
  if (missing.length) problems.push(`${label} is missing ${missing.join(', ')}`);
  if (!extra.length && !missing.length && actual.length !== expected.length) {
    problems.push(`${label} lists an entry twice`);
  }
  return problems;
}

/** Every string in a JSON value. */
function strings(value) {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
}

/**
 * build:release step 4: the built manifest against the pinned release.
 *
 * @param {object} manifest dist-release/manifest.json, parsed
 * @param {{ version?: string }} [options]
 * @returns {string[]} what is wrong, empty when it may ship. No secrets in
 *   a manifest, so the problems quote the entries they are about.
 */
export function checkReleaseManifest(manifest, { version = RELEASE_VERSION } = {}) {
  const problems = [];
  if (manifest?.version !== version) {
    problems.push(`version is ${manifest?.version ?? '(none)'}; expected ${version}`);
  }
  problems.push(...compareList('permissions', manifest?.permissions, RELEASE_PERMISSIONS));
  for (const key of ['optional_permissions', 'optional_host_permissions']) {
    if (manifest?.[key] !== undefined) problems.push(`${key} is set; 1.0.2 has none`);
  }
  problems.push(...compareList('host_permissions', manifest?.host_permissions, RELEASE_HOST_PERMISSIONS));
  problems.push(
    ...compareList('externally_connectable.matches', manifest?.externally_connectable?.matches, RELEASE_EXTERNALLY_CONNECTABLE),
  );

  // The lists above are covered; this catches a local host anywhere else
  // (web_accessible_resources, content_scripts, a URL field).
  const { host_permissions: _h, externally_connectable: _e, ...rest } = manifest ?? {};
  const local = strings(rest).filter((s) => isLocalPattern(s) || /localhost|127\.0\.0\.1|\[::1\]/i.test(s));
  if (local.length) problems.push(`the manifest mentions a local host: ${local.join(', ')}`);

  return problems;
}
