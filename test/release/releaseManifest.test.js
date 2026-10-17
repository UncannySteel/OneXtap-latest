/**
 * The release manifest (completion plan B3-C, D10): the store build drops the
 * localhost entries the dev build needs, and `npm run build:release` refuses
 * a manifest that differs from 1.0.2's in anything but its version.
 *
 * 1.0.2's permissions, host permissions and externally_connectable match the
 * repo's manifest, localhost entries included (plan §2), so the pinned lists
 * are the repo's minus localhost.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  RELEASE_VERSION,
  RELEASE_PERMISSIONS,
  RELEASE_HOST_PERMISSIONS,
  RELEASE_EXTERNALLY_CONNECTABLE,
  RELEASE_OUT_DIR,
  isLocalPattern,
  releaseManifest,
  extensionBuild,
  checkReleaseManifest,
} from '../../scripts/releaseManifest.js';

const repoManifest = () => JSON.parse(readFileSync(new URL('../../extension/manifest.json', import.meta.url), 'utf8'));
const LOCAL = /localhost|127\.0\.0\.1|\[::1\]/i;

test('isLocalPattern: local hosts, whatever the scheme, port or subdomain', () => {
  for (const pattern of [
    'http://localhost:5173/*',
    'http://localhost:3001/*',
    'http://localhost/*',
    'https://LOCALHOST:8443/x',
    '*://localhost/*',
    'http://app.localhost:3000/*',
    'http://127.0.0.1:5173/*',
    'http://127.1.2.3/*',
    'http://[::1]:3001/*',
  ]) {
    assert.equal(isLocalPattern(pattern), true, pattern);
  }
});

test('isLocalPattern: real hosts are not local, even when they spell the word', () => {
  for (const pattern of [
    'https://www.onextap.com/*',
    'https://onextap.com/*',
    'https://*.supabase.co/*',
    'https://localhost.example.com/*',
    'https://notlocalhost/*',
    '<all_urls>',
    '',
    undefined,
  ]) {
    assert.equal(isLocalPattern(pattern), false, String(pattern));
  }
});

test('the repo manifest is the dev one: it still has its localhost entries', () => {
  const manifest = repoManifest();
  assert.ok(manifest.host_permissions.some(isLocalPattern));
  assert.ok(manifest.externally_connectable.matches.some(isLocalPattern));
});

test('the pinned lists are the repo manifest minus localhost (1.0.2 minus localhost)', () => {
  const manifest = repoManifest();
  assert.deepEqual([...RELEASE_PERMISSIONS], manifest.permissions);
  assert.deepEqual([...RELEASE_HOST_PERMISSIONS], manifest.host_permissions.filter((p) => !isLocalPattern(p)));
  assert.deepEqual(
    [...RELEASE_EXTERNALLY_CONNECTABLE],
    manifest.externally_connectable.matches.filter((p) => !isLocalPattern(p)),
  );
  assert.deepEqual([...RELEASE_PERMISSIONS], ['storage', 'activeTab', 'scripting', 'identity']);
});

test('the repo manifest says the release version', () => {
  assert.equal(RELEASE_VERSION, '1.0.4');
  assert.equal(repoManifest().version, RELEASE_VERSION);
});

test('releaseManifest drops exactly the localhost entries and nothing else', () => {
  const manifest = repoManifest();
  const before = JSON.stringify(manifest);
  const release = releaseManifest(manifest);

  assert.equal(JSON.stringify(manifest), before, 'the input is not mutated');
  assert.doesNotMatch(JSON.stringify(release), LOCAL);
  assert.deepEqual(release.host_permissions, manifest.host_permissions.filter((p) => !isLocalPattern(p)));
  assert.deepEqual(
    release.externally_connectable.matches,
    manifest.externally_connectable.matches.filter((p) => !isLocalPattern(p)),
  );

  const rest = (m) => {
    const { host_permissions: _h, externally_connectable: _e, ...others } = m;
    return others;
  };
  assert.deepEqual(rest(release), rest(manifest));
});

test('releaseManifest leaves a manifest without those keys alone', () => {
  const bare = { manifest_version: 3, name: 'x', version: '1.0.0' };
  assert.deepEqual(releaseManifest(bare), bare);
});

test('the release form of the repo manifest passes the release check', () => {
  assert.deepEqual(checkReleaseManifest(releaseManifest(repoManifest())), []);
});

test('the release check refuses the dev manifest, naming the localhost entries', () => {
  const problems = checkReleaseManifest(repoManifest());
  assert.ok(problems.length > 0);
  assert.ok(problems.some((p) => /host_permissions/.test(p) && /localhost:3001/.test(p)), problems.join('\n'));
  assert.ok(problems.some((p) => /externally_connectable/.test(p) && /localhost:5173/.test(p)), problems.join('\n'));
});

test('the release check refuses another version', () => {
  const manifest = { ...releaseManifest(repoManifest()), version: '1.0.3' };
  const problems = checkReleaseManifest(manifest);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /version/);
  assert.match(problems[0], /1\.0\.4/);
});

test('the release check refuses a permission added, dropped or optional', () => {
  const release = releaseManifest(repoManifest());
  const cases = [
    { ...release, permissions: [...release.permissions, 'tabs'] },
    { ...release, permissions: release.permissions.filter((p) => p !== 'identity') },
    { ...release, permissions: [...release.permissions, 'storage'] },
    { ...release, optional_permissions: ['downloads'] },
    { ...release, optional_host_permissions: ['https://*/*'] },
  ];
  for (const manifest of cases) {
    const problems = checkReleaseManifest(manifest);
    assert.ok(problems.length > 0, JSON.stringify(manifest.permissions));
    assert.ok(problems.every((p) => /permissions/.test(p)), problems.join('\n'));
  }
});

