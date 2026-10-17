// End-to-end checks for the dashboard (/dashboard/), against stubs: the
// account comes from a stubbed Supabase sign-in, and the API from stubApi
// (tests/stubs.js). Nothing here reaches a real project or a real model.
import { test, expect } from '@playwright/test';
import { stubAuth, stubApi } from './stubs.js';

// Signed in the way a reader is: through the sign-in window, here on Contact
// (a plain page, quicker than the landing page's stage). Supabase's own client
// stores the session, so the dashboard finds it as it would in real use.
async function signIn(page, isMobile) {
  await page.goto('/contact/');
  await page.waitForFunction(() => document.fonts.status === 'loaded');
  // The website's pages log uncaught errors through the app's logger.
  expect(await page.evaluate(() => typeof window.__onextapIssues)).toBe('function');
  await (isMobile ? page.tap('.hud [data-login]') : page.click('.hud [data-login]'));
  await page.fill('#loginEmail', 'reader@example.com');
  await page.fill('#loginPassword', 'hunter22');
  await (isMobile ? page.tap('#loginSubmit') : page.click('#loginSubmit'));
  await expect(page.locator('#loginDoneText')).toHaveText('Signed in as reader@example.com.');
}

const JD_ONE = 'Senior Backend Engineer at Norwick Labs. Requirements: Python, PostgreSQL, Docker.';
const JD_TWO = 'Platform Engineer at Kestrel Analytics. Requirements: Kubernetes, Terraform.';
const JD_THREE = 'Data Engineer at Fernhill Foods. Requirements: Airflow, dbt.';

// The server charges inside the generate call and answers with `charge`
// (stubApi does the same); the dashboard never calls POST /api/credits/deduct.
test.describe('the dashboard: cover letters and credits', () => {
  test('one credit buys a personalisation and one free re-run; none left, it says so', async ({ page, isMobile }) => {
    await stubAuth(page);
    const api = await stubApi(page, { credits: 2 });
    await signIn(page, isMobile);
    await page.goto('/dashboard/#/cover-letter');

    const deducts = () => api.calls.filter(c => c.path === '/api/credits/deduct').length;
    const generateCalls = () => api.calls.filter(c => c.path === '/api/answer-vault/generate');
    const generations = () => generateCalls().length;
    const lastRequest = () => generateCalls().at(-1).body;
    const hint = page.locator('#cl-hint');
    const button = page.getByRole('button', { name: 'Personalise for this job' });
    const letter = page.getByRole('textbox', { name: 'Personalised version' });
    const description = page.getByPlaceholder('Paste the job description — the letter is rewritten around what it asks for.');

    // A template to work from.
    await page.getByRole('button', { name: 'Add a template' }).click();
    expect(await page.evaluate(() => typeof window.__onextapIssues)).toBe('function');
    await page.getByPlaceholder('Template name (e.g. Formal)').fill('Formal');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await page.getByPlaceholder('Paste your base cover letter…').fill('Dear team, I build payment systems that stay up.');
    await page.getByPlaceholder('Company or organisation').fill('Norwick Labs');
    await description.fill(JD_ONE);
    await expect(hint).toHaveText('Using “Formal”. Uses 1 credit, which includes one free re-run.');

    // Paid: one credit, charged by the server inside the generation.
    await button.click();
    await expect(letter).toHaveValue('Dear Norwick Labs team, letter number 1.');
    expect(lastRequest()).toMatchObject({ kind: 'cover_letter' });
    expect(lastRequest().allowanceId).toBeUndefined();
    expect(api.state.credits).toBe(1);
    await expect(page.locator('[data-bind="credits"]').first()).toHaveText('1');
    await expect(hint).toHaveText('Using “Formal”. This one is a free re-run.');

    // The re-run of the same application is free, once: the page hands back
    // the allowance the server granted.
    const afterFirst = await page.evaluate(() => JSON.parse(localStorage.getItem('onextap_profiles')));
    const grantedId = afterFirst.profiles[afterFirst.activeProfileId].coverLetters[0].aiAllowanceId;
    expect(grantedId).toMatch(/^[0-9a-f-]{36}$/);
    await button.click();
    await expect(letter).toHaveValue('Dear Norwick Labs team, letter number 2.');
    expect(lastRequest()).toMatchObject({ kind: 'cover_letter', allowanceId: grantedId });
    expect(api.state.credits).toBe(1);
    await expect(hint).toHaveText('Using “Formal”. Uses 1 credit, which includes one free re-run.');

    // Another job is another application: paid, and it buys its own re-run,
    // which still works with the balance at zero.
    await description.fill(JD_TWO);
    await button.click();
    await expect(letter).toHaveValue('Dear Norwick Labs team, letter number 3.');
    expect(api.state.credits).toBe(0);
    await expect(page.locator('[data-bind="credits"]').first()).toHaveText('0');
    await expect(hint).toHaveText('Using “Formal”. This one is a free re-run.');
    await button.click();
    await expect(letter).toHaveValue('Dear Norwick Labs team, letter number 4.');
    expect(api.state.credits).toBe(0);

    // A third job with no credits left: refused before any AI call.
    await description.fill(JD_THREE);
    await expect(hint).toHaveText('Using “Formal”. No credits left: Premium makes cover letters unlimited.');
    await button.click();
    await expect(page.getByText('No credits remaining. Premium makes cover letters unlimited.')).toBeVisible();
    expect(generations()).toBe(4);
    expect(deducts()).toBe(0);

    // The allowance is kept on the template, in this browser's profile store:
    // its re-run used, so no id left to send.
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('onextap_profiles')));
    const template = stored.profiles[stored.activeProfileId].coverLetters[0];
    expect(template).toMatchObject({ name: 'Formal', aiRerunsLeft: 0, aiAllowanceId: null });
    expect(template.aiRerunKey).toMatch(/^[0-9a-f]{8}$/);
  });
});

test.describe('the dashboard: Answer Studio and credits', () => {
  test('one credit writes an answer with three free improvements, charged by the server', async ({ page, isMobile }) => {
    await stubAuth(page);
    const api = await stubApi(page, { credits: 1 });
    await signIn(page, isMobile);
    await page.goto('/dashboard/#/answer-studio');

    const generateCalls = () => api.calls.filter(c => c.path === '/api/answer-vault/generate');
    const answer = page.getByPlaceholder('Optional — your own draft. Generate writes one; Improve rewrites what is here.');

    await page.getByPlaceholder('e.g. Why do you want to work here?').fill('Why do you want to work here?');
    await page.getByRole('button', { name: 'Generate answer' }).click();
    await expect(answer).toHaveValue('Dear Norwick Labs team, letter number 1.');
    expect(generateCalls()[0].body).toMatchObject({ kind: 'answer' });
    expect(generateCalls()[0].body.allowanceId).toBeUndefined();
    expect(api.state.credits).toBe(0);
    await expect(page.getByText('Free improvements on this answer: 3')).toBeVisible();
    await expect(page.locator('.credit-pill')).toHaveText('0 credits left');

    // Improving it is free, at zero credits, with the allowance handed back.
    await page.getByRole('button', { name: 'Improve answer' }).click();
    await expect(answer).toHaveValue('Dear Norwick Labs team, letter number 2.');
    expect(generateCalls()[1].body.allowanceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(api.state.credits).toBe(0);
    await expect(page.getByText('Free improvements on this answer: 2')).toBeVisible();

    expect(api.calls.filter(c => c.path === '/api/credits/deduct')).toHaveLength(0);
  });
});
