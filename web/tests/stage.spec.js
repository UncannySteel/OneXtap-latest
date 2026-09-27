// End-to-end checks for the stage: every chapter, every transition, and the
// features that have to keep working through all of it.
import { test, expect } from '@playwright/test';

async function boot(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/');
  await page.waitForFunction(() => window.__stage && window.__stage.info().snapshotsPending === 0, null, { timeout: 30000 });
  return errors;
}

const info = page => page.evaluate(() => window.__stage.info());
const chapter = (i, id) => i.chapters.find(c => c.id === id);

// Jump the scroll to timeline time `t` (in screens) and let a frame render.
async function seek(page, t) {
  await page.evaluate(t => new Promise(done => {
    const i = window.__stage.info();
    window.__lenis.scrollTo(i.top + t * i.unit, { immediate: true, force: true });
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 80)));
  }), t);
}

// The hero's sign is crumpled from 0.55 to 1.85 screens in (features/hero).
const CRUMPLE_MID = 0.55 + 1.3 * 0.4;

const handOff = page => page.evaluate(() => ({
  canvas: getComputedStyle(document.querySelector('canvas.fx')).visibility,
  sign: getComputedStyle(document.getElementById('signLayer')).visibility
}));

test.describe('stage', () => {
  test('boots cleanly, with every chapter a full-screen layer', async ({ page }) => {
    const errors = await boot(page);
    const i = await info(page);
    expect(i.chapters.map(c => c.id)).toEqual(['hero', 'form', 'how', 'watch', 'boards', 'price', 'close', 'foot']);
    const sizes = await page.evaluate(() => {
      const stage = document.getElementById('stage');
      return [...document.querySelectorAll('.layer')].map(l => ({ w: l.offsetWidth, h: l.offsetHeight, sw: stage.clientWidth, sh: stage.clientHeight }));
    });
    for (const s of sizes) {
      expect(s.w).toBe(s.sw);
      expect(s.h).toBeGreaterThanOrEqual(s.sh);
    }
    expect(errors).toEqual([]);
  });

  test('each chapter arrives on top, and the header names it', async ({ page }) => {
    await boot(page);
    for (const ch of (await info(page)).chapters) {
      await seek(page, ch.arrive + 0.05);
      const r = await page.evaluate(() => {
        const layer = document.elementFromPoint(innerWidth / 2, innerHeight / 2).closest('.layer');
        return { id: layer.id || layer.classList[0], chapter: layer.getAttribute('data-chapter') };
      });
      expect(r.id).toBe(ch.id);
      await expect.poll(() => page.textContent('#chapterLabel')).toBe(r.chapter);
    }
  });

  test('nothing overflows sideways at any point', async ({ page }) => {
    await boot(page);
    const i = await info(page);
    for (let t = 0; t < i.duration; t += 0.5) {
      await seek(page, t);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  });

  test('a crumple hands the section to WebGL, and back when scrolled up', async ({ page }) => {
    await boot(page);
    const i = await info(page);
    test.skip(!i.webgl, 'no WebGL in this browser');
    await seek(page, CRUMPLE_MID);
    expect(await handOff(page)).toEqual({ canvas: 'visible', sign: 'hidden' });
    await seek(page, 0.3);
    expect(await handOff(page)).toEqual({ canvas: 'hidden', sign: 'visible' });
  });

  test('a lost WebGL context drops to the CSS crumple mid-exit', async ({ page }) => {
    await boot(page);
    const i = await info(page);
    test.skip(!i.webgl, 'no WebGL in this browser');
    await seek(page, CRUMPLE_MID);
    await page.evaluate(() => {
      const c = document.querySelector('canvas.fx');
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      gl.getExtension('WEBGL_lose_context').loseContext();
    });
    await expect.poll(() => page.evaluate(() => {
      const s = getComputedStyle(document.getElementById('signLayer'));
      return s.visibility === 'visible' && s.clipPath.startsWith('polygon') && s.transform !== 'none';
    })).toBe(true);
  });

  // The form sinks away through a closing vignette onto the features, which
  // are already in place underneath — and it all plays back when scrolled up.
  test('the form sinks through the iris onto the features', async ({ page }) => {
    await boot(page);
    const i = await info(page);
    const how = chapter(i, 'how'), form = chapter(i, 'form');
    const state = () => page.evaluate(() => {
      const f = getComputedStyle(document.getElementById('form'));
      return {
        iris: parseFloat(f.getPropertyValue('--iris')),
        mask: (f.maskImage || f.webkitMaskImage).startsWith('radial-gradient'),
        form: f.opacity,
        how: getComputedStyle(document.getElementById('how')).opacity
      };
    });
    await seek(page, how.start + (form.end - how.start) * 0.5);
    const mid = await state();
    expect(mid.iris).toBeGreaterThan(0.2);
    expect(mid.iris).toBeLessThan(0.8);
    expect(mid).toMatchObject({ mask: true, form: '1', how: '1' });
    await seek(page, form.end + 0.02);
    expect(await state()).toMatchObject({ form: '0', how: '1' });
    await seek(page, how.start - 0.05);
    expect(await state()).toMatchObject({ iris: 0, form: '1', how: '0' });
  });

  // A menu link lands on the moment its chapter has arrived, in one step:
  // none of the story between is scrolled through on the way.
  test('menu links jump straight to their chapter', async ({ page, isMobile }) => {
    await boot(page);
    const i = await info(page);
    const press = sel => isMobile ? page.tap(sel) : page.click(sel);
    for (const [href, id, label] of [['#price', 'price', '04 — Pricing'], ['#form', 'form', '01 — The Paperwork'], ['#close', 'close', '05 — Get hired'], ['#top', 'hero', '00 — Overview']]) {
      await press('#burger');
      await expect(page.locator('#siteMenu')).toHaveClass(/is-open/);
      await page.evaluate(() => { window.__ys = []; addEventListener('scroll', window.__rec = () => window.__ys.push(Math.round(scrollY))); });
      await press(`#siteMenu a[href="${href}"]`);
      await expect.poll(() => page.textContent('#chapterLabel')).toBe(label);
      await expect(page.locator('#siteMenu')).not.toHaveClass(/is-open/);
      const ys = await page.evaluate(() => { removeEventListener('scroll', window.__rec); return [...new Set(window.__ys)]; });
      expect(ys.length).toBeLessThanOrEqual(1);
      expect(Math.abs(await page.evaluate(() => scrollY) - Math.round(i.top + chapter(i, id).arrive * i.unit))).toBeLessThanOrEqual(1);
    }
  });

  // Every other in-page link still scrolls there, through the story.
  test('in-page links still scroll to their chapter', async ({ page, isMobile }) => {
    test.skip(isMobile, 'the footer links sit in its overflow on a phone');
    await boot(page);
    await seek(page, chapter(await info(page), 'foot').arrive + 0.05);
    await page.click('.foot a[href="#price"]');
    await expect.poll(() => page.textContent('#chapterLabel'), { timeout: 15000 }).toBe('04 — Pricing');
  });

  test('the open menu holds the page still, and Escape gives it back', async ({ page, isMobile }) => {
    test.skip(isMobile, 'wheel and keys');
    await boot(page);
    await seek(page, chapter(await info(page), 'form').arrive);
    const y = await page.evaluate(() => scrollY);
    await page.click('#burger');
    await expect(page.locator('#burger')).toHaveAttribute('aria-expanded', 'true');
    await page.mouse.move(700, 450);
    await page.mouse.wheel(0, 800);
    await page.keyboard.press('PageDown');
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => scrollY)).toBe(y);
    await page.keyboard.press('Escape');
    await expect(page.locator('#siteMenu')).not.toHaveClass(/is-open/);
    await expect(page.locator('#burger')).toBeFocused();
    await page.mouse.wheel(0, 800);
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(y);
  });

  // The swap happens mid-spin, on the animation clock: allow for a software
  // renderer (see playwright.config.js) that only manages a few frames/sec.
  test('feature tabs still swap the deck', async ({ page, browserName }) => {
    const slow = browserName === 'webkit' ? 30000 : 5000;
    await boot(page);
    await seek(page, chapter(await info(page), 'how').arrive + 0.1);
    await page.click('#tab-profiles');
    await expect(page.locator('#tab-profiles')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#featDesc')).toContainText('One profile per direction', { timeout: slow });
    await expect.poll(() => page.evaluate(() =>
      document.querySelector('#railTrack .rcard:not([data-clone]) .rcard__t').textContent
    ), { timeout: slow }).toBe('One per direction');
  });

  test('the deck can still be dragged', async ({ page, isMobile, browserName }) => {
    test.skip(isMobile, 'mouse drag');
    test.slow(browserName === 'webkit', 'software renderer');
    await boot(page);
    await seek(page, chapter(await info(page), 'how').arrive + 0.1);
    const box = await page.locator('#rail').boundingBox();
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    const before = await page.evaluate(() => document.getElementById('railTrack').style.transform);
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx - 260, cy, { steps: 12 });
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => document.getElementById('railTrack').style.transform),
      { timeout: browserName === 'webkit' ? 30000 : 5000 }).not.toBe(before);
  });

  test('a new width rebuilds the stage without errors', async ({ page, isMobile }) => {
    test.skip(isMobile, 'desktop resize');
    const errors = await boot(page);
    await page.setViewportSize({ width: 820, height: 1180 });
    await page.waitForFunction(() => {
      const i = window.__stage.info();
      return i.unit === document.getElementById('stage').clientHeight && i.snapshotsPending === 0;
    }, null, { timeout: 20000 });
    const i = await info(page);
    await seek(page, chapter(i, 'price').arrive + 0.05);
    await expect.poll(() => page.textContent('#chapterLabel')).toBe('04 — Pricing');
    expect(errors).toEqual([]);
  });
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('reads as plain full-height sections with every state shown', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('/');
    const r = await page.evaluate(() => ({
      live: document.getElementById('stage').classList.contains('stage--live'),
      noMotion: document.documentElement.classList.contains('no-motion'),
      canvas: !!document.querySelector('canvas.fx'),
      heights: [...document.querySelectorAll('.layer')].map(l => l.offsetHeight),
      vh: innerHeight,
      fill: getComputedStyle(document.querySelector('.field')).getPropertyValue('--fill').trim(),
      strike: getComputedStyle(document.getElementById('strike')).transform
    }));
    expect(r.live).toBe(false);
    expect(r.noMotion).toBe(true);
    expect(r.canvas).toBe(false);
    for (const h of r.heights) expect(h).toBeGreaterThanOrEqual(r.vh - 1);
    expect(r.fill).toBe('1');
    expect(r.strike).toBe('matrix(1, 0, 0, 1, 0, 0)');
    // The tabs are content, not decoration: they must still switch.
    await page.click('#tab-storage');
    await expect(page.locator('#featDesc')).toContainText('Your profile stays in your browser');
    expect(errors).toEqual([]);
  });

  test('the menu still opens, and its links are plain anchors', async ({ page }) => {
    await page.goto('/');
    await page.click('#burger');
    await expect(page.locator('#siteMenu')).toHaveClass(/is-open/);
    await page.click('#siteMenu a[href="#price"]');
    await expect(page.locator('#siteMenu')).not.toHaveClass(/is-open/);
    await expect.poll(() => page.evaluate(() => Math.round(document.getElementById('price').getBoundingClientRect().top))).toBe(0);
  });
});
