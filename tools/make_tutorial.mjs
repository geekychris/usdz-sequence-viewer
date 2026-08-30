// Create a narrated screencast walking through building a project from scratch.
//
// Pipeline:
//   1. Generate a Kokoro TTS mp3 for each narration segment (cached in /tmp/tutorial/audio)
//   2. Read each mp3's duration via ffprobe
//   3. Playwright drives the UI with recordVideo enabled, waiting per-segment
//      for narration_duration + 1s gap
//   4. Concat all narration mp3s (with 1s silence between them) → single audio track
//   5. ffmpeg mux video + audio → tutorial.mp4
//
// Requires: kokoro-server running on 127.0.0.1:8770, ffmpeg on PATH, local
// viewer server on http://localhost:8765/.

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync, existsSync, copyFileSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';

const outDir = '/tmp/tutorial';
mkdirSync(outDir, { recursive: true });
mkdirSync(outDir + '/audio', { recursive: true });
mkdirSync(outDir + '/video', { recursive: true });

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------
async function kokoro(text, outPath) {
  const body = JSON.stringify({
    jsonrpc: '2.0', method: 'tools/call', id: 1,
    params: { name: 'speak', arguments: { text, voice: 'af_bella', format: 'mp3', output_path: outPath } },
  });
  const r = await fetch('http://127.0.0.1:8770/mcp', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
  });
  const j = await r.json();
  if (j.error) throw new Error('kokoro: ' + JSON.stringify(j.error));
}

function audioDuration(path) {
  const s = execSync(
    `ffprobe -v error -show_entries format=duration -of csv=p=0 "${path}"`,
    { encoding: 'utf-8' },
  );
  return parseFloat(s.trim());
}

async function highlight(page, selector, ms = 700) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return;
    const prev = el.style.outline;
    el.style.transition = 'outline 0.15s';
    el.style.outline = '3px solid #4aa3ff';
    el.style.outlineOffset = '2px';
    setTimeout(() => { el.style.outline = prev; }, 1400);
  }, selector);
  await page.waitForTimeout(ms);
}

async function highlightAll(page, selector, ms = 700) {
  await page.evaluate((sel) => {
    document.querySelectorAll(sel).forEach((el) => {
      el.style.transition = 'outline 0.15s';
      el.style.outline = '2px solid #4aa3ff';
      el.style.outlineOffset = '2px';
      setTimeout(() => { el.style.outline = ''; }, 1400);
    });
  }, selector);
  await page.waitForTimeout(ms);
}

async function typeSlowly(page, selector, text) {
  await page.click(selector, { clickCount: 3 });   // select existing
  await page.keyboard.press('Delete');
  await page.type(selector, text, { delay: 25 });
}

// ------------------------------------------------------------------
// Tutorial segments
// ------------------------------------------------------------------
const WIZARD = 'models/Meshy_AI_Wizard_Lemming_3D_0830065048_image-to-3d-texture.glb';
const CHEF = 'models/Meshy_AI_Chef_Lemming_3D_0830065130_image-to-3d-texture.glb';
const MANAGER = 'models/Meshy_AI_Manager_Lemming_3D_0830065058_image-to-3d-texture.glb';