test('the release check refuses widened host permissions or externally_connectable', () => {
  const release = releaseManifest(repoManifest());
  const widenedHosts = { ...release, host_permissions: [...release.host_permissions, 'https://*/*'] };
  assert.match(checkReleaseManifest(widenedHosts).join('\n'), /host_permissions.*https:\/\/\*\/\*/);

  const narrowedHosts = { ...release, host_permissions: release.host_permissions.slice(1) };
  assert.match(checkReleaseManifest(narrowedHosts).join('\n'), /host_permissions.*missing/);

  const widenedSites = {
    ...release,
    externally_connectable: { matches: [...release.externally_connectable.matches, 'https://*.example.com/*'] },
  };
  assert.match(checkReleaseManifest(widenedSites).join('\n'), /externally_connectable.*example\.com/);

  const noSites = { ...release, externally_connectable: undefined };
  assert.match(checkReleaseManifest(noSites).join('\n'), /externally_connectable/);
});

test('the release check refuses localhost anywhere else in the manifest', () => {
  const release = releaseManifest(repoManifest());
  const manifest = {
    ...release,
    web_accessible_resources: [{ resources: ['x.js'], matches: ['http://localhost:5173/*'] }],
  };
  assert.match(checkReleaseManifest(manifest).join('\n'), /localhost/);
});

test('extensionBuild: a dev build gets the manifest as it is, into dist/', () => {
  const manifest = repoManifest();
  for (const env of [{}, { ONEXTAP_RELEASE: '' }, { ONEXTAP_RELEASE: '0' }, { ONEXTAP_RELEASE: 'true' }]) {
    const build = extensionBuild(manifest, env);
    assert.equal(build.manifest, manifest, 'the same object, untouched');
    assert.equal(build.outDir, 'dist');
    assert.equal(build.release, false);
  }
});

test('extensionBuild: ONEXTAP_RELEASE=1 gets the release manifest, into dist-release/', () => {
  const manifest = repoManifest();
  const build = extensionBuild(manifest, { ONEXTAP_RELEASE: '1' });
  assert.equal(build.outDir, RELEASE_OUT_DIR);
  assert.equal(RELEASE_OUT_DIR, 'dist-release');
  assert.equal(build.release, true);
  assert.deepEqual(build.manifest, releaseManifest(manifest));
  assert.doesNotMatch(JSON.stringify(build.manifest), LOCAL);
});
