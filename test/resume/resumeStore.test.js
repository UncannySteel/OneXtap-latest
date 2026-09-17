import test from 'node:test';
import assert from 'node:assert/strict';

import { storage, __resetMemoryStorageForTests, __peekMemoryStorageForTests } from '../../src/storage.js';
import { buildCorpus } from '../../src/corpus.js';
import { MATCHER_VERSION } from '../../src/matching/index.js';
import {
  loadResumeStore,
  addResume,
  renameResume,
  deleteResume,
  setActiveResumeId,
  listResumes,
  getActiveResume,
  findResumeBySourceHash,
  saveParsedResume,
  rederiveIfStale,
  MAX_RESUME_NAME_LENGTH,
  MAX_RESUMES,
  PARSE_SCHEMA_VERSION,
  RESUMES_STORAGE_KEY,
} from '../../src/resumeStore.js';

// resumeStore runs on `storage`, which falls back to an in-memory Map in bare
// Node. That is the whole reason these can be plain `node --test` files with no
// jsdom and no fake-chrome shim.

const CV_TEXT = [
  'Ada Lovelace — Senior Software Engineer',
  'Built React dashboards and shipped a Node.js payments rewrite.',
  'Led the migration from Python batch jobs to a streaming pipeline.',
  'MIT, BS in Computer Science.',
].join('\n');

const PARSED = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  summary: 'Senior engineer focused on payments infrastructure.',
  skills: ['React', 'Node.js', 'Python'],
  experience: [
    {
      company: 'Acme',
      title: 'Senior Software Engineer',
      startDate: '2019-03',
      endDate: 'Present',
      description: 'Built React dashboards and shipped a Node.js payments rewrite.\nLed the migration from Python batch jobs to a streaming pipeline.',
    },
  ],
  education: [{ school: 'MIT', degree: 'BS', field: 'Computer Science' }],
  certificates: [{ name: 'AWS Solutions Architect', issuer: 'Amazon' }],
};

function upload(overrides = {}) {
  return addResume({
    name: 'Ada CV',
    fileName: 'ada-cv.pdf',
    fileSize: 120_000,
    mimeType: 'application/pdf',
    sourceHash: 'a'.repeat(64),
    parsed: PARSED,
    cvText: CV_TEXT,
    ...overrides,
  });
}

/** Rewrite a stored record's fields directly, standing in for an older build. */
async function patchRecord(resumeId, patch) {
  const store = await loadResumeStore();
  Object.assign(store.resumes[resumeId], patch);
  await storage.set(RESUMES_STORAGE_KEY, store);
}

test.beforeEach(() => {
  __resetMemoryStorageForTests();
});

// ------------------------------------------------------------------
// Round trip
// ------------------------------------------------------------------

test('addResume round-trips through loadResumeStore', async () => {
  const { resumeId } = await upload();

  const store = await loadResumeStore();
  const record = store.resumes[resumeId];
  assert.ok(record, 'resume should be in the reloaded store');
  assert.equal(store.activeResumeId, resumeId);

  assert.equal(record.name, 'Ada CV');
  assert.equal(record.fileName, 'ada-cv.pdf');
  assert.equal(record.fileSize, 120_000);
  assert.equal(record.mimeType, 'application/pdf');
  assert.equal(record.sourceHash, 'a'.repeat(64));
  assert.equal(record.parseSchemaVersion, PARSE_SCHEMA_VERSION);
  assert.equal(record.matcherVersion, MATCHER_VERSION);
  assert.equal(record.cvText, CV_TEXT);
  assert.match(record.uploadedAt, /^\d{4}-\d{2}-\d{2}T/);

  assert.deepEqual(record.parsed.skills, ['React', 'Node.js', 'Python']);
  assert.deepEqual(record.parsed.titles, ['Senior Software Engineer']);
  assert.ok(record.parsed.keywords.length > 0, 'keywords should be derived');
  assert.ok(record.corpus.length > 0, 'corpus should be built on save');
});

test('the raw file is never stored — only parsed fields and text', async () => {
  const { resumeId } = await upload();
  const record = (await loadResumeStore()).resumes[resumeId];
  const keys = Object.keys(record);
  for (const forbidden of ['fileData', 'base64', 'bytes', 'blob', 'raw']) {
    assert.ok(!keys.includes(forbidden), `record must not carry ${forbidden}`);
  }
  const serialised = JSON.stringify(record);
  assert.ok(serialised.length < 100_000, 'a record should be tens of KB, not megabytes');
});

