// Capture documentation screenshots via Playwright.
// Requires the local server running on http://localhost:8765/.
//
// Usage:  node tools/capture_docs.mjs
// Output: docs/screenshots/NN-name.png

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const shotsDir = join(__dirname, '..', 'docs', 'screenshots');
mkdirSync(shotsDir, { recursive: true });

const URL = process.env.URL || 'http://localhost:8765/';

const browser = await chromium.launch({
  headless: false,
  args: ['--use-gl=angle', '--autoplay-policy=no-user-gesture-required'],
});
const ctx = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 2,   // retina crispness
});
const page = await ctx.newPage();
page.on('pageerror', (e) => console.error('[pageerror]', e.message));

console.log('Loading', URL);
await page.goto(URL, { waitUntil: 'networkidle' });

// Load the showcase script for consistent, feature-rich state
const showcase = await (await fetch('http://localhost:8765/showcase.json')).text();
await page.evaluate((j) => {
  document.getElementById('json-view').value = j;
  document.getElementById('btn-apply-json').click();
}, showcase);
await page.waitForTimeout(1500);

const shot = async (name, opts = {}) => {
  const p = join(shotsDir, name);
  await page.waitForTimeout(opts.settle || 300);
  await page.screenshot({ path: p, fullPage: false, ...opts });
  console.log(' 📸', name);
};

// ---- 01: full app overview ----
await shot('01-overview.png');

// ---- 02: sequence editor with first scene selected ----
await page.evaluate(() => document.querySelectorAll('.scene-item')[0]?.click());
await page.waitForTimeout(500);
await shot('02-sequence-editor.png');

// ---- 03: scene form fully visible (scroll editor to top) ----
await page.evaluate(() => {
  document.getElementById('editor-scroll').scrollTop = 0;
});
await shot('03-scene-form.png');

// ---- 04: transport + timeline close-up ----
await shot('04-transport.png', {
  clip: { x: 1180, y: 68, width: 840 * 2, height: 100 * 2 },
});
// Clip coords assume 2x DPR. Since Playwright screenshots respect deviceScaleFactor,
// clip should use CSS pixels. Recompute:
await page.screenshot({
  path: join(shotsDir, '04-transport.png'),
  clip: { x: 1180, y: 68, width: 420, height: 100 },
});
console.log(' 📸 04-transport.png (clipped)');

// ---- 05: scene list with badge ----
await page.screenshot({
  path: join(shotsDir, '05-scene-list.png'),
  clip: { x: 1180, y: 180, width: 420, height: 380 },
});
console.log(' 📸 05-scene-list.png (clipped)');

// ---- 06: scroll editor to show transforms ----
await page.evaluate(() => {
  const s = document.getElementById('editor-scroll');
  s.scrollTop = 500;
});
await page.waitForTimeout(300);
await shot('06-transforms.png');

// ---- 07: overlays block ----
await page.evaluate(() => {
  const s = document.getElementById('editor-scroll');
  s.scrollTop = 900;
});
await page.waitForTimeout(300);
await shot('07-overlays.png');

// ---- 08: audio block ----
await page.evaluate(() => {
  const s = document.getElementById('editor-scroll');
  s.scrollTop = 1300;
});
await page.waitForTimeout(300);
await shot('08-audio.png');

// ---- 09: raw JSON panel expanded ----
await page.evaluate(() => {
  // Expand the JSON section (click the header if collapsed)
  const jsonSection = document.getElementById('section-json');
  if (jsonSection.classList.contains('collapsed')) {
    jsonSection.querySelector('.section-head').click();
  }
});
await page.waitForTimeout(300);
await page.evaluate(() => {
  const s = document.getElementById('editor-scroll');
  s.scrollTop = s.scrollHeight;
});
await page.waitForTimeout(300);
await shot('09-raw-json.png');

