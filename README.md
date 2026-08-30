# USDZ Sequence Viewer

A 3D model viewer with a scripting engine for sequencing scenes of `.glb` / `.usdz` models. Rotate, translate, and scale models; overlay text with fades; sequence multiple scenes with camera transitions; add audio narration; record the whole thing to WebM/MP4.

Runs either as a web app (via a tiny local HTTP server) or as a standalone macOS / Windows / Linux desktop app (Electron).

![Overview](docs/screenshots/01-overview.png)

## Quick start

### Prerequisites
- **Node.js 18+** (only needed for the Electron desktop app; the web version needs only Python 3, which ships with macOS)
- **Blender 4.x** (only if you want to convert `.usdz` files with USDC-binary contents to `.glb` — see [Model conversion](#model-conversion))

### Web app (fastest)
```bash
# From the project root
./serve.sh           # starts a local server on http://localhost:8765/
# Then open http://localhost:8765/ in Chrome or Edge
```

Note the `-8000` in the printout is now `8765` — override with `PORT=xxxx ./serve.sh` if you like.

### Desktop app (self-contained)
```bash
npm install          # first time only — installs three.js + Electron (~200 MB)
npm start            # launches the app in an Electron window
```

### Build distributables
```bash
npm run build:mac    # → dist/*.dmg + dist/*.zip
npm run build:win    # → dist/*.exe (requires Wine on Mac, or run on Windows)
npm run build:linux  # → dist/*.AppImage + dist/*.tar.gz
```

## What's in the box
- `index.html` / `main.js` / `styles.css` — the viewer + editor UI (single-page ES module app)
- `models/` — sample lemming models (`.glb`, converted from Meshy AI's `.usdz` originals)
- `audio/` — sample narrations, generated locally with [Kokoro TTS](https://github.com/hexgrad/kokoro)
- `demo.json` — minimal 9-scene starter script
- `showcase.json` — a fuller 10-scene showcase with per-scene camera angles, transforms, overlays, and audio
- `manifest.json` — list of models the editor's model dropdown surfaces
- `electron/main.js` — Electron main-process entry point
- `tools/` — utility scripts (Blender USDZ→GLB conversion, Playwright doc capture, headless recording tests)
- `docs/user-guide.md` — full user guide

## Model conversion
Three.js's built-in `USDZLoader` only reads **ASCII USDA** files inside a `.usdz` container. Files from AR / iOS tools (including Meshy AI) contain **binary USDC** which the loader silently ignores → invisible model. Convert them to `.glb` with Blender:

```bash
# Single file
/Applications/Blender.app/Contents/MacOS/Blender --background --python tools/usdz_to_glb.py -- \
  models/MyModel.usdz models/MyModel.glb

# All .usdz in models/
for f in models/*.usdz; do
  /Applications/Blender.app/Contents/MacOS/Blender --background --python tools/usdz_to_glb.py -- \
    "$f" "${f%.usdz}.glb"
done
```

The GLB files are then referenced from your scripts. The viewer routes `.glb` / `.gltf` files to `GLTFLoader` and `.usdz` / `.usda` files to `USDZLoader` automatically.

## Recording
The **🎬** button records the whole script to WebM (default) or MP4. See [User Guide → Recording](docs/user-guide.md#recording-a-video) for details.

## Documentation
- [**User Guide**](docs/user-guide.md) — creating projects, adding models, all the editor tools, sequencing tips
- [**Script format**](docs/user-guide.md#script-format-reference) — full JSON schema

## Development
The app is a plain ES-module web page. No build step needed for dev — edit files and reload. `npm install` is only necessary to run under Electron and package a distributable.

Screenshots in this README and the user guide are auto-captured by `tools/capture_docs.mjs` (Playwright).

Headless recording smoke test: `tools/test_showcase.mjs` — records the whole showcase and dumps the WebM to `.test-out/`.

## Repo notes
- `.usdz` originals are gitignored (they duplicate the `.glb` converts at ~40 MB each — 383 MB saved). Re-generate with `tools/usdz_to_glb.py` if you need them back.
- The `.glb` models are ~385 MB total. If pushing to GitHub, consider [Git LFS](https://git-lfs.com/) to keep the working tree lean:
  ```bash
  git lfs install
  git lfs track "models/*.glb"
  git lfs migrate import --include="models/*.glb"
  ```
- One model (`Rock_Star`) is 66 MB; GitHub warns above 50 MB but doesn't block until 100 MB.

## License
Personal project. Model assets from [Meshy AI](https://www.meshy.ai/). Fonts and code your own.