// The picker contract listProfiles documents: `{ id, name, ... }`, both
// strings, one row per stored item, ids that index back into the store.
//
// Asserted from a local constant rather than by importing listProfiles,
// because src/profileStore.js imports './storage' with no file extension.
// Vite resolves that; bare Node's ESM loader does not, so profileStore is
// simply not importable under `node --test`. resumeStore uses explicit `.js`
// extensions for exactly that reason.
const PICKER_CONTRACT_KEYS = ['id', 'name'];

test('listResumes matches the listProfiles picker contract', async () => {
  const { resumeId } = await upload();
  const store = await loadResumeStore();
  const rows = listResumes(store);

  assert.equal(rows.length, Object.keys(store.resumes).length);
  for (const key of PICKER_CONTRACT_KEYS) {
    assert.ok(key in rows[0], `listResumes should expose ${key}`);
    assert.equal(typeof rows[0][key], 'string');
  }
  assert.equal(rows[0].id, resumeId);
  assert.ok(rows[0].id in store.resumes, 'a picker row id must index back into the store');
  assert.equal(rows[0].name, 'Ada CV');
});

test('getActiveResume returns the active record with its id', async () => {
  assert.equal(await getActiveResume(), null);
  const { resumeId } = await upload();
  const active = await getActiveResume();
  assert.equal(active.id, resumeId);
  assert.equal(active.name, 'Ada CV');
});

// ------------------------------------------------------------------
// Limits and names
// ------------------------------------------------------------------

test('MAX_RESUMES is enforced and the error names the cap', async () => {
  for (let i = 0; i < MAX_RESUMES; i += 1) {
    await upload({ name: `CV ${i}`, sourceHash: String(i).repeat(64) });
  }
  const store = await loadResumeStore();
  assert.equal(Object.keys(store.resumes).length, MAX_RESUMES);

  await assert.rejects(
    () => upload({ name: 'One too many', sourceHash: 'f'.repeat(64) }),
    (err) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, new RegExp(String(MAX_RESUMES)));
      assert.match(err.message, /delete one/i);
      return true;
    },
  );

  assert.equal(Object.keys((await loadResumeStore()).resumes).length, MAX_RESUMES);
});

test('duplicate names are rejected case-insensitively and whitespace-trimmed', async () => {
  await upload({ name: 'Ada CV' });

  await assert.rejects(() => upload({ name: 'ada cv' }), /already exists/);
  await assert.rejects(() => upload({ name: '  ADA CV  ' }), /already exists/);
  await assert.rejects(() => upload({ name: '   ' }), /name is required/);

  // A genuinely different name still lands.
  const { resumeId } = await upload({ name: 'Ada CV 2024' });
  assert.ok(resumeId);
});

test('names are trimmed to MAX_RESUME_NAME_LENGTH', async () => {
  const { resumeId } = await upload({ name: 'x'.repeat(MAX_RESUME_NAME_LENGTH + 20) });
  const record = (await loadResumeStore()).resumes[resumeId];
  assert.equal(record.name.length, MAX_RESUME_NAME_LENGTH);
});

test('renameResume enforces the same name rules and leaves the active id alone', async () => {
  const { resumeId: first } = await upload({ name: 'First' });
  const { resumeId: second } = await upload({ name: 'Second', sourceHash: 'b'.repeat(64) });

  await assert.rejects(() => renameResume(first, 'second'), /already exists/);
  await assert.rejects(() => renameResume(first, ''), /name is required/);
  await assert.rejects(() => renameResume('nope', 'Whatever'), /not found/);

  // Renaming to its own name, differently cased, is not a collision.
  const store = await renameResume(first, 'FIRST');
  assert.equal(store.resumes[first].name, 'FIRST');
  assert.equal(store.activeResumeId, second, 'rename must not change the active resume');
});

// ------------------------------------------------------------------
// The cache rule
// ------------------------------------------------------------------

test('findResumeBySourceHash matches on hash AND parse schema version', async () => {
  const { resumeId } = await upload({ sourceHash: 'c'.repeat(64) });
  const store = await loadResumeStore();

  const hit = findResumeBySourceHash(store, 'c'.repeat(64));
  assert.ok(hit, 'same bytes, same schema — a hit');
  assert.equal(hit.id, resumeId);

  assert.equal(findResumeBySourceHash(store, 'd'.repeat(64)), null, 'different bytes — a miss');
  assert.equal(findResumeBySourceHash(store, ''), null);
  assert.equal(findResumeBySourceHash(store, null), null);
});

