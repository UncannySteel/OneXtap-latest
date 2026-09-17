import test from 'node:test';
import assert from 'node:assert/strict';

import {
  storage,
  STORAGE_QUOTA_ERROR,
  STORAGE_WRITE_ERROR,
  __resetMemoryStorageForTests,
  __setMemoryStorageFailureForTests,
  __peekMemoryStorageForTests,
} from '../../src/storage.js';

// These run against the in-memory backend, which storage.js selects only when
// neither chrome.storage nor localStorage exists — i.e. exactly here, in bare
// Node. Nothing below exercises the extension or web backends.

test('in-memory backend round-trips values', async () => {
  __resetMemoryStorageForTests();
  assert.equal(await storage.get('k'), null);
  assert.equal(await storage.set('k', { a: 1 }), true);
  assert.deepEqual(await storage.get('k'), { a: 1 });
  await storage.remove('k');
  assert.equal(await storage.get('k'), null);
});

test('in-memory backend serialises, so callers cannot mutate stored state by reference', async () => {
  __resetMemoryStorageForTests();
  const value = { list: [1, 2] };
  await storage.set('k', value);
  value.list.push(3);
  assert.deepEqual(await storage.get('k'), { list: [1, 2] });
});

test('setStrict rejects on a backend failure while set still resolves true', async () => {
  __resetMemoryStorageForTests();
  __setMemoryStorageFailureForTests(new Error('backend exploded'));

  // set() swallows failures by contract; a pile of callers depend on that.
  assert.equal(await storage.set('k', 1), true);

  await assert.rejects(
    () => storage.setStrict('k', 1),
    (err) => {
      assert.equal(err.name, 'StorageWriteError');
      assert.match(err.message, /backend exploded/);
      return true;
    },
  );

  __setMemoryStorageFailureForTests(null);
  assert.equal(await storage.setStrict('k', 1), true);
  __resetMemoryStorageForTests();
});

test('setStrict normalises a quota failure and names what to delete', async () => {
  __resetMemoryStorageForTests();
  const quota = new Error('QuotaExceededError: out of room');
  quota.name = 'QuotaExceededError';
  __setMemoryStorageFailureForTests(quota);

  await assert.rejects(
    () => storage.setStrict('onextap_resumes', {}),
    (err) => {
      assert.equal(err.name, 'StorageQuotaError');
      assert.match(err.message, /full/i);
      assert.match(err.message, /resume/i);
      assert.match(err.message, /onextap_resumes/);
      return true;
    },
  );

  __setMemoryStorageFailureForTests(null);
  __resetMemoryStorageForTests();
});

test('a chrome-style lastError string mentioning quota is recognised too', async () => {
  __resetMemoryStorageForTests();
  // chrome.runtime.lastError is a bare { message }, not an Error, and its quota
  // wording is "QUOTA_BYTES quota exceeded" — no name to match on.
  __setMemoryStorageFailureForTests({ message: 'QUOTA_BYTES quota exceeded' });
  await assert.rejects(
    () => storage.setStrict('onextap_resumes', {}),
    (err) => err.name === 'StorageQuotaError',
  );
  __setMemoryStorageFailureForTests(null);
  __resetMemoryStorageForTests();
});

test('the exported error names are the ones setStrict actually sets', async () => {
  // These two strings are a cross-module contract, not decoration: resumeStore
  // branches on `err.name === STORAGE_QUOTA_ERROR` to turn a full store into
  // "delete this resume, it is the oldest". A constant that drifted from what
  // the thrower sets would silently downgrade that to the generic path, and
  // nothing else in the suite would notice.
  __resetMemoryStorageForTests();
  assert.equal(STORAGE_QUOTA_ERROR, 'StorageQuotaError');
  assert.equal(STORAGE_WRITE_ERROR, 'StorageWriteError');

  const quota = new Error('out of room');
  quota.name = 'QuotaExceededError';
  __setMemoryStorageFailureForTests(quota);
  await assert.rejects(() => storage.setStrict('k', 1), (err) => err.name === STORAGE_QUOTA_ERROR);

  __setMemoryStorageFailureForTests(new Error('something else'));
  await assert.rejects(() => storage.setStrict('k', 1), (err) => err.name === STORAGE_WRITE_ERROR);

  __setMemoryStorageFailureForTests(null);
  __resetMemoryStorageForTests();
});

test('__peekMemoryStorageForTests distinguishes unset from null', async () => {
  __resetMemoryStorageForTests();
  assert.equal(__peekMemoryStorageForTests('missing'), undefined);
  await storage.set('present', null);
  assert.equal(__peekMemoryStorageForTests('present'), null);
  __resetMemoryStorageForTests();
});
