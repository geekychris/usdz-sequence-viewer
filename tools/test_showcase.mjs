import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';

const browser = await chromium.launch({ headless: false, args: ['--use-gl=angle'] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.text().includes('[export]')) console.log(m.text()); });
page.on('pageerror', (e) => console.error('[pageerror]', e.message));

await page.goto('http://localhost:8765/', { waitUntil: 'networkidle' });
// Load showcase.json via the raw JSON view
const showcase = await (await fetch('http://localhost:8765/showcase.json')).text();
await page.evaluate((json) => {
  document.getElementById('json-view').value = json;
  document.getElementById('btn-apply-json').click();
}, showcase);
await page.waitForTimeout(500);

// Monkey-patch showSaveFilePicker to sink to memory
await page.evaluate(() => {
  window.__blob = null;
  window.showSaveFilePicker = async () => ({
    name: 'ShowcaseAuto.webm',
    createWritable: async () => {
      const parts = [];
      return {
        write: async (blob) => { parts.push(new Uint8Array(await blob.arrayBuffer())); },
        close: async () => {
          let n = 0; for (const p of parts) n += p.byteLength;
          const out = new Uint8Array(n); let o = 0;
          for (const p of parts) { out.set(p, o); o += p.byteLength; }
          window.__blob = out;
        },
      };
    },
  });
});

// Trigger record via UI (skip audio to keep it simple)
await page.evaluate(() => {
  document.getElementById('btn-record').click();
});
await page.waitForTimeout(200);
await page.evaluate(() => {
  document.getElementById('record-filename').value = 'ShowcaseAuto';
  document.getElementById('record-format').value = 'webm';
  document.getElementById('record-audio').checked = false;
  document.getElementById('btn-record-start').click();
});

// showcase is ~48s; wait up to 80s
const start = Date.now();
let done = false;
while (!done && Date.now() - start < 90000) {
  await page.waitForTimeout(500);
  done = await page.evaluate(() => !!window.__blob);
}
if (!done) { console.error('timeout'); process.exit(1); }

const bytes = await page.evaluate(() => Array.from(window.__blob));
const buf = Buffer.from(bytes);
writeFileSync('.test-out/ShowcaseAuto.webm', buf);
console.log('Wrote', buf.length, 'bytes');
await browser.close();