test('a hash match under an OLD parse schema is a miss, not a hit', async () => {
  const { resumeId } = await upload({ sourceHash: 'e'.repeat(64) });
  await patchRecord(resumeId, { parseSchemaVersion: PARSE_SCHEMA_VERSION - 1 });

  const store = await loadResumeStore();
  assert.equal(store.resumes[resumeId].sourceHash, 'e'.repeat(64));
  assert.equal(
    findResumeBySourceHash(store, 'e'.repeat(64)),
    null,
    'serving a stale-schema record from cache would half-populate the profile with no error',
  );
});

// ------------------------------------------------------------------
// Filing a parse result
// ------------------------------------------------------------------
//
// saveParsedResume is the one entry point both upload screens use — the
// dashboard's ProfilesPage and the ResumeSwitcher dropdown. Everything below is
// behaviour those two screens would otherwise each implement, and drift on.

/** The shape parseResumeFile hands back on success. */
const PARSE_RESULT = {
  ok: true,
  error: null,
  parsed: PARSED,
  cvText: CV_TEXT,
  sourceHash: 'a'.repeat(64),
  fileName: 'ada-cv.pdf',
  fileSize: 120_000,
  mimeType: 'application/pdf',
};

test('saveParsedResume files a new parse result and makes it active', async () => {
  const { resumeId, reused } = await saveParsedResume(PARSE_RESULT);
  assert.equal(reused, false);

  const store = await loadResumeStore();
  assert.equal(store.activeResumeId, resumeId);

  const record = store.resumes[resumeId];
  assert.equal(record.name, 'ada-cv', 'the label is the file name without its extension');
  assert.equal(record.fileName, 'ada-cv.pdf');
  assert.equal(record.fileSize, 120_000);
  assert.equal(record.mimeType, 'application/pdf');
  assert.equal(record.sourceHash, 'a'.repeat(64));
  assert.equal(record.cvText, CV_TEXT);
  assert.ok(record.parsed.keywords.length > 0, 'the full derivation ran');
});

test('saveParsedResume on the same bytes selects the cached copy, never a second one', async () => {
  // Without this, re-uploading the same file would hit the duplicate-name rule
  // and fail at exactly the moment the user reads as "it should just work".
  const first = await saveParsedResume(PARSE_RESULT);
  await setActiveResumeId(null);

  const second = await saveParsedResume(PARSE_RESULT);
  assert.equal(second.reused, true);
  assert.equal(second.resumeId, first.resumeId);

  const store = await loadResumeStore();
  assert.equal(Object.keys(store.resumes).length, 1, 'no second copy was written');
  assert.equal(store.activeResumeId, first.resumeId, 'the cached copy is re-selected');
});

test('saveParsedResume matches on bytes, not on file name', async () => {
  // The point of hashing raw bytes: the same CV exported under a new name is
  // the same CV, and a different CV under an old name is not.
  const first = await saveParsedResume({ ...PARSE_RESULT, fileName: 'renamed.pdf' });
  const same = await saveParsedResume({ ...PARSE_RESULT, fileName: 'ada-cv.pdf' });
  assert.equal(same.resumeId, first.resumeId, 'same bytes, new name — still a hit');

  const other = await saveParsedResume({ ...PARSE_RESULT, sourceHash: 'b'.repeat(64), fileName: 'renamed.pdf (1).pdf' });
  assert.equal(other.reused, false, 'different bytes — a new record');
  assert.equal(Object.keys((await loadResumeStore()).resumes).length, 2);
});

test('saveParsedResume falls back to a usable label when the file name gives none', async () => {
  const { resumeId } = await saveParsedResume({ ...PARSE_RESULT, fileName: '.pdf' });
  assert.equal((await loadResumeStore()).resumes[resumeId].name, 'Resume');
});

test('saveParsedResume survives junk without an unhandled throw', async () => {
  for (const junk of [null, undefined, 0, '', 'nope', [], {}, NaN, true]) {
    __resetMemoryStorageForTests();
    const result = await saveParsedResume(junk);
    assert.equal(typeof result.resumeId, 'string');
    assert.equal(result.reused, false);
  }
});

// ------------------------------------------------------------------
// Staleness
// ------------------------------------------------------------------