// ---- 10: playing state (scene 2, mid-rotation) ----
await page.evaluate(() => {
  const s = document.getElementById('editor-scroll');
  s.scrollTop = 0;
});
await page.evaluate(() => document.getElementById('btn-play').click());
await page.waitForTimeout(2500);
await shot('10-playing.png');
await page.evaluate(() => document.getElementById('btn-stop').click());
await page.waitForTimeout(500);

// ---- 11: gallery mode ----
await page.evaluate(() => document.querySelector('.mode-tab[data-mode=gallery]').click());
// Wait for all models to load into gallery — takes a while (~10s)
for (let i = 0; i < 30; i++) {
  const done = await page.evaluate(() => {
    const s = document.getElementById('gallery-status');
    return s && /Loaded \d+\/\d+\. Click/.test(s.textContent);
  });
  if (done) break;
  await page.waitForTimeout(500);
}
await page.waitForTimeout(2000);   // let cells spin into a nice pose
await shot('11-gallery.png');

// ---- 12: detail mode ----
// Click a specific cell via raycasting — simulate click at the wizard's position.
// Easier: use the JS API to enter detail directly.
await page.evaluate(() => {
  // Get the first cell's userData path and label; call enterDetail via a click
  // simulation. We'll dispatch a click event at the center of a specific cell.
  // Simpler: find the manifest and click via the app's own click handler.
  const canvas = document.querySelector('#viewer canvas');
  const rect = canvas.getBoundingClientRect();
  // Click roughly at the wizard's grid cell (bottom-right area)
  const e = new MouseEvent('click', {
    bubbles: true,
    clientX: rect.left + rect.width * 0.7,
    clientY: rect.top + rect.height * 0.65,
  });
  canvas.dispatchEvent(e);
});
await page.waitForTimeout(2500);
await shot('12-detail.png');

// Back to sequence
await page.evaluate(() => document.getElementById('btn-detail-back').click());
await page.waitForTimeout(1500);
await page.evaluate(() => document.querySelector('.mode-tab[data-mode=sequence]').click());
await page.waitForTimeout(1000);

// ---- 13: recording dialog ----
await page.evaluate(() => document.getElementById('btn-record').click());
await page.waitForTimeout(500);
await shot('13-record-dialog.png');
await page.evaluate(() => document.getElementById('btn-record-cancel').click());
await page.waitForTimeout(300);

// ---- 14: drag reorder indicator (simulated) ----
// Programmatically add the drag-over style to a row so it appears in the shot.
await page.evaluate(() => {
  document.getElementById('editor-scroll').scrollTop = 0;
  const items = document.querySelectorAll('.scene-item');
  if (items[2]) items[2].classList.add('drag-over-before');
  if (items[0]) items[0].classList.add('dragging');
});
await page.waitForTimeout(300);
await page.screenshot({
  path: join(shotsDir, '14-drag-reorder.png'),
  clip: { x: 1180, y: 180, width: 420, height: 380 },
});
console.log(' 📸 14-drag-reorder.png (clipped)');
// Clean up the visual state
await page.evaluate(() => {
  document.querySelectorAll('.scene-item').forEach((el) =>
    el.classList.remove('drag-over-before', 'dragging'));
});

// ---- 15: fullscreen present mode ----
// Enter present mode (adds body.present-mode class + hides editor)
await page.evaluate(() => {
  // Manually add class instead of requestFullscreen (which needs real user gesture)
  document.body.classList.add('present-mode');
  window.state.present = true;
  // Show exit button + hide editor per CSS
});
// Play so the model appears with overlay
await page.evaluate(() => document.getElementById('btn-play').click());
await page.waitForTimeout(2500);
await shot('15-fullscreen.png');
// Exit
await page.evaluate(() => {
  document.body.classList.remove('present-mode');
  window.state.present = false;
  document.getElementById('btn-stop').click();
});
await page.waitForTimeout(500);

// ---- 16: mode tabs / header close-up ----
await page.screenshot({
  path: join(shotsDir, '16-mode-tabs.png'),
  clip: { x: 1180, y: 12, width: 420, height: 46 },
});
console.log(' 📸 16-mode-tabs.png (clipped)');

console.log('Done!');
await browser.close();
