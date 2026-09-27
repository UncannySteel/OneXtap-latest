// End-to-end checks for the company pages (About, Contact, Privacy): the
// footer leads to them, they keep the landing page's nav and header row and
// its type and colour, the way back works, and Contact's feedback window
// behaves as a window should.
import { test, expect } from '@playwright/test';

const PAGES = [
  { path: '/about/', title: 'About — Onextap', label: 'Company — About', h1: 'Not an ATS.' },
  { path: '/contact/', title: 'Contact — Onextap', label: 'Company — Contact', h1: 'Talk to us.' },
  { path: '/privacy/', title: 'Privacy — Onextap', label: 'Company — Privacy', h1: 'Yours, locally.' }
];

// Every chapter link in the menu, as the company pages rewrite it.
const MENU = ['/', '/#form', '/#how', '/#watch', '/#boards', '/#price', '/#close'];

function watchErrors(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  return errors;
}

async function openPage(page, path) {
  const errors = watchErrors(page);
  await page.goto(path);
  await page.waitForFunction(() => document.fonts.status === 'loaded');
  return errors;
}

async function bootLanding(page) {
  await page.waitForFunction(() => window.__stage && window.__stage.info().snapshotsPending === 0, null, { timeout: 30000 });
}

async function seek(page, t) {
  await page.evaluate(t => new Promise(done => {
    const i = window.__stage.info();
    window.__lenis.scrollTo(i.top + t * i.unit, { immediate: true, force: true });
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 80)));
  }), t);
}

const press = (page, isMobile, sel) => isMobile ? page.tap(sel) : page.click(sel);

