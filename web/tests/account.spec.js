// End-to-end checks for the account flows added on top of sign-in: a name on
// sign-up, "Forgot password?" in the sign-in window, and the reset page the
// email's link opens (/reset-password/). Supabase is answered by
// tests/stubs.js; nothing here reaches a real project.
import { test, expect } from '@playwright/test';
import { stubAuth, recoveryHash } from './stubs.js';

function watchErrors(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  return errors;
}

const press = (page, isMobile, sel) => isMobile ? page.tap(sel) : page.click(sel);

// The sign-in window, on a plain company page (quicker than the stage).
async function openSignIn(page, isMobile) {
  await page.goto('/about/');
  await page.waitForFunction(() => document.fonts.status === 'loaded');
  await press(page, isMobile, '.hud [data-login]');
  await expect(page.locator('#loginTitle')).toHaveText('Welcome back');
}

test.describe('the sign-in window: a name, and a forgotten password', () => {
  test('sign-up asks a name and sends it; sign-in does not ask it', async ({ page, isMobile }) => {
    const auth = await stubAuth(page);
    await openSignIn(page, isMobile);
    await expect(page.locator('#loginName')).toBeHidden();
    await press(page, isMobile, '#loginSwitch');
    await expect(page.locator('#loginName')).toBeVisible();
    await expect(page.locator('#loginName')).toHaveAttribute('autocomplete', 'name');
    await page.fill('#loginName', '  Ada Tester ');
    await page.fill('#loginEmail', 'new@example.com');
    await page.fill('#loginPassword', 'Long-enough1');
    await press(page, isMobile, '#loginSubmit');
    await expect(page.locator('#loginDoneText')).toHaveText('Account created for new@example.com.');
    const signup = auth.find(c => c.path === '/signup');
    expect(signup.body).toMatchObject({ email: 'new@example.com', data: { full_name: 'Ada Tester' } });
  });

  test('Forgot password? asks only the email, and the link opens the reset page', async ({ page, isMobile, baseURL }) => {
    const auth = await stubAuth(page);
    await openSignIn(page, isMobile);
    await press(page, isMobile, '#loginForgot');
    await expect(page.locator('#loginTitle')).toHaveText('Reset your password');
    await expect(page.locator('#loginSubmit')).toHaveText('Send link');
    for (const hidden of ['#loginPassword', '#loginGoogle', '#loginName', '#loginForgot']) {
      await expect(page.locator(hidden)).toBeHidden();
    }
    await expect(page.locator('#loginEmail')).toBeFocused();

    await press(page, isMobile, '#loginSubmit');
    await expect(page.locator('#loginEmailErr')).toHaveText('Enter your email address.');
    await page.fill('#loginEmail', 'reader@example.com');
    await press(page, isMobile, '#loginSubmit');
    await expect(page.locator('#loginDoneTitle')).toHaveText('Check your email.');
    await expect(page.locator('#loginDoneText')).toHaveText('If an account uses reader@example.com, a link to set a new password is on its way to it.');
    const recover = auth.filter(c => c.path === '/recover');
    expect(recover).toHaveLength(1);
    expect(recover[0].body).toMatchObject({ email: 'reader@example.com' });
    expect(recover[0].redirectTo).toBe(new URL('/reset-password/', baseURL).href);

    // Closed and opened again, it is the sign-in form once more.
    await press(page, isMobile, '#login .dlg__x');
    await press(page, isMobile, '.hud [data-login]');
    await expect(page.locator('#loginTitle')).toHaveText('Welcome back');
    await expect(page.locator('#loginPassword')).toBeVisible();
    await expect(page.locator('#loginForgot')).toBeVisible();
  });

  test('a reset asked for too soon says to wait', async ({ page, isMobile }) => {
    await stubAuth(page, { recover: 'wait' });
    await openSignIn(page, isMobile);
    await press(page, isMobile, '#loginForgot');
    await page.fill('#loginEmail', 'reader@example.com');
    await press(page, isMobile, '#loginSubmit');
    await expect(page.locator('#loginSendErr')).toHaveText('Wait a minute before asking for another link.');
    await expect(page.locator('#loginTitle')).toHaveText('Reset your password');
  });

  test('/?reset=1 opens the window on the reset form', async ({ page }) => {
    await page.goto('/?reset=1');
    await expect(page.getByRole('dialog', { name: 'Reset your password' })).toBeVisible();
    await expect(page.locator('#loginPassword')).toBeHidden();
    await expect(page).toHaveURL(/\/$/);   // the address tidied
  });
});

