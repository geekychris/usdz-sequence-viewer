import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const browser = await chromium.launch({ headless: false, args: ['--use-gl=angle', '--force-device-scale-factor=2'] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.text().includes('[export]')) console.log(m.text()); });
await page.goto('http://localhost:8765/', { waitUntil: 'networkidle' });
const showcase = await (await fetch('http://localhost:8765/showcase.json')).text();
await page.evaluate((j) => { document.getElementById('json-view').value = j; document.getElementById('btn-apply-json').click(); }, showcase);
await page.waitForTimeout(500);
await page.evaluate(() => {
  window.__blob = null;
  window.showSaveFilePicker = async () => ({
    name: 'RetinaTest.webm',
    createWritable: async () => { const parts = []; return {
      write: async (b) => parts.push(new Uint8Array(await b.arrayBuffer())),
      close: async () => { let n=0; for (const p of parts) n+=p.byteLength; const o=new Uint8Array(n); let x=0; for (const p of parts){o.set(p,x);x+=p.byteLength;} window.__blob=o; },
    };},
  });
});
await page.evaluate(() => {
  document.getElementById('btn-record').click();
});
await page.waitForTimeout(200);
await page.evaluate(() => {
  document.getElementById('record-filename').value = 'RetinaTest';
  document.getElementById('record-format').value = 'webm';
  document.getElementById('record-audio').checked = false;
  document.getElementById('btn-record-start').click();
});
const start = Date.now();
while (!(await page.evaluate(() => !!window.__blob)) && Date.now() - start < 90000) await page.waitForTimeout(500);
const bytes = await page.evaluate(() => Array.from(window.__blob || []));
writeFileSync('/tmp/RetinaTest.webm', Buffer.from(bytes));
console.log('Wrote', bytes.length, 'bytes');
await browser.close();