test.describe('company pages', () => {
  test('the footer links to each of them', async ({ page }) => {
    await page.goto('/');
    const hrefs = await page.$$eval('.foot a', as => Object.fromEntries(as.map(a => [a.textContent.trim(), a.getAttribute('href')])));
    expect(hrefs).toMatchObject({ About: '/about/', Contact: '/contact/', Privacy: '/privacy/' });
  });

  test('clicking through from the footer, and Back returns to it', async ({ page, isMobile }) => {
    test.skip(isMobile, 'the footer links sit in its overflow on a phone');
    for (const p of PAGES) {
      await page.goto('/');
      await bootLanding(page);
      const foot = (await page.evaluate(() => window.__stage.info())).chapters.find(c => c.id === 'foot');
      await seek(page, foot.arrive + 0.05);
      await page.click(`.foot a[href="${p.path}"]`);
      await expect(page).toHaveURL(new RegExp(p.path + '$'));
      await expect(page).toHaveTitle(p.title);
      await page.click('.back');
      await expect(page).toHaveURL(/\/$/);
      await bootLanding(page);
      await expect.poll(() => page.textContent('#chapterLabel')).toBe('05 — Get hired');
    }
  });

  for (const p of PAGES) {
    test(`${p.path} keeps the nav, the header row, the type and the colours`, async ({ page, isMobile }) => {
      const errors = await openPage(page, p.path);
      await expect(page).toHaveTitle(p.title);
      await expect(page.locator('h1')).toHaveText(p.h1);

      // The spine, the burger, and the header row beside them.
      await expect(page.locator('.spine')).toBeVisible();
      await expect(page.locator('#burger')).toBeVisible();
      await expect(page.locator('.hud__cta')).toBeVisible();
      await expect(page.locator('.hud__mark')).toHaveAttribute('href', '/');
      await expect(page.locator('.spine__logo')).toHaveAttribute('href', '/');
      await expect.poll(() => page.textContent('#chapterLabel')).toBe(p.label);

      // The way back, at the top: the first thing on the page.
      const back = page.locator('.back');
      await expect(back).toBeVisible();
      const box = await back.boundingBox();
      expect(box.y).toBeLessThan(200);
      expect(await page.evaluate(() => document.querySelector('main a, main button') === document.querySelector('.back'))).toBe(true);

      // The landing page's palette and faces.
      const look = await page.evaluate(() => {
        const cs = s => getComputedStyle(document.querySelector(s));
        return {
          ground: getComputedStyle(document.body).backgroundColor,
          hero: cs('.sub-hero').backgroundColor,
          body: cs('.sub-body').backgroundColor,
          cta: cs('.hud__cta').backgroundColor,
          display: cs('h1').fontFamily,
          ui: getComputedStyle(document.body).fontFamily,
          voice: cs('.sub-hero__aside').fontFamily
        };
      });
      expect(look).toMatchObject({
        ground: 'rgb(12, 23, 16)', hero: 'rgb(12, 23, 16)', body: 'rgb(233, 228, 212)', cta: 'rgb(198, 218, 67)'
      });
      expect(look.display).toMatch(/^Archivo/);
      expect(look.ui).toMatch(/^"?Instrument Sans/);
      expect(look.voice).toMatch(/^"?Instrument Serif/);

      // The menu: opens over everything, holds the page, lists every chapter
      // back on the landing page, and closes with Escape (or its button).
      await press(page, isMobile, '#burger');
      await expect(page.locator('#siteMenu')).toHaveClass(/is-open/);
      await expect(page.locator('#burger')).toHaveAttribute('aria-expanded', 'true');
      await expect(page.locator('#burger')).toHaveAttribute('data-state', 'open');
      expect(await page.evaluate(() => ({
        page: document.querySelector('[data-page]').inert,
        menu: document.getElementById('siteMenu').inert,
        held: document.documentElement.classList.contains('menu-open')
      }))).toEqual({ page: true, menu: false, held: true });
      expect(await page.$$eval('#siteMenu a', as => as.map(a => a.getAttribute('href')))).toEqual(MENU);
      await expect(page.locator('#siteMenu .menu__word--alt').first()).toBeAttached();   // the italic twin
      if (isMobile) await page.tap('#burger');
      else await page.keyboard.press('Escape');
      await expect(page.locator('#siteMenu')).not.toHaveClass(/is-open/);
      if (!isMobile) await expect(page.locator('#burger')).toBeFocused();
      expect(await page.evaluate(() => document.querySelector('[data-page]').inert)).toBe(false);

      // Nothing overflows sideways, top to bottom.
      for (const y of [0, 0.5, 1]) {
        await page.evaluate(y => scrollTo(0, y * document.documentElement.scrollHeight), y);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
      expect(errors).toEqual([]);
    });
  }

  test('the open menu holds the page still', async ({ page, isMobile }) => {
    test.skip(isMobile, 'wheel and keys');
    await openPage(page, '/about/');
    await page.click('#burger');
    await page.mouse.move(700, 450);
    await page.mouse.wheel(0, 800);
    await page.keyboard.press('PageDown');
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => scrollY)).toBe(0);
    await page.keyboard.press('Escape');
    await page.mouse.wheel(0, 800);
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
  });

  test('a menu link goes home and lands straight on its chapter', async ({ page, isMobile }) => {
    await openPage(page, '/privacy/');
    await press(page, isMobile, '#burger');
    await press(page, isMobile, '#siteMenu a[href="/#price"]');
    await expect(page).toHaveURL(/\/$/);   // landed, and the hash dropped, as a jump leaves none
    await bootLanding(page);
    await expect.poll(() => page.textContent('#chapterLabel')).toBe('04 — Pricing');
    const i = await page.evaluate(() => window.__stage.info());
    const price = i.chapters.find(c => c.id === 'price');
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(Math.round(i.top + price.arrive * i.unit));
  });

  test('with nowhere of ours to go back to, Back goes home', async ({ page }) => {
    await openPage(page, '/privacy/');
    await page.click('.back');
    await expect(page).toHaveURL(/\/$/);
    await expect(page).toHaveTitle("We're Hiring (We're Not)");
  });

  test('between company pages, Back goes to the last one', async ({ page }) => {
    await openPage(page, '/about/');
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    await page.click('.page-foot a[href="/contact/"]');
    await expect(page).toHaveURL(/\/contact\/$/);
    await page.click('.back');
    await expect(page).toHaveURL(/\/about\/$/);
  });
});

test.describe('the feedback window', () => {
  const fb = page => page.locator('#feedback');

  test('pops up over the page, holds focus inside, and gives it back', async ({ page, isMobile }) => {
    const errors = await openPage(page, '/contact/');
    expect(await page.locator('[data-feedback]').count()).toBeGreaterThanOrEqual(2);
    await expect(fb(page)).not.toHaveClass(/is-open/);
    expect(await page.evaluate(() => document.getElementById('feedback').inert)).toBe(true);

    await press(page, isMobile, '.sub-hero [data-feedback]');
    await expect(fb(page)).toHaveClass(/is-open/);
    const dialog = page.getByRole('dialog', { name: 'Tell us straight.' });
    await expect(dialog).toBeVisible();
    const state = await page.evaluate(() => ({
      focusIn: document.getElementById('feedback').contains(document.activeElement),
      behind: [...document.body.children].filter(el => el.id !== 'feedback' && el.tagName !== 'SCRIPT').every(el => el.inert),
      held: document.documentElement.classList.contains('dlg-open'),
      z: +getComputedStyle(document.getElementById('feedback')).zIndex
    }));
    expect(state).toEqual({ focusIn: true, behind: true, held: true, z: 80 });

    // Tab never leaves the window.
    if (!isMobile) {
      for (const key of ['Tab', 'Shift+Tab']) {
        for (let n = 0; n < 12; n++) {
          await page.keyboard.press(key);
          expect(await page.evaluate(() => document.getElementById('feedback').contains(document.activeElement))).toBe(true);
        }
      }
      await page.keyboard.press('Escape');
      await expect(fb(page)).not.toHaveClass(/is-open/);
      await expect(page.locator('.sub-hero [data-feedback]')).toBeFocused();
    } else {
      await page.tap('#feedback .dlg__x');
      await expect(fb(page)).not.toHaveClass(/is-open/);
    }
    expect(await page.evaluate(() => [...document.body.children].some(el => !el.classList.contains('dlg') && el.id !== 'siteMenu' && el.inert))).toBe(false);
    expect(await page.evaluate(() => document.getElementById('siteMenu').inert)).toBe(true);   // the closed menu stays inert
    expect(await page.evaluate(() => document.getElementById('login').inert)).toBe(true);      // and so does the closed sign-in window
    expect(errors).toEqual([]);
  });

  test('closes from the ×, Cancel, and a click outside it', async ({ page, isMobile }) => {
    await openPage(page, '/contact/');
    for (const closer of ['#feedback .dlg__x', '.fb__actions [data-dlg-close]', 'scrim']) {
      await page.evaluate(() => document.querySelector('.sub-hero [data-feedback]').click());
      await expect(fb(page)).toHaveClass(/is-open/);
      if (closer === 'scrim') await page.mouse.click(5, 300);
      else await press(page, isMobile, closer);
      await expect(fb(page)).not.toHaveClass(/is-open/);
    }
  });

  test('checks the form, then says thanks', async ({ page, isMobile }) => {
    await openPage(page, '/contact/');
    await page.evaluate(() => { window.__notes = []; document.addEventListener('onextap:feedback', e => window.__notes.push(e.detail)); });
    await press(page, isMobile, '.fb-card [data-feedback]');
    await expect(fb(page)).toHaveClass(/is-open/);

    // Nothing written: the message is flagged and takes focus.
    await press(page, isMobile, '#fbSubmit');
    await expect(page.locator('#fbMessageErr')).toHaveText('Tell us what’s on your mind.');
    await expect(page.locator('#fbMessage')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#fbMessage')).toBeFocused();

    // Too short, and an email that isn't one.
    await page.fill('#fbMessage', 'meh');
    await page.fill('#fbEmail', 'not-an-email');
    await press(page, isMobile, '#fbSubmit');
    await expect(page.locator('#fbMessageErr')).toContainText('10 characters');
    await expect(page.locator('#fbEmailErr')).toHaveText('That email doesn’t look right.');

    // Fixed as it is typed.
    const note = 'Workday asked for my notice period twice on one page.';
    await page.fill('#fbMessage', note);
    await expect(page.locator('#fbMessageErr')).toBeEmpty();
    await expect(page.locator('#fbCount')).toHaveText(`${note.length} / 1000`);
    await page.fill('#fbEmail', 'reader@example.com');
    await expect(page.locator('#fbEmailErr')).toBeEmpty();
    await press(page, isMobile, '.fb__chip:has(input[value="board"])');
    await press(page, isMobile, '#fbSubmit');

    await expect(page.locator('#fbDone')).toBeVisible();
    await expect(page.locator('#fbForm')).toBeHidden();
    await expect(page.locator('#fbDoneTitle')).toBeFocused();
    const notes = await page.evaluate(() => window.__notes);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ kind: 'board', email: 'reader@example.com', page: '/contact/' });

    // Closed and opened again, it starts fresh.
    await press(page, isMobile, '#fbDone [data-dlg-close]');
    await expect(fb(page)).not.toHaveClass(/is-open/);
    await press(page, isMobile, '.sub-hero [data-feedback]');
    await expect(page.locator('#fbForm')).toBeVisible();
    await expect(page.locator('#fbMessage')).toHaveValue('');
  });

  test('holds the page still while it is open', async ({ page, isMobile }) => {
    test.skip(isMobile, 'wheel');
    await openPage(page, '/contact/');
    await page.click('.sub-hero [data-feedback]');
    await page.mouse.move(5, 450);
    await page.mouse.wheel(0, 800);
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => scrollY)).toBe(0);
  });
});

