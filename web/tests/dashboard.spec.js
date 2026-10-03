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

test.describe('the dashboard: cover letters and credits', () => {
  test('one credit buys a personalisation and one free re-run; none left, it says so', async ({ page, isMobile }) => {
    await stubAuth(page);
    const api = await stubApi(page, { credits: 2 });
    await signIn(page, isMobile);
    await page.goto('/dashboard/#/cover-letter');

    const deducts = () => api.calls.filter(c => c.path === '/api/credits/deduct').length;
    const generations = () => api.calls.filter(c => c.path === '/api/answer-vault/generate').length;
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

    // Paid: one credit, through the server, after the letter came back.
    await button.click();
    await expect(letter).toHaveValue('Dear Norwick Labs team, letter number 1.');
    expect(deducts()).toBe(1);
    expect(api.state.credits).toBe(1);
    await expect(page.locator('[data-bind="credits"]').first()).toHaveText('1');
    await expect(hint).toHaveText('Using “Formal”. This one is a free re-run.');

    // The re-run of the same application is free, once.
    await button.click();
    await expect(letter).toHaveValue('Dear Norwick Labs team, letter number 2.');
    expect(deducts()).toBe(1);
    await expect(hint).toHaveText('Using “Formal”. Uses 1 credit, which includes one free re-run.');

    // Another job is another application: paid, and it buys its own re-run,
    // which still works with the balance at zero.
    await description.fill(JD_TWO);
    await button.click();
    await expect(letter).toHaveValue('Dear Norwick Labs team, letter number 3.');
    expect(deducts()).toBe(2);
    expect(api.state.credits).toBe(0);
    await expect(hint).toHaveText('Using “Formal”. This one is a free re-run.');
    await button.click();
    await expect(letter).toHaveValue('Dear Norwick Labs team, letter number 4.');
    expect(deducts()).toBe(2);

    // A third job with no credits left: refused before any AI call.
    await description.fill(JD_THREE);
    await expect(hint).toHaveText('Using “Formal”. No credits left: Premium makes cover letters unlimited.');
    await button.click();
    await expect(page.getByText('No credits remaining. Premium makes cover letters unlimited.')).toBeVisible();
    expect(generations()).toBe(4);
    expect(deducts()).toBe(2);

    // The allowance is kept on the template, in this browser's profile store.
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('onextap_profiles')));
    const template = stored.profiles[stored.activeProfileId].coverLetters[0];
    expect(template).toMatchObject({ name: 'Formal', aiRerunsLeft: 0 });
    expect(template.aiRerunKey).toMatch(/^[0-9a-f]{8}$/);
  });
});
