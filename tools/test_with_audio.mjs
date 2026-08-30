import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const browser = await chromium.launch({
  headless: false,
  args: ['--use-gl=angle', '--autoplay-policy=no-user-gesture-required'],
});
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on('console', (m) => {
  const t = m.text();
  if (t.includes('[export]') || t.includes('[audio]') || m.type() === 'error') console.log('[' + m.type() + ']', t);
});
page.on('pageerror', (e) => console.error('[pageerror]', e.message));
page.on('close', () => console.log('[page] closed'));

await page.goto('http://localhost:8765/', { waitUntil: 'networkidle' });
const showcase = await (await fetch('http://localhost:8765/showcase.json')).text();
await page.evaluate((j) => { document.getElementById('json-view').value = j; document.getElementById('btn-apply-json').click(); }, showcase);
await page.waitForTimeout(1000);
await page.evaluate(() => {
  window.__blob = null;
  window.showSaveFilePicker = async () => ({
    name: 'AudioTest.webm',
    createWritable: async () => { const parts = []; return {
      write: async (b) => parts.push(new Uint8Array(await b.arrayBuffer())),
      close: async () => { let n=0; for (const p of parts) n+=p.byteLength; const o=new Uint8Array(n); let x=0; for (const p of parts){o.set(p,x);x+=p.byteLength;} window.__blob=o; },
    };},
  });
});
await page.evaluate(() => document.getElementById('btn-record').click());
await page.waitForTimeout(500);
await page.evaluate(() => {
  document.getElementById('record-filename').value = 'AudioTest';
  document.getElementById('record-format').value = 'webm';
  document.getElementById('record-audio').checked = true;
  document.getElementById('btn-record-start').click();
});
const start = Date.now();
try {
  while (Date.now() - start < 90000) {
    const done = await page.evaluate(() => !!window.__blob).catch(() => false);
    if (done) break;
    await page.waitForTimeout(500);
  }
  const bytes = await page.evaluate(() => Array.from(window.__blob || []));
  writeFileSync('/tmp/AudioTest.webm', Buffer.from(bytes));
  console.log('Wrote', bytes.length, 'bytes');
} catch (e) {
  console.error('poll error:', e.message);
}
await browser.close();
