/**
 * The label Job Matches shows while a rank runs (HANDOVER item 21). It used to
 * count "Scoring 30 of 30 jobs" on a timer, a number the client never had. It
 * now quotes only the pool's size, and only while no filter narrows the pool.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { rankingLabel } from '../../web/dashboard/js/ws/job-matches-label.js';

test('unfiltered, with the pool size known: quotes it', () => {
  assert.equal(rankingLabel({ total: 1234 }, false), `Scoring the closest of ${(1234).toLocaleString()} jobs in the pool`);
  assert.equal(rankingLabel({ total: 1 }, false), 'Scoring the closest of 1 job in the pool');
});

test('filtered: no number, because the pool size counts jobs the filters exclude', () => {
  assert.equal(rankingLabel({ total: 1234 }, true), 'Scoring the closest jobs in the pool');
});

test('no number when the size is unknown, degraded, empty or not a number', () => {
  for (const meta of [null, undefined, {}, { total: 0 }, { total: 50, degraded: true }, { total: NaN }, { total: '50' }, { total: Infinity }]) {
    assert.equal(rankingLabel(meta, false), 'Scoring the closest jobs in the pool', JSON.stringify(meta));
  }
});

test('never a running count of the old kind', () => {
  assert.doesNotMatch(rankingLabel({ total: 30 }, false), /\d+ of \d+/);
});
