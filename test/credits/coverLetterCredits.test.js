import test from 'node:test';
import assert from 'node:assert/strict';

import {
  COVER_LETTER_FREE_RERUNS,
  applicationKey,
  consumesCredit,
  allowanceAfter,
} from '../../src/coverLetterCredits.js';

// The rule the owner set: one credit buys a cover-letter personalisation plus
// one free re-run of it (Answer Studio's rule, with one re-run instead of
// three). Premium never pays. These walk it the way the two front ends do:
// check consumesCredit() before generating, then store allowanceAfter().

const JD = 'Senior Backend Engineer at Norwick Labs.\n\nRequirements: Python, PostgreSQL.';

/** One personalisation, as the workspace runs it. Returns the updated template and what it cost. */
function personalise(template, description, { premium = false, deducted = true } = {}) {
  const key = applicationKey(description);
  const charged = consumesCredit({ premium, template, key });
  const next = { ...template, ...allowanceAfter({ premium, charged, deducted: charged && deducted, template, key }) };
  return { template: next, charged };
}

test('one credit buys a personalisation and exactly one free re-run', () => {
  assert.equal(COVER_LETTER_FREE_RERUNS, 1);
  let t = { id: 'cl-1', name: 'Formal', body: 'Dear team,' };

  let run = personalise(t, JD);
  assert.equal(run.charged, true, 'the first personalisation is paid');
  t = run.template;
  assert.equal(t.aiRerunsLeft, 1);

  run = personalise(t, JD);
  assert.equal(run.charged, false, 'the re-run is free');
  t = run.template;
  assert.equal(t.aiRerunsLeft, 0);

  run = personalise(t, JD);
  assert.equal(run.charged, true, 'the run after the free one is paid again');
  assert.equal(run.template.aiRerunsLeft, 1);
});

test('a different job description is a new application, and is paid', () => {
  const t = personalise({ id: 'cl-1' }, JD).template;
  const other = personalise(t, 'Frontend Developer at Kestrel Analytics. Requirements: React.');
  assert.equal(other.charged, true);
  assert.equal(other.template.aiRerunsLeft, 1, 'and it buys its own re-run');
  assert.notEqual(other.template.aiRerunKey, t.aiRerunKey);
});

test('the same description with other whitespace or case is still the same application', () => {
  assert.equal(applicationKey(JD), applicationKey(`  ${JD.toUpperCase().replace(/\n\n/, '\n   \n')}  `));
  const t = personalise({ id: 'cl-1' }, JD).template;
  assert.equal(personalise(t, JD.replace(/ /g, '  ')).charged, false);
});

test('editing the template body does not use up or forfeit the re-run', () => {
  const t = personalise({ id: 'cl-1', body: 'Dear team,' }, JD).template;
  const edited = { ...t, body: 'Dear hiring team, a new opening line.' };
  assert.equal(personalise(edited, JD).charged, false);
});

test('Premium never pays and keeps no allowance', () => {
  const t = { id: 'cl-1', aiRerunsLeft: 1, aiRerunKey: applicationKey(JD) };
  for (const description of [JD, 'something else entirely']) {
    const run = personalise(t, description, { premium: true });
    assert.equal(run.charged, false);
    assert.equal(run.template.aiRerunsLeft, 0);
    assert.equal(run.template.aiRerunKey, null);
  }
});

test('a charge the server did not confirm buys no re-run', () => {
  const run = personalise({ id: 'cl-1' }, JD, { deducted: false });
  assert.equal(run.charged, true);
  assert.equal(run.template.aiRerunsLeft, 0);
  assert.equal(personalise(run.template, JD).charged, true, 'so the next one is paid');
});

test('templates from before the rule, and junk counts, are simply paid', () => {
  assert.equal(consumesCredit({ premium: false, template: { id: 'old' }, key: applicationKey(JD) }), true);
  assert.equal(consumesCredit({ premium: false, template: null, key: applicationKey(JD) }), true);
  const key = applicationKey(JD);
  for (const left of ['lots', -2, NaN, null, undefined, 0]) {
    assert.equal(consumesCredit({ premium: false, template: { aiRerunsLeft: left, aiRerunKey: key }, key }), true, `aiRerunsLeft: ${left}`);
  }
});

test('only the part of the description that is sent decides the application', () => {
  // Both front ends send the first 6000 characters, so a re-run bought on the
  // dashboard is still a re-run in the popup, whatever follows that cut.
  const head = 'x'.repeat(6000);
  assert.equal(applicationKey(`${head} tail one`), applicationKey(`${head} a different tail`));
  assert.notEqual(applicationKey(`${head.slice(1)}y`), applicationKey(head));
});

test('applicationKey is short, stable and total', () => {
  assert.match(applicationKey(JD), /^[0-9a-f]{8}$/);
  assert.equal(applicationKey(JD), applicationKey(JD));
  for (const junk of [undefined, null, '', 42, {}]) assert.match(applicationKey(junk), /^[0-9a-f]{8}$/);
  assert.equal(applicationKey(''), applicationKey('   '));
});
