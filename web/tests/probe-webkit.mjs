// Debug probe: how does an engine resolve the stage's viewport units?
import { webkit, chromium } from '@playwright/test';
const engine = process.argv[2] === 'chromium' ? chromium : webkit;
const browser = await engine.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(process.argv[3] || 'http://localhost:5181/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__stage);
console.log(JSON.stringify(await page.evaluate(() => {
  const stage = document.getElementById('stage');
  const p = document.createElement('div');
  document.body.appendChild(p);
  const measure = (css) => { p.style.cssText = 'position:fixed;top:0;left:0;width:1px;' + css; return p.getBoundingClientRect().height; };
  const out = {
    innerHeight, stageClient: stage.clientHeight, stageCss: getComputedStyle(stage).height,
    vh: measure('height:100vh'), svh: measure('height:100svh'), lvh: measure('height:100lvh'), dvh: measure('height:100dvh'),
    supports: { svh: CSS.supports('height', '100svh'), lvh: CSS.supports('height', '100lvh') },
    body: document.getElementById('form').querySelector('.ch__body').offsetHeight,
    layer: document.getElementById('form').clientHeight,
    info: window.__stage.info().chapters.map(c => c.over)
  };
  p.remove();
  return out;
}), null, 1));
await browser.close();
