import { chromium } from 'playwright';
import { join } from 'node:path';
const shotsDir = '/Users/chris/code/claude_world/model_viewer/docs/screenshots';

const browser = await chromium.launch({
  headless: false,
  args: ['--use-gl=angle', '--autoplay-policy=no-user-gesture-required'],
});
const ctx = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();

await page.goto('http://localhost:8765/', { waitUntil: 'networkidle' });
const showcase = await (await fetch('http://localhost:8765/showcase.json')).text();
await page.evaluate((j) => {
  document.getElementById('json-view').value = j;
  document.getElementById('btn-apply-json').click();
}, showcase);
await page.waitForTimeout(1500);

// Mode tabs close-up
await page.screenshot({
  path: join(shotsDir, '16-mode-tabs.png'),
  clip: { x: 1180, y: 12, width: 420, height: 46 },
});
console.log(' 📸 16-mode-tabs.png');

// Fullscreen: hide editor via CSS, play, capture
await page.addStyleTag({ content: `
  body.fake-present #app { grid-template-columns: 1fr !important; }
  body.fake-present #editor { display: none !important; }
  body.fake-present #hud { display: none !important; }
` });
await page.evaluate(() => document.body.classList.add('fake-present'));
await page.evaluate(() => document.getElementById('btn-play').click());
await page.waitForTimeout(2800);
await page.screenshot({ path: join(shotsDir, '15-fullscreen.png') });
console.log(' 📸 15-fullscreen.png');

await browser.close();
console.log('done');
