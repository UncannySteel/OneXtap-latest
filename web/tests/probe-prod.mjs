// Smoke test for a production build (no dev hooks): boots cleanly, the stage
// goes live, and the hero's crumple is drawn in WebGL from its snapshot.
//   node tests/probe-prod.mjs [url] [engine]
import { chromium, webkit } from '@playwright/test';
const url = process.argv[2] || 'http://localhost:5196/';
const engine = process.argv[3] === 'webkit' ? webkit : chromium;
const browser = await engine.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error' || /snapshot failed/.test(m.text())) errors.push(m.text()); });
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(3500);   // fonts, then the hero's snapshot
const state = await page.evaluate(() => new Promise(done => {
  const stage = document.getElementById('stage');
  // The hero crumple runs from ~0.55 to ~1.85 screens of scroll.
  window.scrollTo(0, stage.clientHeight * 1.0);
  requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => done({
    live: stage.classList.contains('stage--live'),
    devHook: 'undefined' !== typeof window.__stage,
    track: document.getElementById('stageTrack').style.height,
    canvas: getComputedStyle(document.querySelector('canvas.fx')).visibility,
    sign: getComputedStyle(document.getElementById('signLayer')).visibility
  }), 150)));
}));
console.log(JSON.stringify({ state, errors }, null, 1));
await browser.close();
