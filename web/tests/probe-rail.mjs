// Debug probe: click a feature tab in one engine and watch what the rail does.
import { webkit, chromium, devices } from '@playwright/test';
const engine = process.argv[2] === 'chromium' ? chromium : webkit;
const browser = await engine.launch();
const page = await browser.newPage({ ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } });
page.on('console', m => console.log('console', m.type(), m.text()));
page.on('pageerror', e => console.log('pageerror', e.message, e.stack));
await page.goto(process.argv[3] || 'http://localhost:5181/', { waitUntil: 'load' });
await page.waitForFunction(() => window.__stage && window.__stage.info().snapshotsPending === 0, null, { timeout: 30000 });
const i = await page.evaluate(() => window.__stage.info());
const how = i.chapters.find(c => c.id === 'how');
await page.evaluate(y => window.__lenis.scrollTo(y, { immediate: true, force: true }), i.top + (how.arrive + 0.1) * i.unit);
await page.waitForTimeout(300);
const state = () => page.evaluate(() => ({
  desc: document.getElementById('featDesc').className,
  first: document.querySelector('#railTrack .rcard:not([data-clone]) .rcard__t').textContent,
  track: document.getElementById('railTrack').style.transform,
  ticks: window.__ticks
}));
await page.evaluate(() => { window.__ticks = 0; window.gsapTickProbe = () => window.__ticks++; });
console.log('before', await state());
await page.click('#tab-profiles');
for (let k = 0; k < 6; k++) { await page.waitForTimeout(400); console.log('after', k, await state()); }
await browser.close();