test('rederiveIfStale: an up-to-date record is left alone', async () => {
  const { resumeId } = await upload();
  const before = (await loadResumeStore()).resumes[resumeId];

  const result = await rederiveIfStale(resumeId);
  assert.equal(result.status, 'fresh');
  assert.equal(result.resume.parsedAt, before.parsedAt);
});

test('rederiveIfStale: a MATCHER_VERSION bump re-derives from cvText, no re-upload', async () => {
  const { resumeId } = await upload();
  // Stand in for a record written by an older matcher, with its derived output
  // wiped so re-derivation is the only thing that could restore it.
  await patchRecord(resumeId, {
    matcherVersion: MATCHER_VERSION - 1,
    parsed: { ...PARSED, skills: ['React', 'Node.js', 'Python'], titles: [], keywords: [], seniority: null, education: PARSED.education },
    corpus: [],
    parsedAt: '2000-01-01T00:00:00.000Z',
  });

  const result = await rederiveIfStale(resumeId);
  assert.equal(result.status, 'rederived');
  assert.notEqual(result.status, 'needs-reupload', 'a lexicon tweak must not force a re-upload');

  const record = (await loadResumeStore()).resumes[resumeId];
  assert.equal(record.matcherVersion, MATCHER_VERSION);
  assert.equal(record.needsReupload, false);
  assert.ok(record.parsed.keywords.length > 0, 'keywords re-derived from the stored text');
  assert.ok(record.corpus.length > 0, 'corpus rebuilt');
  assert.deepEqual(record.parsed.titles, ['Senior Software Engineer']);
  assert.equal(record.cvText, CV_TEXT, 'the stored text is the input, never rewritten');
  assert.notEqual(record.parsedAt, '2000-01-01T00:00:00.000Z');
});

test('rederiveIfStale: a PARSE_SCHEMA_VERSION bump flags a re-upload instead', async () => {
  const { resumeId } = await upload();
  await patchRecord(resumeId, {
    parseSchemaVersion: PARSE_SCHEMA_VERSION - 1,
    matcherVersion: MATCHER_VERSION - 1,
    parsed: { skills: [], titles: [], keywords: [], seniority: null, education: [] },
  });

  const result = await rederiveIfStale(resumeId);
  assert.equal(result.status, 'needs-reupload');

  const record = (await loadResumeStore()).resumes[resumeId];
  assert.equal(record.needsReupload, true);
  assert.equal(record.parseSchemaVersion, PARSE_SCHEMA_VERSION - 1, 'the record is flagged, not silently upgraded');
  assert.deepEqual(record.parsed.keywords, [], 'nothing is re-derived: the bytes are gone');
  assert.ok(listResumes(await loadResumeStore())[0].needsReupload, 'the picker can surface it');
});

test('rederiveIfStale on an unknown id reports missing rather than throwing', async () => {
  const result = await rederiveIfStale('resume-does-not-exist');
  assert.equal(result.status, 'missing');
  assert.equal(result.resume, null);
});

// ------------------------------------------------------------------
// Deletion
// ------------------------------------------------------------------

test('deleting the active resume leaves activeResumeId pointing at something real', async () => {
  const { resumeId: first } = await upload({ name: 'First' });
  const { resumeId: second } = await upload({ name: 'Second', sourceHash: 'b'.repeat(64) });
  assert.equal((await loadResumeStore()).activeResumeId, second);

  const store = await deleteResume(second);
  assert.equal(store.activeResumeId, first, 'falls back to what remains, never a dangling id');
  assert.ok(!(second in store.resumes));
});

test('deleting the last resume is allowed and activeResumeId falls back to null', async () => {
  const { resumeId } = await upload();
  const store = await deleteResume(resumeId);
  assert.deepEqual(store.resumes, {});
  assert.equal(store.activeResumeId, null);

  const reloaded = await loadResumeStore();
  assert.equal(reloaded.activeResumeId, null);
  assert.deepEqual(listResumes(reloaded), []);
});

test('a stored activeResumeId pointing at a deleted record is never handed back', async () => {
  const { resumeId } = await upload();
  await storage.set(RESUMES_STORAGE_KEY, { resumes: {}, activeResumeId: resumeId });
  const store = await loadResumeStore();
  assert.equal(store.activeResumeId, null);
});

test('setActiveResumeId ignores unknown ids and accepts an explicit null', async () => {
  const { resumeId } = await upload();
  const unchanged = await setActiveResumeId('nope');
  assert.equal(unchanged.activeResumeId, resumeId);

  const cleared = await setActiveResumeId(null);
  assert.equal(cleared.activeResumeId, null);
  assert.equal((await loadResumeStore()).activeResumeId, null);
});