test.describe('company pages, reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  for (const p of PAGES) {
    test(`${p.path} shows everything at once, and the menu still works`, async ({ page }) => {
      const errors = await openPage(page, p.path);
      const r = await page.evaluate(() => ({
        noMotion: document.documentElement.classList.contains('no-motion'),
        split: document.querySelectorAll('.wi').length,
        hidden: [...document.querySelectorAll('[data-rise]')].filter(e => getComputedStyle(e).opacity !== '1').length
      }));
      expect(r).toEqual({ noMotion: true, split: 0, hidden: 0 });
      await page.click('#burger');
      await expect(page.locator('#siteMenu')).toHaveClass(/is-open/);
      await page.keyboard.press('Escape');
      await expect(page.locator('#siteMenu')).not.toHaveClass(/is-open/);
      expect(errors).toEqual([]);
    });
  }

  test('a menu link lands on its chapter on the landing page', async ({ page }) => {
    await openPage(page, '/about/');
    await page.click('#burger');
    await page.click('#siteMenu a[href="/#price"]');
    await expect(page).toHaveURL(/\/#price$/);
    await page.waitForSelector('#price');
    await expect.poll(() => page.evaluate(() => Math.round(document.getElementById('price').getBoundingClientRect().top))).toBe(0);
  });
});
