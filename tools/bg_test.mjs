import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: false, args: ['--use-gl=angle'] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.error('[pageerror]', e.message));
page.on('console', (m) => { const t = m.text(); if (t.includes('failed') || m.type() === 'error') console.log('[' + m.type() + ']', t); });
await page.goto('http://localhost:8765/', { waitUntil: 'networkidle' });
// Clear localStorage so we load showcase fresh
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
const showcase = await (await fetch('http://localhost:8765/showcase.json')).text();
await page.evaluate((j) => { document.getElementById('json-view').value = j; document.getElementById('btn-apply-json').click(); }, showcase);
await page.waitForTimeout(2500);
await page.screenshot({ path: '/tmp/bg_test.png' });
await browser.close();
console.log('Saved /tmp/bg_test.png');
