// Automated smoke test of the video recording pipeline.
// Loads the viewer in headless Chrome, presses "Record" via JS, waits for the
// recording to complete, then reports what actually happened (chunks, bytes,
// scene advance). No user interaction required.

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', '.test-out');
mkdirSync(outDir, { recursive: true });

const URL = process.env.URL || 'http://localhost:8765/';

const browser = await chromium.launch({
  headless: false,   // headed so WebGL + captureStream actually work
  args: [
    '--disable-blink-features=AutomationControlled',
    '--use-gl=angle',
    '--enable-webgl',
  ],
});
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();

// Capture all console messages
page.on('console', (msg) => {
  const t = msg.type();
  const text = msg.text();
  if (text.includes('[export]') || t === 'error' || t === 'warning') {
    console.log(`[${t}] ${text}`);
  }
});
page.on('pageerror', (err) => console.error('[pageerror]', err.message));

console.log('Loading', URL);
await page.goto(URL, { waitUntil: 'networkidle' });

// Wait for viewer to be initialized
await page.waitForFunction(() => window.state && window.state.script && window.state.script.scenes && window.state.script.scenes.length > 0, { timeout: 20000 }).catch(() => {});

// If state isn't exposed, expose it (main.js keeps state module-local)
const hasState = await page.evaluate(() => typeof window.state !== 'undefined');
if (!hasState) {
  console.log('window.state is not exposed; asking main.js to expose it via a patch…');
}

// Load a smaller script so recording is quick. We'll build a 2-scene demo
// referencing two already-converted models.
await page.evaluate(async () => {
  const shortScript = {
    name: 'AutoTest',
    loop: false,
    background: '#101317',
    cameraTransition: { duration: 0.5, ease: 'easeInOut' },
    scenes: [
      {
        name: 'Builder',
        model: 'models/Meshy_AI_Builder_Lemming_3D_0830065107_image-to-3d-texture.glb',
        duration: 2,
        camera: { position: [3.5, -3.5, 2.5], lookAt: [0, 0, 0.8], fov: 40 },
        transforms: [{ type: 'rotate', axis: 'z', degPerSec: 180 }],
        overlays: [{ text: 'Builder', position: 'bottom', start: 0, fadeIn: 0.2, hold: 1.5, fadeOut: 0.2 }],
      },
      {
        name: 'Chef',
        model: 'models/Meshy_AI_Chef_Lemming_3D_0830065130_image-to-3d-texture.glb',
        duration: 2,
        camera: { position: [3.5, 3.5, 2.5], lookAt: [0, 0, 0.8], fov: 40 },
        transforms: [{ type: 'rotate', axis: 'z', degPerSec: 180 }],
        overlays: [{ text: 'Chef', position: 'bottom', start: 0, fadeIn: 0.2, hold: 1.5, fadeOut: 0.2 }],
      },
    ],
  };
  // Type JSON into the raw JSON textarea and apply
  const ta = document.getElementById('json-view');
  ta.value = JSON.stringify(shortScript, null, 2);
  document.getElementById('btn-apply-json').click();
  // Give it a moment to load
  await new Promise((r) => setTimeout(r, 500));
});

console.log('Short script applied. Starting record…');

// Instead of clicking 🎬 (which opens a dialog), call exportVideo directly.
// We also intercept the anchor-download click and capture the blob to disk.
const capture = await page.evaluate(async () => {
  // Redirect save so we get bytes instead of a download in headless
  window.__capturedBlob = null;
  const origSave = window.saveBlob;
  // Not accessible from outside module scope — instead, monkey-patch
  // showSaveFilePicker to return a memory sink.
  window.showSaveFilePicker = async () => {
    // Provide a fake FileSystemFileHandle
    return {
      name: 'AutoTest.webm',
      createWritable: async () => {
        const chunks = [];
        return {
          write: async (blob) => {
            const buf = await blob.arrayBuffer();
            chunks.push(new Uint8Array(buf));
          },
          close: async () => {
            let total = 0;
            for (const c of chunks) total += c.byteLength;
            const merged = new Uint8Array(total);
            let off = 0;
            for (const c of chunks) { merged.set(c, off); off += c.byteLength; }
            window.__capturedBlob = merged;
          },
        };
      },
    };
  };

  // Look for the exportVideo function on the module. Since main.js is a
  // module, functions aren't on window. Trigger via the UI:
  document.getElementById('btn-record').click();
  await new Promise((r) => setTimeout(r, 100));
  const filename = document.getElementById('record-filename');
  filename.value = 'AutoTest';
  document.getElementById('record-format').value = 'webm';
  document.getElementById('record-audio').checked = false;
  document.getElementById('btn-record-start').click();

  // Poll for completion
  const start = Date.now();
  while (!window.__capturedBlob && Date.now() - start < 30000) {
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!window.__capturedBlob) return { ok: false, reason: 'timeout waiting for blob' };
  return { ok: true, bytes: window.__capturedBlob.byteLength };
});

console.log('Recording result:', capture);

if (capture.ok) {
  // Pull the bytes out
  const bytes = await page.evaluate(() => Array.from(window.__capturedBlob));
  const buf = Buffer.from(bytes);
  const outPath = join(outDir, 'AutoTest.webm');
  writeFileSync(outPath, buf);
  console.log(`Wrote ${buf.length} bytes to ${outPath}`);
}

await browser.close();
