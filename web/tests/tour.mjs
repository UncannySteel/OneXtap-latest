// Visual tour: steps the stage through every chapter and transition at a set
// of device sizes and saves a frame at each stop, for eyeballing.
//   node tests/tour.mjs [baseURL] [outDir] [engine] [viewport-name|all] [label-regex]
import { chromium, webkit } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const base = process.argv[2] || 'http://localhost:5181/';
const out = process.argv[3] || 'tour-out';
const engine = process.argv[4] || 'chromium';
const only = process.argv[5] && process.argv[5] !== 'all' ? process.argv[5] : null;
const pick = process.argv[6] ? new RegExp(process.argv[6]) : null;

const VIEWPORTS = [
  { name: 'desktop-1440', viewport: { width: 1440, height: 900 } },
  { name: 'laptop-1280x720', viewport: { width: 1280, height: 720 } },
  { name: 'tablet-768', viewport: { width: 768, height: 1024 }, hasTouch: true },
  { name: 'phone-390', viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: engine === 'chromium', hasTouch: true }
].filter(v => !only || v.name === only);

const browserType = engine === 'webkit' ? webkit : chromium;
const browser = await browserType.launch();

for (const vp of VIEWPORTS) {
  const dir = path.join(out, engine + '-' + vp.name);
  fs.mkdirSync(dir, { recursive: true });
  const context = await browser.newContext(vp);
  const page = await context.newPage();
  const logs = [];
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', e => logs.push('pageerror: ' + e.message));

  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__stage && window.__stage.info().snapshotsPending === 0, null, { timeout: 30000 });
  const info = await page.evaluate(() => window.__stage.info());

  // Stops: each chapter on arrival, and each transition at a quarter, half
  // and three quarters of the way through.
  const stops = [];
  info.chapters.forEach((ch, i) => {
    if (i > 0) {
      const prev = info.chapters[i - 1];
      const a = ch.start, b = prev.end;
      [0.2, 0.45, 0.7, 0.9].forEach(f => stops.push({ t: a + (b - a) * f, label: `${String(i).padStart(2, '0')}-into-${ch.id}-${Math.round(f * 100)}` }));
    }
    stops.push({ t: ch.arrive + 0.02, label: `${String(i).padStart(2, '0')}-${ch.id}-arrive` });
    if (ch.over > 0) stops.push({ t: ch.arrive + ch.over / info.unit, label: `${String(i).padStart(2, '0')}-${ch.id}-scrolled` });
  });
  // The hero's own crumple, inside chapter 0.
  [0.3, 0.7, 0.95, 1.2, 1.5, 1.8, 2.2].forEach(t => stops.push({ t, label: `00-hero-${t.toFixed(2)}` }));
  stops.sort((x, y) => x.t - y.t);

  for (const s of stops.filter(s => !pick || pick.test(s.label))) {
    await page.evaluate(({ y }) => new Promise(res => {
      window.__lenis.scrollTo(y, { immediate: true, force: true });
      requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(res, 120)));
    }), { y: info.top + s.t * info.unit });
    await page.screenshot({ path: path.join(dir, s.label + '.png') });
  }

  const meta = await page.evaluate(() => ({
    hScroll: document.documentElement.scrollWidth > window.innerWidth + 1,
    info: window.__stage.info()
  }));
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ ...meta, logs }, null, 2));
  console.log(vp.name, 'stops:', stops.length, 'hScroll:', meta.hScroll, 'webgl:', meta.info.webgl, 'logs:', logs.length ? logs : 'none');
  console.log('  chapters:', meta.info.chapters.map(c => `${c.id}@${c.arrive.toFixed(2)}${c.over ? ` (over ${c.over}px)` : ''}`).join(' | '));
  await context.close();
}
await browser.close();
