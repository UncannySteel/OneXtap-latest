// End-to-end checks for the two windows added to the landing page: the FAQ,
// opened from CH 05 ("Get hired"), and sign-in, opened from the header's
// Log in on every page. Both are pop-ups in the site's own palette and type,
// hold the page while open, and give focus back when they close.
import { test, expect } from '@playwright/test';

function watchErrors(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  return errors;
}

async function bootLanding(page) {
  const errors = watchErrors(page);
  await page.goto('/');
  await page.waitForFunction(() => window.__stage && window.__stage.info().snapshotsPending === 0, null, { timeout: 30000 });
  return errors;
}

// Onto CH 05, once the offer has risen.
async function toClose(page) {
  await page.evaluate(() => new Promise(done => {
    const i = window.__stage.info();
    const close = i.chapters.find(c => c.id === 'close');
    window.__lenis.scrollTo(i.top + (close.arrive + 0.3) * i.unit, { immediate: true, force: true });
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 80)));
  }));
  await expect.poll(() => page.textContent('#chapterLabel')).toBe('05 — Get hired');
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.querySelector('.close__row')).opacity)).toBe('1');
}

const press = (page, isMobile, sel) => isMobile ? page.tap(sel) : page.click(sel);
const isOpen = (page, id) => page.evaluate(id => document.getElementById(id).classList.contains('is-open'), id);

// Everything but the window is inert, and the page is held.
const holding = (page, id) => page.evaluate(id => ({
  behind: [...document.body.children].filter(el => el.id !== id && el.tagName !== 'SCRIPT').every(el => el.inert),
  held: document.documentElement.classList.contains('dlg-open'),
  focusIn: document.getElementById(id).contains(document.activeElement)
}), id);

test.describe('the FAQ window', () => {
  test('a FAQ button sits in CH 05, beside Add to Chrome', async ({ page }) => {
    const errors = await bootLanding(page);
    await toClose(page);
    const faq = page.locator('.close [data-faq]');
    await expect(faq).toBeVisible();
    await expect(faq).toHaveAccessibleName('FAQ');
    await expect(faq).toHaveAttribute('aria-haspopup', 'dialog');
    const [cta, btn] = await Promise.all([page.locator('.close .btn--solid').boundingBox(), faq.boundingBox()]);
    expect(Math.abs((cta.y + cta.height / 2) - (btn.y + btn.height / 2))).toBeLessThan(2);   // same row
    expect(errors).toEqual([]);
  });

  test('pops up as a window of questions that fold open one by one', async ({ page, isMobile }) => {
    const errors = await bootLanding(page);
    await toClose(page);
    await press(page, isMobile, '.close [data-faq]');
    const dialog = page.getByRole('dialog', { name: 'Fair questions.' });
    await expect(dialog).toBeVisible();
    expect(await holding(page, 'faq')).toEqual({ behind: true, held: true, focusIn: true });
    await expect(page.locator('#faq summary').first()).toBeFocused();

    // Every answer starts folded away.
    const items = page.locator('#faq .acc__item');
    const n = await items.count();
    expect(n).toBeGreaterThanOrEqual(6);
    for (let k = 0; k < n; k++) {
      await expect(items.nth(k)).not.toHaveAttribute('open', '');
      await expect(items.nth(k).locator('.acc__a')).toBeHidden();
    }

    // A question opens on its answer, and closes again.
    const second = items.nth(1);
    await press(page, isMobile, '#faq .acc__item:nth-child(2) summary');
    await expect(second).toHaveAttribute('open', '');
    await expect(second.locator('.acc__a')).toBeVisible();
    await expect(second.locator('.acc__a')).toContainText('$5 a month');
    await expect.poll(() => second.locator('.acc__icon').evaluate(i => getComputedStyle(i).backgroundColor)).toBe('rgb(12, 23, 16)');
    await press(page, isMobile, '#faq .acc__item:nth-child(2) summary');
    await expect(second).not.toHaveAttribute('open', '');
    await expect(second.locator('.acc__a')).toBeHidden();

    // By keyboard too.
    if (!isMobile) {
      await page.locator('#faq summary').first().focus();
      await page.keyboard.press('Enter');
      await expect(items.first()).toHaveAttribute('open', '');
      await page.keyboard.press('Space');
      await expect(items.first()).not.toHaveAttribute('open', '');
    }
    expect(errors).toEqual([]);
  });

  test('closes from the ×, Escape and the scrim, and hands focus back', async ({ page, isMobile }) => {
    await bootLanding(page);
    await toClose(page);
    for (const closer of ['#faq .dlg__x', 'Escape', 'scrim']) {
      if (closer === 'Escape' && isMobile) continue;
      await press(page, isMobile, '.close [data-faq]');
      await expect.poll(() => isOpen(page, 'faq')).toBe(true);
      await page.locator('#faq .acc__item:nth-child(3) summary').click();
      if (closer === 'Escape') await page.keyboard.press('Escape');
      else if (closer === 'scrim') await page.mouse.click(4, 300);
      else await press(page, isMobile, closer);
      await expect.poll(() => isOpen(page, 'faq')).toBe(false);
      if (!isMobile) await expect(page.locator('.close [data-faq]')).toBeFocused();
      expect(await page.evaluate(() => [...document.body.children].some(el => el.inert && !['siteMenu', 'faq', 'login'].includes(el.id)))).toBe(false);
    }
    // Opened again, every answer is folded away once more.
    await press(page, isMobile, '.close [data-faq]');
    expect(await page.$$eval('#faq details', ds => ds.filter(d => d.open).length)).toBe(0);
  });

  test('holds focus inside while it is open', async ({ page, isMobile }) => {
    test.skip(isMobile, 'keys');
    await bootLanding(page);
    await toClose(page);
    await page.click('.close [data-faq]');
    for (const key of ['Tab', 'Shift+Tab']) {
      for (let k = 0; k < 14; k++) {
        await page.keyboard.press(key);
        expect(await page.evaluate(() => document.getElementById('faq').contains(document.activeElement))).toBe(true);
      }
    }
  });

  test('holds the page still while it is open', async ({ page, isMobile }) => {
    test.skip(isMobile, 'wheel');
    await bootLanding(page);
    await toClose(page);
    const y = await page.evaluate(() => scrollY);
    await page.click('.close [data-faq]');
    await page.mouse.move(4, 450);
    await page.mouse.wheel(0, 900);
    await page.keyboard.press('PageDown');
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => scrollY)).toBe(y);
    expect(await page.evaluate(() => window.__lenis.isStopped)).toBe(true);
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => window.__lenis.isStopped)).toBe(false);
  });

  test('keeps the site palette and type', async ({ page }) => {
    await bootLanding(page);
    await toClose(page);
    await page.click('.close [data-faq]');
    const look = await page.evaluate(() => {
      const cs = s => getComputedStyle(document.querySelector(s));
      return {
        paper: cs('#faq .dlg__win').backgroundColor,
        ink: cs('#faq .acc__q').color,
        title: cs('#faqTitle').fontFamily,
        question: cs('#faq .acc__q').fontFamily,
        url: cs('#faq .dlg__url').fontFamily
      };
    });
    expect(look).toMatchObject({ paper: 'rgb(233, 228, 212)', ink: 'rgb(12, 23, 16)' });
    expect(look.title).toMatch(/^Archivo/);
    expect(look.question).toMatch(/^"?Instrument Sans/);
    expect(look.url).toMatch(/^"?DM Mono/);
  });
});