const segments = [
  {
    text: "Welcome to the USDZ Sequence Viewer. In this tutorial we'll build a short animated project from scratch, add several 3D models with rotations and text overlays, and then play it back.",
    do: async (page) => {
      await page.waitForTimeout(500);
    },
  },

  {
    text: "The app has two panels. On the left is the 3D viewer where your scene renders. On the right is the editor, with the transport bar at the top and the scene list below it.",
    do: async (page) => {
      await highlight(page, '#viewer', 1500);
      await highlight(page, '#transport', 1500);
      await highlight(page, '#scene-list', 1500);
    },
  },

  {
    text: "Let's start with a clean project. We'll open the Raw JSON panel and paste an empty script.",
    do: async (page) => {
      // Scroll to the JSON section and expand it
      await page.evaluate(() => {
        const s = document.getElementById('section-json');
        if (s.classList.contains('collapsed')) s.querySelector('.section-head').click();
        s.scrollIntoView({ behavior: 'smooth', block: 'end' });
      });
      await page.waitForTimeout(1200);
      await highlight(page, '#json-view', 800);
      await page.click('#json-view', { clickCount: 3 });
      await page.keyboard.press('Meta+a');
      await page.keyboard.press('Delete');
      const emptyScript = `{\n  "name": "Tutorial Demo",\n  "loop": false,\n  "background": "#101317",\n  "scenes": []\n}`;
      await page.type('#json-view', emptyScript, { delay: 12 });
      await page.waitForTimeout(600);
      await highlight(page, '#btn-apply-json', 800);
      await page.click('#btn-apply-json');
      await page.waitForTimeout(800);
    },
  },

  {
    text: "The scene list is empty. Click Add scene to create the first one.",
    do: async (page) => {
      await page.evaluate(() => document.getElementById('editor-scroll').scrollTop = 0);
      await page.waitForTimeout(600);
      await highlight(page, '#btn-add-scene', 1000);
      await page.click('#btn-add-scene');
      await page.waitForTimeout(1200);
    },
  },

  {
    text: "A new scene appears. The editor's scene form opens below the list. Let's give this scene a name.",
    do: async (page) => {
      await page.evaluate(() => document.getElementById('editor-scroll').scrollTop = 100);
      await page.waitForTimeout(400);
      // Type into the Name field (first text input in scene-form)
      const nameSel = '#scene-form .form-row:nth-of-type(1) input[type=text]';
      await highlight(page, nameSel, 600);
      await typeSlowly(page, nameSel, 'The Wizard');
      await page.waitForTimeout(500);
    },
  },

  {
    text: "Now let's pick the model. The Model dropdown lists everything in your manifest. Select the Wizard.",
    do: async (page) => {
      const sel = '#scene-form select';
      await highlight(page, sel, 600);
      await page.selectOption(sel, WIZARD);
      await page.waitForTimeout(1500);
    },
  },

  {
    text: "The wizard appears in the viewer. Let's set the scene duration to five seconds.",
    do: async (page) => {
      const durSel = '#scene-form .form-row:nth-of-type(3) input[type=number]';
      await highlight(page, durSel, 600);
      await typeSlowly(page, durSel, '5');
      await page.waitForTimeout(600);
    },
  },

  {
    text: "To make the model rotate, scroll down to the Transforms block and click plus rotate. The model now spins around its vertical axis.",
    do: async (page) => {
      await page.evaluate(() => {
        const scroll = document.getElementById('editor-scroll');
        scroll.scrollTop = 600;
      });
      await page.waitForTimeout(800);
      // Find the "+ rotate" button — it's the first .add-btn inside a subblock titled Transforms
      await page.evaluate(() => {
        const btns = document.querySelectorAll('.subblock .add-btn');
        for (const b of btns) {
          if (b.textContent.trim() === '+ rotate') {
            b.style.outline = '3px solid #4aa3ff';
            setTimeout(() => { b.style.outline = ''; }, 1400);
            return;
          }
        }
      });
      await page.waitForTimeout(800);
      await page.evaluate(() => {
        const btns = document.querySelectorAll('.subblock .add-btn');
        for (const b of btns) {
          if (b.textContent.trim() === '+ rotate') { b.click(); return; }
        }
      });
      await page.waitForTimeout(1200);
    },
  },

  {
    text: "Now let's add a text overlay. Scroll down to Overlays and click Add overlay. Type the text 'The Wizard'.",
    do: async (page) => {
      await page.evaluate(() => document.getElementById('editor-scroll').scrollTop = 1050);
      await page.waitForTimeout(800);
      await page.evaluate(() => {
        const btns = document.querySelectorAll('.subblock .add-btn');
        for (const b of btns) {
          if (b.textContent.trim() === '+ Add overlay') {
            b.style.outline = '3px solid #4aa3ff';
            setTimeout(() => { b.style.outline = ''; }, 1400);
            b.click();
            return;
          }
        }
      });
      await page.waitForTimeout(1000);
      // Scroll to see the new overlay form
      await page.evaluate(() => document.getElementById('editor-scroll').scrollTop = 1150);
      await page.waitForTimeout(400);
      // Find the newly-added overlay's text input (last one in Overlays subblock)
      await page.evaluate(() => {
        const overlaySubblocks = Array.from(document.querySelectorAll('.subblock'))
          .filter((s) => s.querySelector('.subblock-head .title')?.textContent === 'Overlays');
        // The new overlay is the last child subblock
        const inputs = overlaySubblocks[0]?.querySelectorAll('input[type=text]');
        if (inputs && inputs.length > 0) {
          const first = inputs[0];
          first.value = 'The Wizard';
          first.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
      await page.waitForTimeout(1200);
    },
  },

  {
    text: "Let's add a second scene. Click Add scene again, then pick a different model — the Chef.",
    do: async (page) => {
      await page.evaluate(() => document.getElementById('editor-scroll').scrollTop = 0);
      await page.waitForTimeout(600);
      await highlight(page, '#btn-add-scene', 600);
      await page.click('#btn-add-scene');
      await page.waitForTimeout(1000);
      const sel = '#scene-form select';
      await highlight(page, sel, 400);
      await page.selectOption(sel, CHEF);
      await page.waitForTimeout(1200);
      // Add rotate + overlay for the chef scene
      await page.evaluate(() => document.getElementById('editor-scroll').scrollTop = 600);
      await page.waitForTimeout(400);
      await page.evaluate(() => {
        const btns = document.querySelectorAll('.subblock .add-btn');
        for (const b of btns) {
          if (b.textContent.trim() === '+ rotate') { b.click(); return; }
        }
      });
      await page.waitForTimeout(800);
    },
  },

  {
    text: "Let's also change the camera angle for the Chef so the transition between scenes is visible when we play back. Scroll up to Camera, and change the X position to negative three.",
    do: async (page) => {
      await page.evaluate(() => document.getElementById('editor-scroll').scrollTop = 250);
      await page.waitForTimeout(700);
      // Camera Position vec3 = first .vec3 in scene-form
      const camXSel = '#scene-form .subblock .vec3 input:nth-child(1)';
      await highlight(page, camXSel, 500);
      await typeSlowly(page, camXSel, '-3');
      await page.waitForTimeout(1200);
    },
  },

  {
    text: "Now let's watch it play. Click the Play button in the transport bar.",
    do: async (page) => {
      await page.evaluate(() => document.getElementById('editor-scroll').scrollTop = 0);
      await page.waitForTimeout(500);
      await highlight(page, '#btn-play', 800);
      await page.click('#btn-play');
      // Watch playback for the full 10s (2 scenes × 5s each)
      await page.waitForTimeout(10000);
    },
  },

  {
    text: "That's it! From here you can Export your project as a JSON file, or click the record button to save a video of your sequence. Full documentation is in docs slash user-guide dot markdown.",
    do: async (page) => {
      await page.evaluate(() => document.getElementById('btn-stop').click());
      await page.waitForTimeout(500);
      await highlight(page, '#btn-export', 1500);
      await highlight(page, '#btn-record', 1500);
    },
  },
];

// ------------------------------------------------------------------
// Step 1: generate narrations + get durations
// ------------------------------------------------------------------
console.log('▶ Generating narration audio via Kokoro…');
for (let i = 0; i < segments.length; i++) {
  const p = `${outDir}/audio/seg-${String(i).padStart(2, '0')}.mp3`;
  if (!existsSync(p) || process.env.REGEN_AUDIO) {
    await kokoro(segments[i].text, p);
  }
  segments[i].audioPath = p;
  segments[i].audioDuration = audioDuration(p);
  console.log(`  ${i.toString().padStart(2)}: ${segments[i].audioDuration.toFixed(1).padStart(4)}s  “${segments[i].text.slice(0, 60)}…”`);
}
const totalNarration = segments.reduce((a, s) => a + s.audioDuration, 0);
console.log(`  total narration: ${totalNarration.toFixed(1)}s`);

// ------------------------------------------------------------------
// Step 2: Playwright with video recording
// ------------------------------------------------------------------
console.log('▶ Launching browser and recording UI…');
const browser = await chromium.launch({
  headless: false,
  args: ['--use-gl=angle', '--autoplay-policy=no-user-gesture-required'],
});
const ctx = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  recordVideo: {
    dir: outDir + '/video',
    size: { width: 1600, height: 1000 },
  },
});
const page = await ctx.newPage();
page.on('pageerror', (e) => console.error('[pageerror]', e.message));

// Clear localStorage so the app doesn't load a stale saved script
await page.goto('http://localhost:8765/');
await page.evaluate(() => { try { localStorage.clear(); } catch {} });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

// Gap between segments (seconds)
const GAP = 1.0;

for (let i = 0; i < segments.length; i++) {
  const seg = segments[i];
  const target = (seg.audioDuration + GAP) * 1000;
  const start = Date.now();
  console.log(`  ${i.toString().padStart(2)}/${segments.length - 1} playing… (target ${target.toFixed(0)}ms)`);
  await seg.do(page);
  const remaining = target - (Date.now() - start);
  if (remaining > 0) await page.waitForTimeout(remaining);
}

await page.waitForTimeout(500);
const videoPromise = page.video().path();
await ctx.close();
const rawVideoPath = await videoPromise;
await browser.close();
console.log(`✓ Video captured: ${rawVideoPath}`);

// ------------------------------------------------------------------
// Step 3: build the audio track (concat with silence gaps)
// ------------------------------------------------------------------
console.log('▶ Building narration track…');
const silencePath = `${outDir}/audio/silence-${GAP}s.mp3`;
if (!existsSync(silencePath)) {
  execSync(`ffmpeg -y -f lavfi -i anullsrc=r=24000:cl=mono -t ${GAP} -q:a 9 "${silencePath}"`, { stdio: 'ignore' });
}
const concatFile = `${outDir}/concat.txt`;
let concat = '';
for (const seg of segments) {
  concat += `file '${seg.audioPath}'\n`;
  concat += `file '${silencePath}'\n`;
}
writeFileSync(concatFile, concat);
const narrationOut = `${outDir}/narration.mp3`;
execSync(
  `ffmpeg -y -f concat -safe 0 -i "${concatFile}" -c:a libmp3lame -b:a 128k "${narrationOut}"`,
  { stdio: 'ignore' },
);
console.log(`✓ Narration track: ${narrationOut}`);

// ------------------------------------------------------------------
// Step 4: mux video + narration
// ------------------------------------------------------------------
console.log('▶ Muxing…');
const finalOut = '/Users/chris/code/claude_world/model_viewer/docs/tutorial.mp4';
execSync(
  `ffmpeg -y -i "${rawVideoPath}" -i "${narrationOut}" \
     -c:v libx264 -pix_fmt yuv420p -crf 22 -preset medium \
     -c:a aac -b:a 128k \
     -shortest "${finalOut}"`,
  { stdio: 'inherit' },
);
console.log(`✓ Final tutorial: ${finalOut}`);
execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${finalOut}"`, { stdio: 'inherit' });
