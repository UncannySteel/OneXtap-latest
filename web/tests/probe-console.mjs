// Debug probe: print an engine's console output for one page load.
import { webkit, chromium } from '@playwright/test';
const engine = process.argv[2] === 'chromium' ? chromium : webkit;
const filter = process.argv[4] ? new RegExp(process.argv[4]) : null;
const browser = await engine.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', m => { if (!filter || filter.test(m.text())) console.log(m.type(), m.text()); });
page.on('pageerror', e => console.log('pageerror', e.message));
await page.goto(process.argv[3] || 'http://localhost:5181/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await browser.close();