test.describe('the sign-in window', () => {
  const PAGES = ['/', '/about/', '/contact/', '/privacy/'];

  for (const path of PAGES) {
    test(`${path} has Log in in the header row, and it opens sign-in`, async ({ page, isMobile }) => {
      const errors = watchErrors(page);
      await page.goto(path);
      await page.waitForFunction(() => document.fonts.status === 'loaded');
      const login = page.locator('.hud [data-login]');
      await expect(login).toBeVisible();
      await expect(login).toHaveAccessibleName('Log in');
      await expect(login).toHaveAttribute('aria-haspopup', 'dialog');
      // On one line, clear of the spine's mark and burger, beside Add to Chrome.
      const [l, c, burger, logo] = await Promise.all(['.hud__login', '.hud__cta', '#burger', '.spine__logo'].map(s => page.locator(s).boundingBox()));
      expect(l.height).toBeLessThan(40);
      expect(c.height).toBeLessThan(40);
      expect(l.x + l.width).toBeLessThanOrEqual(c.x);
      if (isMobile) {
        expect(l.x).toBeGreaterThanOrEqual(logo.x + logo.width);
        expect(c.x + c.width).toBeLessThanOrEqual(burger.x);
      }
      expect(l.y).toBeLessThan(60);

      await press(page, isMobile, '.hud [data-login]');
      await expect(page.getByRole('dialog', { name: 'Welcome back' })).toBeVisible();
      expect(await holding(page, 'login')).toEqual({ behind: true, held: true, focusIn: true });
      expect(await page.evaluate(() => document.getElementById('login').scrollWidth <= innerWidth)).toBe(true);
      expect(errors).toEqual([]);
    });
  }

  test('holds what the screenshot holds', async ({ page }) => {
    await bootLanding(page);
    await page.click('.hud [data-login]');
    const win = page.locator('#login');
    await expect(win.locator('#loginTitle')).toHaveText('Welcome back');
    await expect(win.locator('#loginIntro')).toHaveText('Sign in to access your dashboard.');
    await expect(win.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
    await expect(win.locator('#loginGoogle svg path')).toHaveCount(4);   // the four-colour G
    await expect(win.locator('.login__or')).toHaveText('or');
    await expect(win.getByRole('textbox', { name: 'Email address' })).toHaveAttribute('placeholder', 'Email address');
    await expect(win.locator('#loginPassword')).toHaveAttribute('placeholder', 'Password');
    await expect(win.locator('#loginPassword')).toHaveAttribute('type', 'password');
    await expect(win.locator('#loginShow')).toHaveText('Show');
    await expect(win.getByRole('button', { name: 'Sign In', exact: true })).toBeVisible();
    await expect(win.locator('.login__switch')).toHaveText(/Don’t have an account\?\s+Sign up/);
    // In that order, top to bottom.
    const ys = await Promise.all(['#loginTitle', '#loginIntro', '#loginGoogle', '.login__or', '#loginEmail', '#loginPassword', '#loginSubmit', '.login__switch']
      .map(async s => (await win.locator(s).boundingBox()).y));
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
  });

  test('keeps the site palette and type', async ({ page }) => {
    await bootLanding(page);
    await page.click('.hud [data-login]');
    const look = await page.evaluate(() => {
      const cs = s => getComputedStyle(document.querySelector(s));
      return {
        win: cs('#login .dlg__win').backgroundColor,
        card: cs('.login__card').backgroundColor,
        cardLine: cs('.login__card').borderTopColor,
        title: cs('#loginTitle').color,
        intro: cs('#loginIntro').color,
        submit: cs('#loginSubmit').backgroundColor,
        submitInk: cs('#loginSubmit').color,
        link: cs('#loginSwitch').color,
        titleFace: cs('#loginTitle').fontFamily,
        uiFace: cs('#loginSubmit').fontFamily
      };
    });
    expect(look).toMatchObject({
      win: 'rgb(18, 30, 20)', card: 'rgb(34, 48, 25)', cardLine: 'rgb(49, 67, 42)',
      title: 'rgb(233, 228, 212)', intro: 'rgb(159, 181, 44)',
      submit: 'rgb(233, 228, 212)', submitInk: 'rgb(12, 23, 16)', link: 'rgb(198, 218, 67)'
    });
    expect(look.titleFace).toMatch(/^"?Instrument Serif/);
    expect(look.uiFace).toMatch(/^"?Instrument Sans/);
  });

  test('shows and hides the password', async ({ page, isMobile }) => {
    await bootLanding(page);
    await press(page, isMobile, '.hud [data-login]');
    await page.fill('#loginPassword', 'hunter22');
    await press(page, isMobile, '#loginShow');
    await expect(page.locator('#loginPassword')).toHaveAttribute('type', 'text');
    await expect(page.locator('#loginShow')).toHaveText('Hide');
    await expect(page.locator('#loginShow')).toHaveAttribute('aria-pressed', 'true');
    await press(page, isMobile, '#loginShow');
    await expect(page.locator('#loginPassword')).toHaveAttribute('type', 'password');
    await expect(page.locator('#loginShow')).toHaveText('Show');
    await expect(page.locator('#loginShow')).toHaveAttribute('aria-pressed', 'false');
  });

  test('checks the form, then signs in', async ({ page, isMobile }) => {
    await bootLanding(page);
    await page.evaluate(() => { window.__logins = []; document.addEventListener('onextap:login', e => window.__logins.push(e.detail)); });
    await press(page, isMobile, '.hud [data-login]');

    await press(page, isMobile, '#loginSubmit');
    await expect(page.locator('#loginEmailErr')).toHaveText('Enter your email address.');
    await expect(page.locator('#loginPasswordErr')).toHaveText('Enter your password.');
    await expect(page.locator('#loginEmail')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#loginEmail')).toBeFocused();

    await page.fill('#loginEmail', 'not-an-email');
    await expect(page.locator('#loginEmailErr')).toHaveText('That email doesn’t look right.');
    await page.fill('#loginEmail', 'reader@example.com');
    await expect(page.locator('#loginEmailErr')).toBeEmpty();
    await page.fill('#loginPassword', 'hunter22');
    await expect(page.locator('#loginPasswordErr')).toBeEmpty();
    await press(page, isMobile, '#loginSubmit');

    await expect(page.locator('#loginDone')).toBeVisible();
    await expect(page.locator('#loginView')).toBeHidden();
    await expect(page.locator('#loginDoneText')).toHaveText('Signed in as reader@example.com.');
    await expect(page.locator('#loginDoneTitle')).toBeFocused();
    const logins = await page.evaluate(() => window.__logins);
    expect(logins).toEqual([{ method: 'email', mode: 'in', email: 'reader@example.com' }]);   // never the password

    // Closed and opened again, it starts fresh.
    await press(page, isMobile, '#loginDone [data-dlg-close]');
    await expect.poll(() => isOpen(page, 'login')).toBe(false);
    await press(page, isMobile, '.hud [data-login]');
    await expect(page.locator('#loginView')).toBeVisible();
    await expect(page.locator('#loginEmail')).toHaveValue('');
    await expect(page.locator('#loginPassword')).toHaveValue('');
  });

  test('Sign up turns it into the sign-up form, and back', async ({ page, isMobile }) => {
    await bootLanding(page);
    await press(page, isMobile, '.hud [data-login]');
    await press(page, isMobile, '#loginSwitch');
    await expect(page.locator('#loginTitle')).toHaveText('Create an account');
    await expect(page.locator('#loginSubmit')).toHaveText('Sign Up');
    await expect(page.locator('#loginSwitch')).toHaveText('Sign in');
    await expect(page.locator('#loginPassword')).toHaveAttribute('autocomplete', 'new-password');
    await page.fill('#loginEmail', 'new@example.com');
    await page.fill('#loginPassword', 'short');
    await press(page, isMobile, '#loginSubmit');
    await expect(page.locator('#loginPasswordErr')).toContainText('8 characters');
    await page.fill('#loginPassword', 'long-enough');
    await press(page, isMobile, '#loginSubmit');
    await expect(page.locator('#loginDoneText')).toHaveText('Account created for new@example.com.');

    await press(page, isMobile, '#loginDone [data-dlg-close]');
    await press(page, isMobile, '.hud [data-login]');
    await expect(page.locator('#loginTitle')).toHaveText('Welcome back');   // back to signing in
  });

  test('Continue with Google signs in', async ({ page, isMobile }) => {
    await bootLanding(page);
    await press(page, isMobile, '.hud [data-login]');
    await press(page, isMobile, '#loginGoogle');
    await expect(page.locator('#loginDoneText')).toHaveText('Signed in with Google.');
  });

  test('closes from the ×, Escape and the scrim, and hands focus back', async ({ page, isMobile }) => {
    await bootLanding(page);
    for (const closer of ['#login .dlg__x', 'Escape', 'scrim']) {
      if (closer === 'Escape' && isMobile) continue;
      await press(page, isMobile, '.hud [data-login]');
      await expect.poll(() => isOpen(page, 'login')).toBe(true);
      if (closer === 'Escape') await page.keyboard.press('Escape');
      else if (closer === 'scrim') await page.mouse.click(4, 300);
      else await press(page, isMobile, closer);
      await expect.poll(() => isOpen(page, 'login')).toBe(false);
      if (!isMobile) await expect(page.locator('.hud [data-login]')).toBeFocused();
    }
  });

  test('holds focus inside while it is open', async ({ page, isMobile }) => {
    test.skip(isMobile, 'keys');
    await bootLanding(page);
    await page.click('.hud [data-login]');
    for (const key of ['Tab', 'Shift+Tab']) {
      for (let k = 0; k < 12; k++) {
        await page.keyboard.press(key);
        expect(await page.evaluate(() => document.getElementById('login').contains(document.activeElement))).toBe(true);
      }
    }
  });

  test('opened over the open menu, it closes the menu first', async ({ page, isMobile }) => {
    await bootLanding(page);
    await press(page, isMobile, '#burger');
    await expect(page.locator('#siteMenu')).toHaveClass(/is-open/);
    await press(page, isMobile, '.hud [data-login]');
    await expect(page.locator('#siteMenu')).not.toHaveClass(/is-open/);
    expect(await holding(page, 'login')).toEqual({ behind: true, held: true, focusIn: true });
    if (isMobile) await page.tap('#login .dlg__x');
    else await page.keyboard.press('Escape');
    await expect.poll(() => isOpen(page, 'login')).toBe(false);
    expect(await page.evaluate(() => ({
      page: document.querySelector('[data-page]').inert,
      menu: document.getElementById('siteMenu').inert,
      stopped: window.__lenis.isStopped
    }))).toEqual({ page: false, menu: true, stopped: false });
  });
});

test.describe('the windows, reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('both still open and close', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/');
    await page.click('.hud [data-login]');
    await expect(page.getByRole('dialog', { name: 'Welcome back' })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.locator('#close').scrollIntoViewIfNeeded();
    await page.click('.close [data-faq]');
    await expect(page.getByRole('dialog', { name: 'Fair questions.' })).toBeVisible();
    await page.locator('#faq summary').first().click();
    await expect(page.locator('#faq .acc__a').first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect.poll(() => isOpen(page, 'faq')).toBe(false);
    expect(errors).toEqual([]);
  });
});