test.describe('the reset page', () => {
  test('from the email link, it sets the new password, held to the sign-up rule', async ({ page, isMobile }) => {
    const errors = watchErrors(page);
    const auth = await stubAuth(page);
    await page.goto(`/reset-password/${recoveryHash()}`);
    await expect(page).toHaveTitle('Reset password — Onextap');
    const input = page.locator('#resetPassword');
    await expect(input).toBeVisible();
    await expect(input).toBeFocused();
    expect(auth.some(c => c.method === 'GET' && c.path === '/user')).toBe(true);   // the link's session, checked

    await page.fill('#resetPassword', 'short');
    await press(page, isMobile, '#resetSubmit');
    await expect(page.locator('#resetPasswordErr')).toHaveText('At least 8 characters, please.');
    await page.fill('#resetPassword', 'long-enough');
    await expect(page.locator('#resetPasswordErr')).toHaveText('Mix in an uppercase letter, a lowercase letter and a number.');
    await page.fill('#resetPassword', 'Brand-new-1');
    await press(page, isMobile, '#resetSubmit');

    // Visible, not just present: the card's words are in the markup from the
    // start, so only its showing proves the update came back.
    await expect(page.locator('#resetDone')).toBeVisible();
    await expect(page.locator('#resetForm')).toBeHidden();
    await expect(page.locator('#resetDone a')).toHaveAttribute('href', '/dashboard/');
    const update = auth.filter(c => c.method === 'PUT' && c.path === '/user');
    expect(update).toHaveLength(1);
    expect(update[0].body).toMatchObject({ password: 'Brand-new-1' });
    expect(errors).toEqual([]);
  });

  test('the current password again is refused in plain words', async ({ page, isMobile }) => {
    await stubAuth(page, { update: 'same' });
    await page.goto(`/reset-password/${recoveryHash()}`);
    await page.fill('#resetPassword', 'Brand-new-1');
    await press(page, isMobile, '#resetSubmit');
    await expect(page.locator('#resetSendErr')).toHaveText('That’s the password you have now. Choose a different one.');
    await expect(page.locator('#resetForm')).toBeVisible();
  });

  test('opened without a link, it says where the link is', async ({ page }) => {
    await stubAuth(page);
    await page.goto('/reset-password/');
    await expect(page.locator('#resetLost')).toBeVisible();
    await expect(page.locator('#resetLostTitle')).toHaveText('Open the link from your email.');
    await expect(page.locator('#resetAgain')).toHaveAttribute('href', '/?reset=1');
    await expect(page.locator('#resetForm')).toBeHidden();
  });

  test('a link Supabase refused says so, and offers a new one', async ({ page }) => {
    await stubAuth(page);
    await page.goto('/reset-password/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
    // The card's default words are these, so its showing is what is checked.
    await expect(page.locator('#resetLost')).toBeVisible();
    await expect(page.locator('#resetChecking')).toBeHidden();
    await expect(page.locator('#resetLostTitle')).toHaveText('This link can’t be used.');
    await expect(page.locator('#resetAgain')).toHaveText('Send me a new link');
  });

  test('a reset link that lands on the site root or the dashboard is sent here', async ({ page }) => {
    await stubAuth(page);
    for (const start of ['/', '/dashboard/']) {
      await page.goto(`${start}${recoveryHash()}`);
      await expect(page).toHaveURL(/\/reset-password\//);
      await expect(page.locator('#resetPassword')).toBeVisible();
    }
  });
});
