// Debug probe: Tab through the page and report where focus lands, which
// chapter the header shows, and whether the focused element is on screen.
import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(process.argv[2] || 'http://localhost:5181/', { waitUntil: 'load' });
await page.waitForFunction(() => window.__stage && window.__stage.info().snapshotsPending === 0);
for (let k = 0; k < 40; k++) {
  await page.keyboard.press('Tab');
  await page.waitForTimeout(1300);   // let Lenis bring the chapter on
  const r = await page.evaluate(() => {
    const el = document.activeElement;
    const layer = el.closest && el.closest('.layer');
    const box = el.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return {
      el: (el.id ? '#' + el.id : '') + (el.textContent || '').trim().slice(0, 28),
      layer: layer ? (layer.id || layer.classList[0]) : '(outside)',
      label: document.getElementById('chapterLabel').textContent,
      visible: !!hit && (hit === el || el.contains(hit))
    };
  });
  console.log(String(k).padStart(2), r.visible ? 'OK ' : 'HID', r.layer.padEnd(9), '|', r.label.padEnd(20), '|', r.el);
}
await browser.close();