// ------------------------------------------------------------------
// Pure read
// ------------------------------------------------------------------

test('loadResumeStore on an empty store writes nothing', async () => {
  assert.equal(__peekMemoryStorageForTests(RESUMES_STORAGE_KEY), undefined);

  const store = await loadResumeStore();
  assert.deepEqual(store, { resumes: {}, activeResumeId: null });

  // Checked against the backend directly: loadProfileStore migrates and writes
  // on first run, this one must not.
  assert.equal(
    __peekMemoryStorageForTests(RESUMES_STORAGE_KEY),
    undefined,
    'loadResumeStore must not write on first run',
  );
});

test('loadResumeStore degrades malformed stored data instead of throwing', async () => {
  for (const junk of [42, 'nope', [], { resumes: 'nope' }, { resumes: { a: null, b: 7 } }]) {
    await storage.set(RESUMES_STORAGE_KEY, junk);
    const store = await loadResumeStore();
    assert.equal(typeof store.resumes, 'object');
    assert.ok(!Array.isArray(store.resumes));
    assert.ok(store.activeResumeId === null || typeof store.activeResumeId === 'string');
    for (const record of Object.values(store.resumes)) {
      assert.equal(typeof record, 'object');
      assert.notEqual(record, null);
    }
  }
});

// ------------------------------------------------------------------
// Corpus
// ------------------------------------------------------------------

test('corpus refs are stable across two buildCorpus runs on the same input', () => {
  const a = buildCorpus(PARSED, CV_TEXT).map((item) => item.ref);
  const b = buildCorpus(PARSED, CV_TEXT).map((item) => item.ref);
  assert.deepEqual(a, b);
  assert.ok(a.length > 0);
});

test('stored corpus refs survive a re-derivation', async () => {
  const { resumeId } = await upload();
  const before = (await loadResumeStore()).resumes[resumeId].corpus.map((i) => i.ref);

  await patchRecord(resumeId, { matcherVersion: MATCHER_VERSION - 1 });
  await rederiveIfStale(resumeId);

  const after = (await loadResumeStore()).resumes[resumeId].corpus.map((i) => i.ref);
  assert.deepEqual(after, before, 'refs are persisted next to generated documents; they must not move');
});

// ------------------------------------------------------------------
// Totality
// ------------------------------------------------------------------

test('every export survives junk input with a valid result or a typed error', async () => {
  const junk = [null, undefined, 0, '', 'nope', [], {}, NaN, true];

  // Sync reads: always a valid value, never a throw.
  for (const value of junk) {
    assert.deepEqual(listResumes(value), []);
    assert.equal(findResumeBySourceHash(value, 'a'.repeat(64)), null);
    assert.equal(findResumeBySourceHash({ resumes: { x: {} } }, value), null);
  }

  // Async reads.
  assert.deepEqual(await loadResumeStore(), { resumes: {}, activeResumeId: null });
  assert.equal(await getActiveResume(), null);
  // saveParsedResume takes an untyped payload straight off the wire, so it has
  // to degrade to a valid record rather than throwing halfway through.
  for (const value of junk) {
    __resetMemoryStorageForTests();
    const filed = await saveParsedResume(value);
    assert.equal(typeof filed.resumeId, 'string');
    assert.ok(filed.resumeId.length > 0);
  }
  __resetMemoryStorageForTests();
  for (const value of junk) {
    const result = await rederiveIfStale(value);
    assert.equal(result.status, 'missing');
    const store = await setActiveResumeId(value === null ? 'skip-null' : value);
    assert.equal(typeof store, 'object');
  }

  // Mutators: an Error with a message, never an unhandled throw of something
  // that is not an Error.
  for (const value of junk) {
    await assert.rejects(() => addResume(value), (err) => err instanceof Error && err.message.length > 0);
    await assert.rejects(() => renameResume(value, value), (err) => err instanceof Error && err.message.length > 0);
    await assert.rejects(() => deleteResume(value), (err) => err instanceof Error && /not found/i.test(err.message));
  }
});

test('a resume with no usable parse data still stores and still lists', async () => {
  const { resumeId } = await addResume({
    name: 'Blank',
    fileName: 'blank.pdf',
    parsed: null,
    cvText: null,
  });
  const record = (await loadResumeStore()).resumes[resumeId];
  assert.deepEqual(record.parsed.skills, []);
  assert.deepEqual(record.parsed.titles, []);
  assert.equal(record.parsed.yearsExperience, null);
  assert.equal(record.parsed.seniority, null);
  assert.equal(record.cvText, '');
  assert.deepEqual(record.corpus, []);
  assert.equal(listResumes(await loadResumeStore()).length, 1);
});

