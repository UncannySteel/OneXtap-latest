// Debug probe: frames per second while the feature deck spins, for one URL.
//   node tests/probe-fps.mjs <webkit|chromium> <url> [dpr]
import { webkit, chromium, devices } from '@playwright/test';
const engine = process.argv[2] === 'chromium' ? chromium : webkit;
const url = process.argv[3];
const dpr = Number(process.argv[4] || 2);
const browser = await engine.launch();
const page = await browser.newPage({ ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 }, deviceScaleFactor: dpr });
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(1500);
await page.evaluate(() => {
  if (window.__stage) {
    const i = window.__stage.info(), how = i.chapters.find(c => c.id === 'how');
    window.__lenis.scrollTo(i.top + (how.arrive + 0.1) * i.unit, { immediate: true, force: true });
  } else {
    document.getElementById('rail').scrollIntoView({ block: 'center' });
  }
});
await page.waitForTimeout(800);
const count = () => page.evaluate(() => new Promise(done => {
  let n = 0; const t0 = performance.now();
  (function f() { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else done(n / 2); })();
}));
console.log(url, 'dpr', dpr, 'idle fps', await count());
await page.click('#tab-profiles');
console.log(url, 'dpr', dpr, 'spinning fps', await count());
await browser.close();