/**
 * The `needsReupload` flow has to be able to complete.
 *
 * When the parse schema moves on, the picker flags the record and asks the
 * user to re-upload. Before this was fixed, that was a dead end:
 * findResumeBySourceHash correctly misses on a stale schema, addResume then
 * collided with the stale record's OWN name, and the one action the UI
 * demanded was the one action that could not succeed. Same bytes must mean
 * the same resume, refreshed in place.
 */
test('re-uploading a resume flagged needsReupload refreshes it instead of colliding', async () => {
  __resetMemoryStorageForTests();

  await addResume({
    name: 'Main',
    fileName: 'cv.pdf',
    sourceHash: 'abc',
    parsed: { skills: ['react'] },
    cvText: 'React work.',
  });

  // Age the record the way a PARSE_SCHEMA_VERSION bump would.
  let store = await loadResumeStore();
  const originalId = Object.keys(store.resumes)[0];
  store.resumes[originalId].parseSchemaVersion = PARSE_SCHEMA_VERSION - 1;
  store.resumes[originalId].needsReupload = true;
  await storage.set(RESUMES_STORAGE_KEY, store);

  const result = await saveParsedResume({
    sourceHash: 'abc',
    fileName: 'cv.pdf',
    parsed: { skills: ['react', 'typescript'] },
    cvText: 'React and TypeScript work.',
  });

  assert.equal(result.resumeId, originalId, 'the same record must be refreshed, not replaced');
  assert.equal(result.refreshed, true);

  store = await loadResumeStore();
  assert.equal(Object.keys(store.resumes).length, 1, 'refresh must not duplicate the resume');

  const record = store.resumes[originalId];
  assert.equal(record.name, 'Main', 'the user-facing label survives a refresh');
  assert.equal(record.parseSchemaVersion, PARSE_SCHEMA_VERSION);
  assert.equal(record.needsReupload, false, 'the flag that prompted the re-upload must clear');
  assert.ok(record.corpus.length > 0, 'corpus is rebuilt from the new parse');
  assert.equal(store.activeResumeId, originalId, 'the refreshed resume becomes active');
});

/**
 * The needsReupload flow has to be completable.
 *
 * A PARSE_SCHEMA_VERSION bump flags stored resumes as needing a re-upload, and
 * the picker says so. But findResumeBySourceHash deliberately cannot see a
 * stale-schema record — serving a stale parse as a cache hit would defeat the
 * bump — while that record still holds its name. So the re-upload fell through
 * to addResume() and died on "A resume with this name already exists": the one
 * action the UI demanded was the one action guaranteed to fail.
 */
test('re-uploading after a parse-schema bump refreshes in place', async () => {
  __resetMemoryStorageForTests();

  await addResume({
    name: 'Main', fileName: 'cv.pdf', sourceHash: 'abc',
    parsed: { skills: ['react'] }, cvText: 'React work.',
  });

  let store = await loadResumeStore();
  const originalId = Object.keys(store.resumes)[0];

  // Simulate the record having been written by an older parser.
  store.resumes[originalId].parseSchemaVersion = PARSE_SCHEMA_VERSION - 1;
  store.resumes[originalId].needsReupload = true;
  await storage.set(RESUMES_STORAGE_KEY, store);

  const result = await saveParsedResume({
    fileName: 'cv.pdf', sourceHash: 'abc',
    parsed: { skills: ['react', 'typescript'] }, cvText: 'React and TypeScript work.',
  });

  const after = (await loadResumeStore()).resumes;
  assert.equal(result.refreshed, true, 'should refresh, not add');
  assert.equal(Object.keys(after).length, 1, 'must not leave a duplicate behind');
  assert.equal(
    result.resumeId,
    originalId,
    'id must survive — corpus refs are handed out alongside generated documents',
  );
  assert.equal(after[originalId].name, 'Main', 'the user named it, not the parser');
  assert.equal(after[originalId].needsReupload, false);
  assert.equal(after[originalId].parseSchemaVersion, PARSE_SCHEMA_VERSION);
  assert.ok(
    after[originalId].parsed.skills.includes('typescript'),
    'the fresh parse must actually replace the stale one',
  );
});
