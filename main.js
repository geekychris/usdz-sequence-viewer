import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { USDZLoader } from 'three/addons/loaders/USDZLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// ============================================================================
// State
// ============================================================================

const state = {
  mode: 'sequence',                 // 'sequence' | 'gallery' | 'detail'
  manifest: { models: [] },
  script: emptyScript(),
  selectedIndex: -1,
  player: {
    playing: false,
    sceneIndex: 0,
    sceneTime: 0,
  },
  loadedModels: new Map(),          // path -> { root, size, height }
  overlayHandles: [],
  detail: { path: null, label: null },
};

function emptyScript() {
  return {
    name: 'Untitled',
    loop: false,
    background: '#101317',
    cameraTransition: { duration: 0.8, ease: 'easeInOut' },
    scenes: [],
  };
}

// Z-up world (matches USD convention; user asked for rotation around Z)
THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

// ============================================================================
// three.js setup
// ============================================================================

const viewerEl = document.getElementById('viewer');
const loadingEl = document.getElementById('loading');
const errorBoxEl = document.getElementById('error-box');
const hudSceneEl = document.getElementById('hud-scene');
const hudModelEl = document.getElementById('hud-model');
const backBtnEl = document.getElementById('back-btn');
const hoverLabelEl = document.getElementById('hover-label');

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
viewerEl.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101317);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 500);
camera.up.set(0, 0, 1);
camera.position.set(3.5, -3.5, 2.5);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0.8);
controls.enableDamping = true;
controls.dampingFactor = 0.08;

const key = new THREE.DirectionalLight(0xffffff, 1.2);
key.position.set(5, -3, 8); scene.add(key);
const fill = new THREE.DirectionalLight(0x8fb8ff, 0.35);
fill.position.set(-6, 4, 3); scene.add(fill);
scene.add(new THREE.AmbientLight(0xffffff, 0.15));

const grid = new THREE.GridHelper(20, 20, 0x2a303b, 0x1a1e26);
grid.rotation.x = Math.PI / 2;
scene.add(grid);

// Optional textured floor + background image
const textureLoader = new THREE.TextureLoader();
let floorMesh = null;
let bgTexture = null;

function isImagePath(s) {
  return typeof s === 'string' && /\.(jpe?g|png|webp|gif)$/i.test(s);
}

function setBackground(bg) {
  // bg can be a CSS color string, a hex number, or an image path
  if (bgTexture) { bgTexture.dispose(); bgTexture = null; }
  if (bg == null || bg === '') {
    scene.background = new THREE.Color(0x101317);
    return;
  }
  if (isImagePath(bg)) {
    textureLoader.load(
      bg,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        bgTexture = tex;
        scene.background = tex;
      },
      undefined,
      (err) => {
        console.warn('background image failed to load:', bg, err);
        scene.background = new THREE.Color(0x101317);
      },
    );
  } else {
    try { scene.background = new THREE.Color(bg); }
    catch { scene.background = new THREE.Color(0x101317); }
  }
}

function setFloor(path, opts = {}) {
  if (floorMesh) {
    scene.remove(floorMesh);
    floorMesh.geometry.dispose();
    if (floorMesh.material.map) floorMesh.material.map.dispose();
    floorMesh.material.dispose();
    floorMesh = null;
  }
  // If a custom floor is set, hide the grid helper; otherwise restore it.
  grid.visible = !path;
  if (!path) return;
  const size = opts.size || 20;
  const repeat = opts.repeat || [1, 1];
  textureLoader.load(
    path,
    (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(repeat[0], repeat[1]);
      const geom = new THREE.PlaneGeometry(size, size);
      const mat = new THREE.MeshStandardMaterial({
        map: tex,
        roughness: 0.95,
        metalness: 0,
      });
      floorMesh = new THREE.Mesh(geom, mat);
      floorMesh.position.z = -0.002;  // just below origin to avoid z-fight with models
      scene.add(floorMesh);
    },
    undefined,
    (err) => {
      console.warn('floor image failed to load:', path, err);
      grid.visible = true;
    },
  );
}

const placeholder = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshStandardMaterial({ color: 0x4aa3ff, roughness: 0.4, metalness: 0.1 }),
);
placeholder.position.z = 0.5;

// Roots per mode
const singleRoot = new THREE.Group();   // sequence + detail: one model
const galleryRoot = new THREE.Group();  // gallery: many models
scene.add(singleRoot);
scene.add(galleryRoot);
galleryRoot.visible = false;

// Overlay scene: text lives here as sprites so it renders into the WebGL
// canvas (and therefore into the video recording).
const overlayScene = new THREE.Scene();
const overlayCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);
overlayCamera.position.z = 1;
renderer.autoClear = false;   // we clear explicitly in animate()

function resize() {
  const w = viewerEl.clientWidth;
  const h = viewerEl.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  overlayCamera.left = -w / 2;
  overlayCamera.right = w / 2;
  overlayCamera.top = h / 2;
  overlayCamera.bottom = -h / 2;
  overlayCamera.updateProjectionMatrix();
  for (const oh of state.overlayHandles) positionOverlaySprite(oh);
}
window.addEventListener('resize', resize);
resize();

// ============================================================================
// USDZ loading
// ============================================================================

const usdzLoader = new USDZLoader();
const gltfLoader = new GLTFLoader();

async function loadModel(path) {
  if (state.loadedModels.has(path)) return state.loadedModels.get(path);
  showLoading(`Loading ${basename(path)}…`);
  try {
    const ext = (path.split('.').pop() || '').toLowerCase();
    let root;
    if (ext === 'glb' || ext === 'gltf') {
      const gltf = await gltfLoader.loadAsync(path);
      root = gltf.scene;
    } else if (ext === 'usdz' || ext === 'usda' || ext === 'usd') {
      root = await usdzLoader.loadAsync(path);
    } else {
      throw new Error(`Unsupported file extension: .${ext} (use .glb or .usdz)`);
    }
    root.traverse((o) => {
      if (o.isMesh && o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
          if (m.emissiveMap) m.emissiveMap.colorSpace = THREE.SRGBColorSpace;
          m.needsUpdate = true;
        }
      }
    });
    let meshCount = 0;
    root.traverse((o) => { if (o.isMesh) meshCount++; });
    if (meshCount === 0) {
      throw new Error(`No meshes found in ${basename(path)}. If this is a .usdz file, it may be in USDC (binary) format — three.js only supports USDA (ASCII). Convert to .glb via tools/usdz_to_glb.py.`);
    }
    const box = new THREE.Box3().setFromObject(root);
    const size = new THREE.Vector3(); box.getSize(size);
    const entry = { root, size, height: Math.max(size.x, size.y, size.z) };
    state.loadedModels.set(path, entry);
    return entry;
  } finally {
    hideLoading();
  }
}

// ============================================================================
// Model mounting helpers
// ============================================================================

function clearGroup(g) { while (g.children.length) g.remove(g.children[0]); }

/**
 * Wrap a model root so it's oriented (Y-up → Z-up), centered on XY, and fit to ~1.8u height.
 * Returns a container Object3D that the caller can apply position/rotation/scale to.
 * If `useClone` is true (gallery), clones the root so multiple instances can coexist.
 */
function makeMountedContainer(entry, { modelUp = 'y', autoFit = true, targetHeight = 1.8, useClone = false } = {}) {
  const container = new THREE.Group();
  const inner = new THREE.Group();
  const modelObj = useClone ? entry.root.clone(true) : entry.root;
  inner.add(modelObj);
  container.add(inner);

  if (modelUp === 'y') inner.rotation.x = Math.PI / 2;

  const box = new THREE.Box3().setFromObject(inner);
  const size = new THREE.Vector3(); box.getSize(size);
  const center = new THREE.Vector3(); box.getCenter(center);
  inner.position.x -= center.x;
  inner.position.y -= center.y;
  inner.position.z -= box.min.z;

  if (autoFit) {
    const h = size.z || 1;
    inner.scale.setScalar(targetHeight / h);
  }
  return container;
}

function mountModelForScene(entry, sceneCfg) {
  clearGroup(singleRoot);
  const container = makeMountedContainer(entry, {
    modelUp: sceneCfg?.modelUp || 'y',
    autoFit: sceneCfg?.autoFit !== false,
    targetHeight: sceneCfg?.targetHeight || 1.8,
  });
  const init = sceneCfg?.initial || {};
  const pos = init.position || [0, 0, 0];
  const rot = init.rotation || [0, 0, 0];
  const scl = init.scale ?? 1;
  container.position.set(pos[0], pos[1], pos[2]);
  container.rotation.set(deg(rot[0]), deg(rot[1]), deg(rot[2]));
  if (typeof scl === 'number') container.scale.setScalar(scl);
  else container.scale.set(scl[0], scl[1], scl[2]);
  singleRoot.add(container);
  return container;
}

function mountPlaceholder() {
  clearGroup(singleRoot);
  const c = new THREE.Group();
  c.add(placeholder);
  singleRoot.add(c);
  return c;
}

// ============================================================================
// Camera: apply + tween
// ============================================================================

const camTween = {
  active: false, t: 0, dur: 0,
  from: { pos: new THREE.Vector3(), tgt: new THREE.Vector3(), fov: 0 },
  to:   { pos: new THREE.Vector3(), tgt: new THREE.Vector3(), fov: 0 },
  ease: 'easeInOut',
};

function applyCamera(cfg, { tween = false, duration, ease } = {}) {
  if (!cfg) return;
  const targetPos = cfg.position ? new THREE.Vector3(cfg.position[0], cfg.position[1], cfg.position[2]) : camera.position.clone();
  const targetTgt = cfg.lookAt   ? new THREE.Vector3(cfg.lookAt[0], cfg.lookAt[1], cfg.lookAt[2]) : controls.target.clone();
  const targetFov = typeof cfg.fov === 'number' ? cfg.fov : camera.fov;

  if (!tween) {
    camera.position.copy(targetPos);
    controls.target.copy(targetTgt);
    camera.fov = targetFov;
    camera.updateProjectionMatrix();
    camera.lookAt(controls.target);
    controls.update();
    camTween.active = false;
    return;
  }

  camTween.from.pos.copy(camera.position);
  camTween.from.tgt.copy(controls.target);
  camTween.from.fov = camera.fov;
  camTween.to.pos.copy(targetPos);
  camTween.to.tgt.copy(targetTgt);
  camTween.to.fov = targetFov;
  camTween.t = 0;
  camTween.dur = Math.max(0.001, duration ?? state.script.cameraTransition?.duration ?? 0.8);
  camTween.ease = ease ?? state.script.cameraTransition?.ease ?? 'easeInOut';
  camTween.active = true;
}

function updateCameraTween(dt) {
  if (!camTween.active) return;
  camTween.t += dt;
  const u = clamp01(camTween.t / camTween.dur);
  const e = easeFn(u, camTween.ease);
  camera.position.lerpVectors(camTween.from.pos, camTween.to.pos, e);
  controls.target.lerpVectors(camTween.from.tgt, camTween.to.tgt, e);
  camera.fov = lerp(camTween.from.fov, camTween.to.fov, e);
  camera.updateProjectionMatrix();
  camera.lookAt(controls.target);
  controls.update();
  if (u >= 1) camTween.active = false;
}

// ============================================================================
// Overlays
// ============================================================================

function clearOverlays() {
  for (const h of state.overlayHandles) {
    if (h.sprite) {
      overlayScene.remove(h.sprite);
      h.sprite.material.map?.dispose();
      h.sprite.material.dispose();
    }
  }
  state.overlayHandles = [];
}

function createOverlaySprite(text, fontSize, color) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif`;

  // Measure at 1x
  const measure = document.createElement('canvas').getContext('2d');
  measure.font = font;
  const metrics = measure.measureText(text);
  const padX = Math.max(20, fontSize * 0.4);
  const padY = Math.max(12, fontSize * 0.3);
  const w = Math.ceil(metrics.width) + padX * 2;
  const h = Math.ceil(fontSize * 1.35) + padY * 2;

  // Render at DPR resolution for crispness
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(w * dpr);
  canvas.height = Math.ceil(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.85)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = color;
  ctx.fillText(text, w / 2, h / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    opacity: 0,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(w, h, 1);   // in ortho world units (CSS px)
  sprite.renderOrder = 999;
  sprite.userData.width = w;
  sprite.userData.height = h;
  return sprite;
}

function positionOverlaySprite(h) {
  if (!h.sprite) return;
  const viewH = viewerEl.clientHeight;
  const halfH = viewH / 2;
  const spriteH = h.sprite.userData.height;
  const margin = 24;
  if (h.position === 'top') h.sprite.position.y = halfH - margin - spriteH / 2;
  else if (h.position === 'center') h.sprite.position.y = 0;
  else h.sprite.position.y = -halfH + margin + spriteH / 2;
  h.sprite.position.x = 0;
  h.sprite.position.z = 0;
}

function scheduleOverlays(overlays) {
  clearOverlays();
  if (!overlays) return;
  for (const ov of overlays) {
    const sprite = createOverlaySprite(ov.text || '', ov.fontSize || 32, ov.color || '#ffffff');
    overlayScene.add(sprite);
    const handle = {
      sprite,
      position: ov.position || 'bottom',
      start: ov.start || 0,
      fadeIn: ov.fadeIn || 0.3,
      hold: ov.hold || 1.5,
      fadeOut: ov.fadeOut || 0.5,
      currentOpacity: 0,
    };
    positionOverlaySprite(handle);
    state.overlayHandles.push(handle);
  }
}

function updateOverlays(t) {
  for (const h of state.overlayHandles) {
    const inStart = h.start;
    const inEnd = inStart + h.fadeIn;
    const holdEnd = inEnd + h.hold;
    const outEnd = holdEnd + h.fadeOut;
    let opacity;
    if (t < inStart) opacity = 0;
    else if (t < inEnd) opacity = (t - inStart) / h.fadeIn;
    else if (t < holdEnd) opacity = 1;
    else if (t < outEnd) opacity = 1 - (t - holdEnd) / h.fadeOut;
    else opacity = 0;
    h.currentOpacity = clamp01(opacity);
    if (h.sprite) h.sprite.material.opacity = h.currentOpacity;
  }
}

// ============================================================================
// Audio manager
// ============================================================================

const audioMgr = {
  current: null,   // { el, cfg, target, sceneDuration }
  muted: false,
  _recCtx: null,
  _recDest: null,

  startRecording() {
    if (this._recCtx) return this._recDest.stream;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    this._recCtx = new AC();
    this._recDest = this._recCtx.createMediaStreamDestination();
    // Chrome autoplay policy leaves AudioContext suspended until a user
    // gesture activates it. If we leave it suspended, the destination
    // stream produces no samples and MediaRecorder blocks waiting for
    // audio → we get 0 chunks / 0 bytes. Force-resume.
    if (this._recCtx.state === 'suspended') {
      this._recCtx.resume().catch((e) => console.warn('AudioContext resume failed:', e));
    }
    // Also feed a permanent silent oscillator into the destination so the
    // track has continuous samples even when no scene audio is playing.
    // Without this, MediaRecorder can drop the whole recording if audio
    // starts/stops or if scenes have no audio at all.
    const silentGain = this._recCtx.createGain();
    silentGain.gain.value = 0;   // truly inaudible, but keeps the stream alive
    const osc = this._recCtx.createOscillator();
    osc.connect(silentGain);
    silentGain.connect(this._recDest);
    osc.start();
    this._silentOsc = osc;
    console.log('[audio] recording context state:', this._recCtx.state);
    return this._recDest.stream;
  },
  stopRecording() {
    if (!this._recCtx) return;
    try { this._silentOsc && this._silentOsc.stop(); } catch {}
    try { this._recCtx.close(); } catch {}
    this._recCtx = null;
    this._recDest = null;
    this._silentOsc = null;
  },

  _routeThroughRecorder(el) {
    if (!this._recCtx) return;
    try {
      const src = this._recCtx.createMediaElementSource(el);
      src.connect(this._recCtx.destination);   // still audible
      src.connect(this._recDest);              // captured
    } catch (e) {
      console.warn('audio route error', e);
    }
  },

  startForScene(cfg, sceneDuration) {
    this.stop();
    if (!cfg || !cfg.src) return;
    const el = new Audio(cfg.src);
    el.loop = !!cfg.loop;
    el.muted = this.muted;
    const target = clamp01(cfg.volume ?? 1);
    el.volume = (cfg.fadeIn && cfg.fadeIn > 0) ? 0 : target;
    this._routeThroughRecorder(el);
    el.play().catch((e) => console.warn('audio play error:', e));
    this.current = { el, cfg, target, sceneDuration, startedAt: cfg.start || 0 };
  },

  stop() {
    if (!this.current) return;
    try { this.current.el.pause(); } catch {}
    this.current = null;
  },

  pause() { if (this.current) try { this.current.el.pause(); } catch {} },
  resume() { if (this.current) try { this.current.el.play(); } catch {} },

  setMuted(m) {
    this.muted = m;
    if (this.current) this.current.el.muted = m;
  },

  tick(sceneT, sceneDuration) {
    const a = this.current;
    if (!a) return;
    const cfg = a.cfg;
    const startAt = a.startedAt;
    const localT = sceneT - startAt;
    if (localT < 0) { a.el.volume = 0; return; }
    const tgt = a.target;
    let vol = tgt;
    if (cfg.fadeIn && cfg.fadeIn > 0 && localT < cfg.fadeIn) {
      vol = tgt * (localT / cfg.fadeIn);
    }
    if (cfg.fadeOut && cfg.fadeOut > 0 && sceneDuration > 0) {
      const timeToEnd = sceneDuration - sceneT;
      if (timeToEnd < cfg.fadeOut) {
        vol = Math.min(vol, tgt * Math.max(0, timeToEnd / cfg.fadeOut));
      }
    }
    a.el.volume = clamp01(vol);
  },
};

// ============================================================================
// Transforms
// ============================================================================

function applyTransforms(container, transforms, t, dt) {
  if (!transforms) return;
  for (const tf of transforms) {
    switch (tf.type) {
      case 'rotate': {
        const axis = (tf.axis || 'z').toLowerCase();
        const rate = deg(tf.degPerSec || 0);
        container.rotation[axis] += rate * dt;
        break;
      }
      case 'rotateTo': {
        const axis = (tf.axis || 'z').toLowerCase();
        const start = tf.start || 0;
        const dur = Math.max(0.0001, tf.duration || 1);
        const target = deg(tf.degrees || 0);
        const from = deg(tf.from ?? 0);
        const u = clamp01((t - start) / dur);
        container.rotation[axis] = lerp(from, target, easeFn(u, tf.ease));
        break;
      }
      case 'translate': {
        const v = tf.velocity || [0, 0, 0];
        container.position.x += v[0] * dt;
        container.position.y += v[1] * dt;
        container.position.z += v[2] * dt;
        break;
      }
      case 'translateTo': {
        const start = tf.start || 0;
        const dur = Math.max(0.0001, tf.duration || 1);
        const to = tf.to || [0, 0, 0];
        const from = tf.from || [container.position.x, container.position.y, container.position.z];
        const u = clamp01((t - start) / dur);
        const e = easeFn(u, tf.ease);
        container.position.set(lerp(from[0], to[0], e), lerp(from[1], to[1], e), lerp(from[2], to[2], e));
        break;
      }
      case 'scaleTo': {
        const start = tf.start || 0;
        const dur = Math.max(0.0001, tf.duration || 1);
        const to = normalizeScale(tf.to ?? 1);
        const from = normalizeScale(tf.from ?? [container.scale.x, container.scale.y, container.scale.z]);
        const u = clamp01((t - start) / dur);
        const e = easeFn(u, tf.ease);
        container.scale.set(lerp(from[0], to[0], e), lerp(from[1], to[1], e), lerp(from[2], to[2], e));
        break;
      }
    }
  }
}
function normalizeScale(s) { return Array.isArray(s) ? s : [s, s, s]; }
function easeFn(u, name) {
  if (!name || name === 'linear') return u;
  if (name === 'easeIn') return u * u;
  if (name === 'easeOut') return 1 - (1 - u) * (1 - u);
  if (name === 'easeInOut') return u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
  return u;
}
function lerp(a, b, t) { return a + (b - a) * t; }
function clamp01(u) { return u < 0 ? 0 : u > 1 ? 1 : u; }
function deg(d) { return (d || 0) * Math.PI / 180; }

// ============================================================================
// Sequence player
// ============================================================================

let activeContainer = null;
let activeSceneCfg = null;

async function loadSceneAt(index, { tweenCamera = true } = {}) {
  const sc = state.script.scenes[index];
  if (!sc) {
    activeContainer = mountPlaceholder();
    activeSceneCfg = null;
    hudSceneEl.textContent = '(empty)';
    hudModelEl.textContent = '';
    clearOverlays();
    audioMgr.stop();
    return;
  }
  activeSceneCfg = sc;
  hudSceneEl.textContent = `Scene ${index + 1}/${state.script.scenes.length}${sc.name ? ' — ' + sc.name : ''}`;
  hudModelEl.textContent = sc.model ? basename(sc.model) : '(no model)';
  // Per-scene background / floor override script defaults.
  setBackground(sc.background !== undefined ? sc.background : state.script.background);
  setFloor(sc.floor !== undefined ? sc.floor : state.script.floor);
  applyCamera(sc.camera, { tween: tweenCamera });

  if (!sc.model) {
    activeContainer = mountPlaceholder();
    scheduleOverlays(sc.overlays);
    audioMgr.stop();
    if (state.player.playing) audioMgr.startForScene(sc.audio, sc.duration || 0);
    return;
  }

  try {
    const entry = await loadModel(sc.model);
    activeContainer = mountModelForScene(entry, sc);
    scheduleOverlays(sc.overlays);
    if (state.player.playing) audioMgr.startForScene(sc.audio, sc.duration || 0);
    hideError();
  } catch (err) {
    console.error(err);
    activeContainer = mountPlaceholder();
    scheduleOverlays(sc.overlays);
    showError(`Failed to load ${basename(sc.model)}: ${err.message || err}`);
  }
}

async function play() {
  if (state.mode !== 'sequence' || state.script.scenes.length === 0) return;
  if (!state.player.playing) {
    state.player.playing = true;
    await loadSceneAt(state.player.sceneIndex, { tweenCamera: false });
    audioMgr.startForScene(activeSceneCfg?.audio, activeSceneCfg?.duration || 0);
    renderSceneList();
  } else {
    audioMgr.resume();
  }
}
function pause() {
  state.player.playing = false;
  audioMgr.pause();
  renderSceneList();
}
async function stop() {
  state.player.playing = false;
  state.player.sceneIndex = 0;
  state.player.sceneTime = 0;
  audioMgr.stop();
  await loadSceneAt(0, { tweenCamera: false });
  renderSceneList();
}
async function nextScene() {
  const n = state.script.scenes.length;
  if (n === 0) return;
  let next = state.player.sceneIndex + 1;
  if (next >= n) {
    if (state.script.loop && !state.exporting) next = 0;
    else {
      pause();
      if (state.exporting) state.exporting.onFinished?.();
      if (state.present && !state.exporting) exitPresent();
      return;
    }
  }
  state.player.sceneIndex = next;
  state.player.sceneTime = 0;
  if (state.exporting) console.log('[export] advance to scene', next + 1, '/', n, ':', state.script.scenes[next]?.name || basename(state.script.scenes[next]?.model || ''));
  await loadSceneAt(next, { tweenCamera: true });
  if (state.player.playing) audioMgr.startForScene(activeSceneCfg?.audio, activeSceneCfg?.duration || 0);
  renderSceneList();
}
async function prevScene() {
  const n = state.script.scenes.length;
  if (n === 0) return;
  let p = state.player.sceneIndex - 1;
  if (p < 0) p = state.script.loop ? n - 1 : 0;
  state.player.sceneIndex = p;
  state.player.sceneTime = 0;
  await loadSceneAt(p, { tweenCamera: true });
  if (state.player.playing) audioMgr.startForScene(activeSceneCfg?.audio, activeSceneCfg?.duration || 0);
  renderSceneList();
}

// ============================================================================
// Gallery + Detail modes
// ============================================================================

const gallery = {
  cells: [],           // { path, label, group }
  hoverCell: null,
  spinRate: deg(15),   // 15°/s
  cols: 0, rows: 0, spacing: 3.2,
};

function clearGallery() {
  clearGroup(galleryRoot);
  gallery.cells = [];
  gallery.hoverCell = null;
  hoverLabelEl.classList.remove('show');
  viewerEl.classList.remove('gallery-hover');
}

async function buildGallery() {
  clearGallery();
  const models = state.manifest.models;
  const total = models.length;
  const statusEl = document.getElementById('gallery-status');
  const loaded = [];
  for (let i = 0; i < total; i++) {
    const m = models[i];
    statusEl.textContent = `Loading ${i + 1}/${total}: ${m.label}`;
    try {
      const entry = await loadModel(m.path);
      loaded.push({ ...m, entry });
    } catch (e) {
      console.error(e);
      statusEl.textContent = `Failed to load ${m.label}: ${e.message || e}`;
    }
  }
  statusEl.textContent = `Loaded ${loaded.length}/${total}. Click any model to view.`;

  const n = loaded.length;
  const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
  const rows = Math.max(1, Math.ceil(n / cols));
  gallery.cols = cols; gallery.rows = rows;
  const spacing = gallery.spacing;
  loaded.forEach((m, i) => {
    const c = i % cols, r = Math.floor(i / cols);
    const x = (c - (cols - 1) / 2) * spacing;
    const y = -(r - (rows - 1) / 2) * spacing;
    const cell = makeMountedContainer(m.entry, { modelUp: 'y', autoFit: true, targetHeight: 1.5, useClone: true });
    cell.position.set(x, y, 0);
    cell.userData = { path: m.path, label: m.label, isCell: true };
    galleryRoot.add(cell);
    gallery.cells.push({ path: m.path, label: m.label, group: cell });
  });

  const camDist = Math.max(cols, rows) * spacing * 0.9;
  applyCamera({
    position: [0, -camDist, camDist * 0.75],
    lookAt: [0, 0, 0.8],
    fov: 42,
  }, { tween: true, duration: 1.0 });
}

async function enterGallery() {
  if (state.mode === 'gallery') return;
  if (state.mode === 'sequence') { pause(); audioMgr.stop(); }
  state.mode = 'gallery';
  singleRoot.visible = false;
  galleryRoot.visible = true;
  showModePanel('gallery');
  hudSceneEl.textContent = 'Gallery';
  hudModelEl.textContent = '';
  clearOverlays();
  backBtnEl.classList.remove('show');
  await buildGallery();
}

function exitGallery() {
  clearGallery();
}

const raycaster = new THREE.Raycaster();
function pointerToNdc(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  return new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1,
  );
}
function findCellFromHit(obj) {
  let n = obj;
  while (n) {
    if (n.userData && n.userData.isCell) return n;
    n = n.parent;
  }
  return null;
}
function onPointerMoveGallery(e) {
  if (state.mode !== 'gallery') return;
  raycaster.setFromCamera(pointerToNdc(e), camera);
  const hits = raycaster.intersectObjects(galleryRoot.children, true);
  const cell = hits[0] ? findCellFromHit(hits[0].object) : null;
  if (cell !== gallery.hoverCell) {
    gallery.hoverCell = cell;
    if (cell) {
      hoverLabelEl.textContent = cell.userData.label;
      hoverLabelEl.classList.add('show');
      viewerEl.classList.add('gallery-hover');
    } else {
      hoverLabelEl.classList.remove('show');
      viewerEl.classList.remove('gallery-hover');
    }
  }
}
function onClickGallery(e) {
  if (state.mode !== 'gallery') return;
  raycaster.setFromCamera(pointerToNdc(e), camera);
  const hits = raycaster.intersectObjects(galleryRoot.children, true);
  const cell = hits[0] ? findCellFromHit(hits[0].object) : null;
  if (cell) enterDetail(cell.userData.path, cell.userData.label);
}
renderer.domElement.addEventListener('pointermove', onPointerMoveGallery);
renderer.domElement.addEventListener('click', onClickGallery);

// ---------- Detail mode ----------

const detail = {
  container: null,
  time: 0,
  orbit: true,     // camera orbits slowly
  orbitRate: deg(12),
  orbitRadius: 3.6,
  orbitHeight: 1.6,
  modelSpinRate: deg(30),
};

async function enterDetail(path, label) {
  state.mode = 'detail';
  state.detail = { path, label };
  singleRoot.visible = true;
  galleryRoot.visible = false;
  showModePanel('detail');
  hudSceneEl.textContent = 'Detail';
  hudModelEl.textContent = label;
  backBtnEl.classList.add('show');
  hoverLabelEl.classList.remove('show');
  viewerEl.classList.remove('gallery-hover');

  document.getElementById('detail-info').textContent =
    `Viewing “${label}”. Model spins around Z; camera slowly orbits (toggle below). Click Back or press Esc to return.`;

  try {
    const entry = await loadModel(path);
    detail.container = mountModelForScene(entry, { modelUp: 'y', autoFit: true });
  } catch (err) {
    detail.container = mountPlaceholder();
    showError(`Failed to load ${basename(path)}: ${err.message || err}`);
    return;
  }

  detail.time = 0;
  // Pre-programmed overlay: fade in name, hold, fade out
  scheduleOverlays([
    { text: label, position: 'bottom', start: 0.3, fadeIn: 0.5, hold: 3.0, fadeOut: 0.8, fontSize: 42 },
  ]);
  // Camera dolly-in from wherever we were
  applyCamera({
    position: [detail.orbitRadius, 0, detail.orbitHeight],
    lookAt: [0, 0, 0.9],
    fov: 38,
  }, { tween: true, duration: 1.2 });
}

async function backFromDetail() {
  clearOverlays();
  backBtnEl.classList.remove('show');
  if (state.detail.path && galleryRoot.children.length > 0) {
    // Return to gallery
    state.mode = 'gallery';
    singleRoot.visible = false;
    galleryRoot.visible = true;
    showModePanel('gallery');
    hudSceneEl.textContent = 'Gallery';
    hudModelEl.textContent = '';
    const camDist = Math.max(gallery.cols, gallery.rows) * gallery.spacing * 0.9;
    applyCamera({
      position: [0, -camDist, camDist * 0.75],
      lookAt: [0, 0, 0.8],
      fov: 42,
    }, { tween: true, duration: 1.0 });
  } else {
    // Fall back to sequence mode if we don't have a gallery
    setMode('sequence');
  }
}

// ============================================================================
// Mode UI
// ============================================================================

const modePanels = {
  sequence: document.getElementById('panel-sequence'),
  gallery:  document.getElementById('panel-gallery'),
  detail:   document.getElementById('panel-detail'),
};
function showModePanel(m) {
  for (const [k, el] of Object.entries(modePanels)) el.style.display = (k === m) ? '' : 'none';
  document.querySelectorAll('.mode-tab').forEach((b) => {
    b.classList.toggle('active', b.dataset.mode === (m === 'detail' ? 'gallery' : m));
  });
}

async function setMode(m) {
  if (m === state.mode) return;
  if (state.mode === 'gallery') exitGallery();
  if (state.mode === 'sequence') { pause(); audioMgr.stop(); }
  if (m === 'sequence') {
    state.mode = 'sequence';
    singleRoot.visible = true;
    galleryRoot.visible = false;
    backBtnEl.classList.remove('show');
    showModePanel('sequence');
    if (state.script.scenes.length > 0) {
      const i = Math.max(0, state.selectedIndex);
      state.player.sceneIndex = i;
      state.player.sceneTime = 0;
      await loadSceneAt(i, { tweenCamera: false });
    } else {
      activeContainer = mountPlaceholder();
      hudSceneEl.textContent = '(empty)';
      hudModelEl.textContent = '';
      clearOverlays();
    }
  } else if (m === 'gallery') {
    await enterGallery();
  }
}

// ============================================================================
// Main loop
// ============================================================================

let lastFrameTime = performance.now();
function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const dt = Math.min(0.1, (now - lastFrameTime) / 1000);
  lastFrameTime = now;

  updateCameraTween(dt);

  if (state.mode === 'sequence') {
    if (state.player.playing && activeContainer && activeSceneCfg) {
      state.player.sceneTime += dt;
      applyTransforms(activeContainer, activeSceneCfg.transforms, state.player.sceneTime, dt);
      updateOverlays(state.player.sceneTime);
      audioMgr.tick(state.player.sceneTime, activeSceneCfg.duration || 0);
      const dur = activeSceneCfg.duration || 0;
      if (dur > 0 && state.player.sceneTime >= dur) nextScene();
      updateTransport();
    }
  } else if (state.mode === 'gallery') {
    // Slowly spin each cell
    for (const c of gallery.cells) c.group.rotation.z += gallery.spinRate * dt;
  } else if (state.mode === 'detail') {
    detail.time += dt;
    if (detail.container) detail.container.rotation.z += detail.modelSpinRate * dt;
    updateOverlays(detail.time);
    if (detail.orbit) {
      // Slowly orbit the camera around the model (only when not user-tweening)
      if (!camTween.active) {
        const a = detail.time * detail.orbitRate;
        camera.position.set(Math.cos(a) * detail.orbitRadius, Math.sin(a) * detail.orbitRadius, detail.orbitHeight);
        camera.lookAt(controls.target);
        controls.update();
      }
    }
  }

  controls.update();
  renderer.clear();
  renderer.render(scene, camera);
  renderer.clearDepth();
  renderer.render(overlayScene, overlayCamera);

  // Export progress + safety-net frame push — must run right after render()
  if (state.exporting) drawExportFrame();
}
requestAnimationFrame(animate);

// ============================================================================
// Fullscreen / present mode
// ============================================================================

async function enterPresent() {
  if (state.present) return;
  state.present = true;
  document.body.classList.add('present-mode');
  try { await document.documentElement.requestFullscreen(); } catch {}
  resize();
  if (state.mode !== 'sequence') await setMode('sequence');
  await stop();
  await play();
}

async function exitPresent() {
  if (!state.present) return;
  state.present = false;
  document.body.classList.remove('present-mode');
  if (document.fullscreenElement) { try { await document.exitFullscreen(); } catch {} }
  pause();
  resize();
}

document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && state.present) exitPresent();
});

// ============================================================================
// Video export (MediaRecorder)
// ============================================================================

function pickRecorderMime(includeAudio, format) {
  // Chrome's MP4 recording path is unreliable for multi-scene captures;
  // WebM (VP9 + Opus) is the safe default. Callers can force MP4 via `format`.
  const audio = includeAudio ? ',opus' : '';
  const webm = [
    'video/webm;codecs=vp9' + audio,
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8' + audio,
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  const mp4 = [
    'video/mp4;codecs=avc1.640028',
    'video/mp4;codecs=avc1',
    'video/mp4',
  ];
  const order = format === 'mp4' ? [...mp4, ...webm] : [...webm, ...mp4];
  for (const m of order) if (MediaRecorder.isTypeSupported(m)) return m;
  return '';
}

function drawExportFrame() {
  const e = state.exporting;
  if (!e) return;

  // Optional safety-net push (browser also samples on canvas change)
  const now = performance.now();
  const minInterval = 1000 / (e.fps || 30);
  if (now - e.lastFramePushAt >= minInterval) {
    e.lastFramePushAt = now;
    try {
      if (e.videoTrack && typeof e.videoTrack.requestFrame === 'function') e.videoTrack.requestFrame();
    } catch {}
    e.framesPushed++;
  }

  // Update progress display
  const total = totalDuration();
  const nowT = elapsedBefore(state.player.sceneIndex) + state.player.sceneTime;
  document.getElementById('export-status').textContent = `${nowT.toFixed(1)} / ${total.toFixed(1)}s | frames ${e.framesPushed}`;
  const pct = total > 0 ? Math.min(100, (nowT / total) * 100) : 0;
  document.getElementById('export-bar').style.width = pct.toFixed(1) + '%';

  // Once-per-second diagnostic
  if (!e.lastLogAt || now - e.lastLogAt >= 1000) {
    e.lastLogAt = now;
    console.log('[export] t=' + nowT.toFixed(1) + 's frames=' + e.framesPushed + ' scene=' + (state.player.sceneIndex + 1) + '/' + state.script.scenes.length);
  }
}

async function exportVideo(opts = {}) {
  if (state.exporting) {
    // Something left it hanging (recorder crashed without firing onstop). Reset.
    console.warn('[export] stale export state, resetting');
    state.exporting = null;
    document.body.classList.remove('recording');
    document.getElementById('export-panel').classList.remove('show');
    audioMgr.stopRecording();
  }
  if (state.script.scenes.length === 0) { showError('No scenes to export.'); return; }
  const fps = opts.fps || 30;
  const includeAudio = opts.includeAudio !== false;

  // Force sequence mode; preload models to avoid stalls mid-recording
  if (state.mode !== 'sequence') await setMode('sequence');
  showLoading('Preloading models…');
  for (const sc of state.script.scenes) {
    if (sc.model) {
      try { await loadModel(sc.model); } catch (e) { console.warn('preload skipped:', sc.model, e); }
    }
  }
  hideLoading();

  // On Retina displays the WebGL canvas is 2× CSS pixels (e.g. 2210×2030),
  // which overwhelms Chrome's software VP9 encoder and produces broken files
  // (0-byte WebM, 1-frame MP4). Force pixelRatio=1 during recording so the
  // capture stays at a codec-friendly size; restored in cleanup below.
  const origPixelRatio = renderer.getPixelRatio();
  renderer.setPixelRatio(1);
  resize();
  await new Promise((r) => requestAnimationFrame(r));

  // Rewind and start playback BEFORE creating captureStream. Once the
  // animate loop is actively rendering scenes into the canvas, we tap
  // the stream — this avoids the "captureStream on a cold canvas" quirk
  // that gave you 0-byte WebM / partial MP4 outputs.
  await stop();
  await play();
  // Wait 3 real animation frames to be sure the WebGL canvas is being
  // updated every frame with the first scene's content.
  await new Promise((r) => requestAnimationFrame(() =>
    requestAnimationFrame(() => requestAnimationFrame(r))));

  const W = renderer.domElement.width;
  const H = renderer.domElement.height;
  const videoStream = renderer.domElement.captureStream(fps);
  const videoTrack = videoStream.getVideoTracks()[0];
  console.log('[export] videoTrack:', videoTrack && {
    label: videoTrack.label,
    readyState: videoTrack.readyState,
    enabled: videoTrack.enabled,
    muted: videoTrack.muted,
  });

  let audioStream = null;
  if (includeAudio) {
    audioStream = audioMgr.startRecording();
    if (!audioStream) console.warn('AudioContext unavailable; recording video only.');
  }
  const tracks = [...videoStream.getVideoTracks(), ...(audioStream ? audioStream.getAudioTracks() : [])];
  const stream = new MediaStream(tracks);
  console.log('[export] canvas', W + 'x' + H, 'tracks:', tracks.length, 'video+', audioStream ? 'audio' : 'no audio');

  const mime = pickRecorderMime(!!audioStream, opts.format);
  if (!mime) {
    showError('This browser cannot record video.');
    audioMgr.stopRecording();
    return;
  }
  const ext = mime.includes('mp4') ? 'mp4' : 'webm';
  console.log('[export] mime:', mime, 'ext:', ext);

  const recorder = new MediaRecorder(stream, {
    mimeType: mime,
    videoBitsPerSecond: opts.videoBps || 10_000_000,
    audioBitsPerSecond: 128_000,
  });
  const chunks = [];
  let totalBytes = 0;
  recorder.ondataavailable = (e) => {
    console.log('[export] ondataavailable, size:', e.data?.size || 0, 'total chunks:', chunks.length + (e.data?.size ? 1 : 0));
    if (e.data && e.data.size) { chunks.push(e.data); totalBytes += e.data.size; }
  };
  recorder.onerror = (e) => {
    console.error('[export] recorder error:', e);
    showError('Recording error: ' + (e.error?.message || e.error || 'unknown'));
  };
  recorder.onstart = () => console.log('[export] recorder.onstart fired, state:', recorder.state);

  const originalLoop = state.script.loop;
  state.script.loop = false;
  document.body.classList.add('recording');
  document.getElementById('export-panel').classList.add('show');

  const totalScriptDuration = totalDuration();
  const safetyTimeoutMs = Math.ceil((totalScriptDuration + 5) * 1000);

  await new Promise((resolve) => {
    let finished = false;
    let safetyId = null;
    const cleanup = () => {
      if (finished) return; finished = true;
      if (safetyId) clearTimeout(safetyId);
      state.exporting = null;
      state.script.loop = originalLoop;
      audioMgr.stopRecording();
      renderer.setPixelRatio(origPixelRatio);
      resize();
      document.body.classList.remove('recording');
      document.getElementById('export-panel').classList.remove('show');
    };
    recorder.onstop = async () => {
      console.log('[export] recorder.onstop, chunks:', chunks.length, 'bytes:', totalBytes);
      if (chunks.length === 0 || totalBytes === 0) {
        showError('Recording produced no data. Check the console for [export] logs and try again.');
        cleanup();
        resolve();
        return;
      }
      const blob = new Blob(chunks, { type: mime });
      const baseName = (opts.filename || state.script.name || 'export').replace(/\s+/g, '_').replace(/\.(webm|mp4)$/i, '');
      const fullName = `${baseName}.${ext}`;
      cleanup();
      const savedPath = await saveBlob(blob, fullName, ext);
      const mb = (blob.size / 1_000_000).toFixed(1);
      if (savedPath) {
        // savedPath is a bare filename (from showSaveFilePicker; browsers hide
        // full paths for security) OR a ~/Downloads/... hint from the fallback.
        console.log('[export] SAVED:', savedPath, '(' + mb + ' MB)');
        const hint = savedPath.startsWith('~/')
          ? savedPath
          : `${savedPath} — in the folder you chose in the Save dialog (Spotlight-search the filename if unsure)`;
        showBanner(`✓ Saved (${mb} MB): ${hint}`, 'ok', { sticky: true, dismissable: true });
      } else {
        showBanner(`Recording ready (${mb} MB) — save cancelled`, 'ok', { sticky: true, dismissable: true });
      }
      resolve();
    };

    const finish = () => {
      console.log('[export] finish() called, recorder.state:', recorder.state, 'framesPushed:', state.exporting?.framesPushed);
      try {
        if (recorder.state === 'recording') {
          try { recorder.requestData(); } catch {}
          recorder.stop();
        } else if (recorder.state === 'paused') {
          try { recorder.resume(); } catch {}
          recorder.stop();
        } else {
          console.warn('[export] recorder in state', recorder.state, '— aborting');
          cleanup();
          showError('Recording failed to start.');
          resolve();
        }
      } catch (e) { console.error(e); cleanup(); resolve(); }
    };

    state.exporting = {
      width: W, height: H, mime, ext,
      videoTrack, fps,
      framesPushed: 0,
      lastFramePushAt: 0,
      onFinished: finish,
      cancel: finish,
    };

    document.getElementById('btn-export-cancel').onclick = () => state.exporting?.cancel();

    safetyId = setTimeout(() => {
      if (finished) return;
      console.warn('[export] safety timeout hit — force-stopping recorder');
      finish();
    }, safetyTimeoutMs);

    // Rewind ONCE more so the recording starts exactly at scene 1 (playback
    // has been running for a few frames to warm the capture pipeline).
    state.player.sceneIndex = 0;
    state.player.sceneTime = 0;
    loadSceneAt(0, { tweenCamera: false }).then(() => {
      audioMgr.startForScene(activeSceneCfg?.audio, activeSceneCfg?.duration || 0);
      // Kick off the recorder with a 1-second timeslice so we see chunks
      // arrive in the console every second — much easier to diagnose than
      // one final blob at stop.
      recorder.start(1000);
      console.log('[export] recorder.start(1000), state:', recorder.state, 'total duration:', totalScriptDuration.toFixed(1) + 's');
      // Explicitly push a first frame to prime the pipeline
      try { videoTrack.requestFrame && videoTrack.requestFrame(); } catch {}
    });
  });
}

// ============================================================================

// ============================================================================
// Editor: rendering
// ============================================================================

const sceneListEl = document.getElementById('scene-list');
const sceneFormEl = document.getElementById('scene-form');
const jsonViewEl = document.getElementById('json-view');
const jsonErrorEl = document.getElementById('json-error');
const timeLabelEl = document.getElementById('time-label');
const timelineFillEl = document.getElementById('timeline-fill');
const loopCheckboxEl = document.getElementById('chk-loop');
const muteCheckboxEl = document.getElementById('chk-mute');

// --- Scene list with drag-reorder ---
let dragFromIndex = -1;
function renderSceneList() {
  sceneListEl.innerHTML = '';
  if (state.script.scenes.length === 0) {
    const hint = document.createElement('div');
    hint.className = 'empty-hint';
    hint.textContent = 'No scenes yet. Click "+ Add scene" below.';
    sceneListEl.appendChild(hint);
    return;
  }
  state.script.scenes.forEach((sc, i) => {
    const row = document.createElement('div');
    row.className = 'scene-item';
    row.draggable = true;
    if (i === state.selectedIndex) row.classList.add('selected');
    if (state.player.playing && i === state.player.sceneIndex) row.classList.add('playing');

    const idx = document.createElement('span');
    idx.className = 'idx'; idx.textContent = String(i + 1);
    const name = document.createElement('span');
    name.className = 'name';
    const label = sc.name || (sc.model ? basename(sc.model).replace(/_/g, ' ').replace(/\.usdz$/i, '') : '(no model)');
    name.textContent = label;
    const badge = document.createElement('span');
    badge.className = 'chip'; badge.textContent = (sc.duration || 0).toFixed(1) + 's';
    name.appendChild(badge);
    if (sc.audio && sc.audio.src) {
      const a = document.createElement('span'); a.className = 'chip'; a.textContent = '♪'; name.appendChild(a);
    }

    const actions = document.createElement('span');
    actions.className = 'actions';
    const dup = mkIcon('⧉', () => duplicateScene(i));
    const del = mkIcon('×', () => removeScene(i));
    actions.append(dup, del);

    row.append(idx, name, actions);
    row.addEventListener('click', (e) => {
      if (e.target.closest('.actions')) return;
      selectScene(i);
    });

    // Drag-and-drop reorder
    row.addEventListener('dragstart', (e) => {
      dragFromIndex = i;
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(i));
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      document.querySelectorAll('.scene-item.drag-over-before, .scene-item.drag-over-after')
        .forEach((el) => el.classList.remove('drag-over-before', 'drag-over-after'));
    });
    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const rect = row.getBoundingClientRect();
      const before = (e.clientY - rect.top) < rect.height / 2;
      row.classList.toggle('drag-over-before', before);
      row.classList.toggle('drag-over-after', !before);
    });
    row.addEventListener('dragleave', () => {
      row.classList.remove('drag-over-before', 'drag-over-after');
    });
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      const from = dragFromIndex;
      let to = i + (row.classList.contains('drag-over-after') ? 1 : 0);
      row.classList.remove('drag-over-before', 'drag-over-after');
      if (from < 0 || from === to || from === to - 1) return;
      const [moved] = state.script.scenes.splice(from, 1);
      if (from < to) to--;
      state.script.scenes.splice(to, 0, moved);
      if (state.selectedIndex === from) state.selectedIndex = to;
      else if (from < state.selectedIndex && to >= state.selectedIndex) state.selectedIndex--;
      else if (from > state.selectedIndex && to <= state.selectedIndex) state.selectedIndex++;
      scriptChanged();
    });

    sceneListEl.appendChild(row);
  });
}

function mkIcon(txt, cb) {
  const b = document.createElement('button');
  b.className = 'icon'; b.textContent = txt;
  b.addEventListener('click', (e) => { e.stopPropagation(); cb(); });
  return b;
}

async function selectScene(i) {
  state.selectedIndex = i;
  renderSceneList();
  renderSceneForm();
  if (state.mode === 'sequence' && !state.player.playing) {
    state.player.sceneIndex = i;
    state.player.sceneTime = 0;
    await loadSceneAt(i, { tweenCamera: true });
  }
}
function duplicateScene(i) {
  const clone = JSON.parse(JSON.stringify(state.script.scenes[i]));
  state.script.scenes.splice(i + 1, 0, clone);
  state.selectedIndex = i + 1;
  scriptChanged();
}
function removeScene(i) {
  state.script.scenes.splice(i, 1);
  if (state.selectedIndex >= state.script.scenes.length) state.selectedIndex = state.script.scenes.length - 1;
  scriptChanged();
}
function addScene() {
  const cam = state.script.scenes[state.script.scenes.length - 1]?.camera
    || { position: [3.5, -3.5, 2.5], lookAt: [0, 0, 0.8], fov: 40 };
  const sc = {
    model: state.manifest.models[0]?.path || '',
    duration: 4,
    camera: JSON.parse(JSON.stringify(cam)),
    transforms: [{ type: 'rotate', axis: 'z', degPerSec: 90 }],
    overlays: [],
  };
  state.script.scenes.push(sc);
  state.selectedIndex = state.script.scenes.length - 1;
  scriptChanged();
}

// --- Scene form ---

function renderSceneForm() {
  sceneFormEl.innerHTML = '';
  const i = state.selectedIndex;
  const sc = state.script.scenes[i];
  if (!sc) {
    sceneFormEl.innerHTML = '<div class="empty-hint">Select a scene to edit</div>';
    return;
  }
  addTextRow(sceneFormEl, 'Name', sc.name || '', (v) => { sc.name = v || undefined; scriptChanged(); });
  addModelRow(sceneFormEl, sc);
  addNumberRow(sceneFormEl, 'Duration (s)', sc.duration ?? 4, 0.1, (v) => { sc.duration = v; scriptChanged(); });
  addSelectRow(sceneFormEl, 'Model up', sc.modelUp || 'y',
    [['y', 'Y-up (default)'], ['z', 'Z-up']],
    (v) => { sc.modelUp = v; scriptChanged(); });

  // --- Camera ---
  const cam = sc.camera = sc.camera || { position: [3.5, -3.5, 2.5], lookAt: [0, 0, 0.8], fov: 40 };
  const camBlock = subblock(sceneFormEl, 'Camera');
  addVec3Row(camBlock, 'Position', cam.position, (v) => { cam.position = v; scriptChanged(); });
  addVec3Row(camBlock, 'Look at', cam.lookAt, (v) => { cam.lookAt = v; scriptChanged(); });
  addNumberRow(camBlock, 'FOV', cam.fov ?? 40, 1, (v) => { cam.fov = v; scriptChanged(); });
  const btnCopy = document.createElement('button');
  btnCopy.className = 'btn'; btnCopy.textContent = 'Use current view'; btnCopy.style.marginTop = '4px';
  btnCopy.addEventListener('click', () => {
    cam.position = [round(camera.position.x), round(camera.position.y), round(camera.position.z)];
    cam.lookAt = [round(controls.target.x), round(controls.target.y), round(controls.target.z)];
    cam.fov = camera.fov;
    scriptChanged();
  });
  camBlock.appendChild(btnCopy);

  // --- Initial transform ---
  const init = sc.initial = sc.initial || {};
  const initBlock = subblock(sceneFormEl, 'Initial transform');
  addVec3Row(initBlock, 'Position', init.position || [0, 0, 0], (v) => { init.position = v; scriptChanged(); });
  addVec3Row(initBlock, 'Rotation°', init.rotation || [0, 0, 0], (v) => { init.rotation = v; scriptChanged(); });
  addNumberRow(initBlock, 'Scale', typeof init.scale === 'number' ? init.scale : 1, 0.05, (v) => { init.scale = v; scriptChanged(); });

  // --- Transforms ---
  const tfBlock = subblock(sceneFormEl, 'Transforms');
  sc.transforms = sc.transforms || [];
  sc.transforms.forEach((tf, idx) => renderTransform(tfBlock, sc, tf, idx));
  const addTf = document.createElement('div');
  addTf.style.display = 'grid'; addTf.style.gridTemplateColumns = '1fr 1fr'; addTf.style.gap = '4px'; addTf.style.marginTop = '6px';
  for (const [type, label] of [['rotate', '+ rotate'], ['rotateTo', '+ rotateTo'], ['translateTo', '+ translateTo'], ['scaleTo', '+ scaleTo']]) {
    const b = document.createElement('button');
    b.className = 'add-btn'; b.textContent = label;
    b.addEventListener('click', () => { sc.transforms.push(defaultTransform(type)); scriptChanged(); });
    addTf.appendChild(b);
  }
  tfBlock.appendChild(addTf);

  // --- Overlays ---
  const ovBlock = subblock(sceneFormEl, 'Overlays');
  sc.overlays = sc.overlays || [];
  sc.overlays.forEach((ov, idx) => renderOverlayForm(ovBlock, sc, ov, idx));
  const addOv = document.createElement('button');
  addOv.className = 'add-btn'; addOv.textContent = '+ Add overlay';
  addOv.addEventListener('click', () => {
    sc.overlays.push({ text: 'New Text', position: 'bottom', fadeIn: 0.5, hold: 2, fadeOut: 0.5, start: 0 });
    scriptChanged();
  });
  ovBlock.appendChild(addOv);

  // --- Audio ---
  const audBlock = subblock(sceneFormEl, 'Audio');
  sc.audio = sc.audio || {};
  addTextRow(audBlock, 'Source', sc.audio.src || '', (v) => {
    if (v) sc.audio.src = v;
    else delete sc.audio.src;
    scriptChanged();
  });
  addNumberRow(audBlock, 'Volume', sc.audio.volume ?? 1, 0.05, (v) => { sc.audio.volume = v; scriptChanged(); });
  addNumberRow(audBlock, 'Fade in',  sc.audio.fadeIn ?? 0, 0.1, (v) => { sc.audio.fadeIn = v; scriptChanged(); });
  addNumberRow(audBlock, 'Fade out', sc.audio.fadeOut ?? 0, 0.1, (v) => { sc.audio.fadeOut = v; scriptChanged(); });
  addNumberRow(audBlock, 'Start (s)', sc.audio.start ?? 0, 0.1, (v) => { sc.audio.start = v; scriptChanged(); });
  const loopRow = row(audBlock, 'Loop');
  const loopChk = document.createElement('input'); loopChk.type = 'checkbox'; loopChk.checked = !!sc.audio.loop;
  loopChk.addEventListener('change', () => { sc.audio.loop = loopChk.checked; scriptChanged(); });
  loopRow.appendChild(loopChk);
}

function defaultTransform(type) {
  if (type === 'rotate') return { type, axis: 'z', degPerSec: 90 };
  if (type === 'rotateTo') return { type, axis: 'z', from: 0, degrees: 90, start: 0, duration: 1, ease: 'easeInOut' };
  if (type === 'translateTo') return { type, to: [0, 0, 0], start: 0, duration: 1, ease: 'easeInOut' };
  if (type === 'scaleTo') return { type, to: 1.2, start: 0, duration: 1, ease: 'easeInOut' };
  return { type };
}

function renderTransform(parent, sc, tf, idx) {
  const box = document.createElement('div');
  box.className = 'subblock';
  const head = document.createElement('div');
  head.className = 'subblock-head';
  const chip = document.createElement('span');
  chip.className = 'chip ' + (tf.type.startsWith('rot') ? 'rot' : tf.type.startsWith('trans') ? 'trs' : 'scl');
  chip.textContent = tf.type;
  head.appendChild(chip);
  const sp = document.createElement('span'); sp.className = 'spacer'; head.appendChild(sp);
  head.appendChild(mkIcon('×', () => { sc.transforms.splice(idx, 1); scriptChanged(); }));
  box.appendChild(head);

  if (tf.type === 'rotate') {
    addSelectRow(box, 'Axis', tf.axis || 'z', [['x','X'],['y','Y'],['z','Z']], (v) => { tf.axis = v; scriptChanged(); });
    addNumberRow(box, 'deg/sec', tf.degPerSec ?? 90, 1, (v) => { tf.degPerSec = v; scriptChanged(); });
  } else if (tf.type === 'rotateTo') {
    addSelectRow(box, 'Axis', tf.axis || 'z', [['x','X'],['y','Y'],['z','Z']], (v) => { tf.axis = v; scriptChanged(); });
    addNumberRow(box, 'from°', tf.from ?? 0, 1, (v) => { tf.from = v; scriptChanged(); });
    addNumberRow(box, 'to°', tf.degrees ?? 90, 1, (v) => { tf.degrees = v; scriptChanged(); });
    addNumberRow(box, 'start (s)', tf.start ?? 0, 0.1, (v) => { tf.start = v; scriptChanged(); });
    addNumberRow(box, 'dur (s)', tf.duration ?? 1, 0.1, (v) => { tf.duration = v; scriptChanged(); });
    addEaseRow(box, tf);
  } else if (tf.type === 'translateTo') {
    if (tf.from) addVec3Row(box, 'from', tf.from, (v) => { tf.from = v; scriptChanged(); });
    addVec3Row(box, 'to', tf.to || [0, 0, 0], (v) => { tf.to = v; scriptChanged(); });
    addNumberRow(box, 'start (s)', tf.start ?? 0, 0.1, (v) => { tf.start = v; scriptChanged(); });
    addNumberRow(box, 'dur (s)', tf.duration ?? 1, 0.1, (v) => { tf.duration = v; scriptChanged(); });
    addEaseRow(box, tf);
  } else if (tf.type === 'scaleTo') {
    addNumberRow(box, 'to', typeof tf.to === 'number' ? tf.to : 1, 0.05, (v) => { tf.to = v; scriptChanged(); });
    addNumberRow(box, 'start (s)', tf.start ?? 0, 0.1, (v) => { tf.start = v; scriptChanged(); });
    addNumberRow(box, 'dur (s)', tf.duration ?? 1, 0.1, (v) => { tf.duration = v; scriptChanged(); });
    addEaseRow(box, tf);
  }
  parent.appendChild(box);
}

function renderOverlayForm(parent, sc, ov, idx) {
  const box = document.createElement('div');
  box.className = 'subblock';
  const head = document.createElement('div');
  head.className = 'subblock-head';
  const title = document.createElement('span');
  title.className = 'title'; title.textContent = truncate(ov.text || 'Text', 28);
  head.appendChild(title);
  const sp = document.createElement('span'); sp.className = 'spacer'; head.appendChild(sp);
  head.appendChild(mkIcon('×', () => { sc.overlays.splice(idx, 1); scriptChanged(); }));
  box.appendChild(head);

  addTextRow(box, 'Text', ov.text || '', (v) => { ov.text = v; title.textContent = truncate(v, 28); scriptChanged(); });
  addSelectRow(box, 'Position', ov.position || 'bottom',
    [['top','Top'],['center','Center'],['bottom','Bottom']],
    (v) => { ov.position = v; scriptChanged(); });
  addNumberRow(box, 'Start (s)', ov.start ?? 0, 0.1, (v) => { ov.start = v; scriptChanged(); });
  addNumberRow(box, 'Fade in',   ov.fadeIn ?? 0.5, 0.1, (v) => { ov.fadeIn = v; scriptChanged(); });
  addNumberRow(box, 'Hold',      ov.hold ?? 2, 0.1, (v) => { ov.hold = v; scriptChanged(); });
  addNumberRow(box, 'Fade out',  ov.fadeOut ?? 0.5, 0.1, (v) => { ov.fadeOut = v; scriptChanged(); });
  addTextRow(box, 'Color',       ov.color || '', (v) => { ov.color = v || undefined; scriptChanged(); });
  addNumberRow(box, 'Font size', ov.fontSize ?? 32, 1, (v) => { ov.fontSize = v; scriptChanged(); });
  parent.appendChild(box);
}

function subblock(parent, title) {
  const box = document.createElement('div');
  box.className = 'subblock';
  const h = document.createElement('div');
  h.className = 'subblock-head';
  const t = document.createElement('span');
  t.className = 'title'; t.textContent = title;
  h.appendChild(t);
  box.appendChild(h);
  parent.appendChild(box);
  return box;
}
function row(parent, label) {
  const r = document.createElement('div'); r.className = 'form-row';
  const l = document.createElement('label'); l.textContent = label;
  r.appendChild(l); parent.appendChild(r); return r;
}
function addTextRow(parent, label, value, cb) {
  const r = row(parent, label);
  const i = document.createElement('input'); i.type = 'text'; i.value = value ?? '';
  i.addEventListener('input', () => cb(i.value));
  r.appendChild(i);
}
function addNumberRow(parent, label, value, step, cb) {
  const r = row(parent, label);
  const i = document.createElement('input'); i.type = 'number'; i.step = String(step); i.value = value ?? 0;
  i.addEventListener('input', () => cb(parseFloat(i.value)));
  r.appendChild(i);
}
function addVec3Row(parent, label, value, cb) {
  const r = row(parent, label);
  const grid = document.createElement('div'); grid.className = 'vec3';
  const arr = [value?.[0] ?? 0, value?.[1] ?? 0, value?.[2] ?? 0];
  const inputs = arr.map((v) => {
    const i = document.createElement('input'); i.type = 'number'; i.step = '0.1'; i.value = v;
    i.addEventListener('input', () => cb(inputs.map((x) => parseFloat(x.value) || 0)));
    return i;
  });
  inputs.forEach((i) => grid.appendChild(i));
  r.appendChild(grid);
}
function addSelectRow(parent, label, value, opts, cb) {
  const r = row(parent, label);
  const s = document.createElement('select');
  for (const [v, l] of opts) {
    const o = document.createElement('option'); o.value = v; o.textContent = l;
    if (v === value) o.selected = true;
    s.appendChild(o);
  }
  s.addEventListener('change', () => cb(s.value));
  r.appendChild(s);
}
function addEaseRow(parent, tf) {
  addSelectRow(parent, 'Ease', tf.ease || 'linear',
    [['linear','linear'],['easeIn','easeIn'],['easeOut','easeOut'],['easeInOut','easeInOut']],
    (v) => { tf.ease = v; scriptChanged(); });
}
function addModelRow(parent, sc) {
  const r = row(parent, 'Model');
  const wrap = document.createElement('div');
  wrap.style.display = 'grid'; wrap.style.gridTemplateColumns = '1fr'; wrap.style.gap = '4px';
  const sel = document.createElement('select');
  const noneOpt = document.createElement('option'); noneOpt.value = ''; noneOpt.textContent = '— select model —';
  sel.appendChild(noneOpt);
  for (const m of state.manifest.models) {
    const o = document.createElement('option'); o.value = m.path; o.textContent = m.label;
    if (m.path === sc.model) o.selected = true;
    sel.appendChild(o);
  }
  const customOpt = document.createElement('option'); customOpt.value = '__custom'; customOpt.textContent = 'custom path…';
  sel.appendChild(customOpt);
  const isCustom = sc.model && !state.manifest.models.some((m) => m.path === sc.model);
  if (isCustom) customOpt.selected = true;
  const pathInput = document.createElement('input');
  pathInput.type = 'text'; pathInput.value = sc.model || ''; pathInput.placeholder = 'models/…';
  pathInput.style.display = isCustom ? '' : 'none';
  sel.addEventListener('change', () => {
    if (sel.value === '__custom') { pathInput.style.display = ''; pathInput.focus(); }
    else { pathInput.style.display = 'none'; sc.model = sel.value || undefined; scriptChanged(); }
  });
  pathInput.addEventListener('change', () => { sc.model = pathInput.value || undefined; scriptChanged(); });
  wrap.append(sel, pathInput);
  r.appendChild(wrap);
}

// ============================================================================
// State change / autosave / JSON view
// ============================================================================

async function scriptChanged() {
  renderSceneList();
  renderSceneForm();
  jsonViewEl.value = JSON.stringify(state.script, null, 2);
  jsonErrorEl.textContent = '';
  saveToLocalStorage();
  if (state.mode === 'sequence' && !state.player.playing && state.selectedIndex >= 0) {
    clearTimeout(scriptChanged._t);
    scriptChanged._t = setTimeout(() => loadSceneAt(state.selectedIndex, { tweenCamera: true }), 120);
  }
}

function totalDuration() { return state.script.scenes.reduce((a, s) => a + (s.duration || 0), 0); }
function elapsedBefore(index) { let t = 0; for (let i = 0; i < index; i++) t += state.script.scenes[i]?.duration || 0; return t; }
function updateTransport() {
  const total = totalDuration();
  const now = elapsedBefore(state.player.sceneIndex) + state.player.sceneTime;
  timeLabelEl.textContent = `${now.toFixed(1)} / ${total.toFixed(1)}s`;
  const pct = total > 0 ? Math.min(100, (now / total) * 100) : 0;
  timelineFillEl.style.width = pct.toFixed(1) + '%';
}

const LS_KEY = 'usdz-viewer.script.v1';
function saveToLocalStorage() { try { localStorage.setItem(LS_KEY, JSON.stringify(state.script)); } catch {} }
function loadFromLocalStorage() { try { const s = localStorage.getItem(LS_KEY); return s ? JSON.parse(s) : null; } catch { return null; } }

function exportScript() {
  const blob = new Blob([JSON.stringify(state.script, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (state.script.name || 'script').replace(/\s+/g, '_') + '.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
function importScript(file) {
  const fr = new FileReader();
  fr.onload = () => {
    try { loadScript(JSON.parse(fr.result)); }
    catch (e) { showError('Import failed: ' + e.message); }
  };
  fr.readAsText(file);
}
function loadScript(obj) {
  state.script = normalizeScript(obj);
  state.selectedIndex = state.script.scenes.length > 0 ? 0 : -1;
  state.player.sceneIndex = 0;
  state.player.sceneTime = 0;
  state.player.playing = false;
  setBackground(state.script.background);
  setFloor(state.script.floor);
  loopCheckboxEl.checked = !!state.script.loop;
  jsonViewEl.value = JSON.stringify(state.script, null, 2);
  renderSceneList();
  renderSceneForm();
  updateTransport();
  if (state.mode === 'sequence') {
    if (state.selectedIndex >= 0) loadSceneAt(state.selectedIndex, { tweenCamera: false });
    else { activeContainer = mountPlaceholder(); hudSceneEl.textContent = '(empty)'; hudModelEl.textContent = ''; clearOverlays(); }
  }
}
function normalizeScript(obj) {
  const out = Object.assign(emptyScript(), obj || {});
  out.scenes = Array.isArray(out.scenes) ? out.scenes : [];
  out.cameraTransition = Object.assign({ duration: 0.8, ease: 'easeInOut' }, obj?.cameraTransition || {});
  return out;
}

// ============================================================================
// UI wiring
// ============================================================================

document.getElementById('btn-play').addEventListener('click', () => play());
document.getElementById('btn-pause').addEventListener('click', () => pause());
document.getElementById('btn-stop').addEventListener('click', () => stop());
document.getElementById('btn-prev').addEventListener('click', () => prevScene());
document.getElementById('btn-next').addEventListener('click', () => nextScene());
document.getElementById('btn-add-scene').addEventListener('click', () => addScene());
document.getElementById('btn-export').addEventListener('click', () => exportScript());
document.getElementById('btn-import').addEventListener('click', () => document.getElementById('file-import').click());
document.getElementById('btn-fullscreen').addEventListener('click', () => enterPresent());
document.getElementById('exit-present-btn').addEventListener('click', () => exitPresent());
// Record dialog
const recordDialog   = document.getElementById('record-dialog');
const recordFilename = document.getElementById('record-filename');
const recordFormat   = document.getElementById('record-format');
const recordFps      = document.getElementById('record-fps');
const recordScale    = document.getElementById('record-scale');
const recordAudio    = document.getElementById('record-audio');
const recordInfo     = document.getElementById('record-info');

function openRecordDialog() {
  recordFilename.value = (state.script.name || 'export').replace(/\s+/g, '_');
  const dur = totalDuration();
  const hasFsAPI = 'showSaveFilePicker' in window;
  recordInfo.innerHTML =
    `Estimated duration: <strong>${dur.toFixed(1)}s</strong>. Keep this tab focused during recording — ` +
    `browsers throttle background tabs.<br>` +
    (hasFsAPI
      ? 'A native "Save as…" dialog appears when recording ends.'
      : 'File saves to your browser\'s Downloads folder.');
  recordDialog.classList.add('show');
  recordFilename.focus();
  recordFilename.select();
}
function closeRecordDialog() { recordDialog.classList.remove('show'); }

document.getElementById('btn-record').addEventListener('click', openRecordDialog);
document.getElementById('btn-record-cancel').addEventListener('click', closeRecordDialog);
document.getElementById('btn-record-start').addEventListener('click', async () => {
  const filename = (recordFilename.value || 'export').trim().replace(/[/\\:*?"<>|]/g, '_');
  const format = recordFormat.value;
  const fps = parseInt(recordFps.value, 10) || 30;
  const scale = parseFloat(recordScale.value) || 1;
  const includeAudio = recordAudio.checked;

  // NOTE: we intentionally do NOT open the native save picker up-front here.
  // showSaveFilePicker creates the file immediately, and if recording then
  // produces no data we'd leave the user with a 0-byte file. Instead we
  // record first, then offer the save picker only after we know we have data.

  closeRecordDialog();
  try {
    await exportVideo({ fps, scale, includeAudio, format, filename });
  } catch (e) {
    showError('Export failed: ' + (e.message || e));
  }
});
recordDialog.addEventListener('click', (e) => { if (e.target === recordDialog) closeRecordDialog(); });
document.getElementById('file-import').addEventListener('change', (e) => {
  const f = e.target.files[0]; if (f) importScript(f); e.target.value = '';
});
loopCheckboxEl.addEventListener('change', () => { state.script.loop = loopCheckboxEl.checked; scriptChanged(); });
muteCheckboxEl.addEventListener('change', () => audioMgr.setMuted(muteCheckboxEl.checked));

document.querySelectorAll('.mode-tab').forEach((b) => {
  b.addEventListener('click', () => setMode(b.dataset.mode));
});

document.getElementById('btn-gallery-reload').addEventListener('click', () => buildGallery());
document.getElementById('btn-detail-back').addEventListener('click', () => backFromDetail());
backBtnEl.addEventListener('click', () => backFromDetail());

document.getElementById('chk-detail-orbit').addEventListener('change', (e) => {
  detail.orbit = e.target.checked;
});

document.querySelectorAll('.section-head').forEach((h) => {
  h.addEventListener('click', () => {
    const s = document.getElementById(h.dataset.target);
    s.classList.toggle('collapsed');
    const caret = h.querySelector('.caret');
    caret.textContent = s.classList.contains('collapsed') ? '▸' : '▾';
  });
});

document.getElementById('btn-apply-json').addEventListener('click', () => {
  try { loadScript(JSON.parse(jsonViewEl.value)); jsonErrorEl.textContent = ''; }
  catch (e) { jsonErrorEl.textContent = 'Invalid JSON: ' + e.message; }
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (state.present) { exitPresent(); return; }
    if (state.mode === 'detail') backFromDetail();
    return;
  }
  if (e.key === ' ' && state.mode === 'sequence' && document.activeElement === document.body) {
    e.preventDefault();
    state.player.playing ? pause() : play();
  }
});

// ============================================================================
// Startup
// ============================================================================

function showLoading(msg) { loadingEl.textContent = msg; loadingEl.classList.add('show'); }
function hideLoading() { loadingEl.classList.remove('show'); }
function showError(msg) { errorBoxEl.textContent = msg; errorBoxEl.classList.add('show'); setTimeout(() => hideError(), 6000); }
function hideError() { errorBoxEl.classList.remove('show'); }
function showBanner(msg, kind, opts = {}) {
  errorBoxEl.innerHTML = '';
  const span = document.createElement('span');
  span.textContent = msg;
  errorBoxEl.appendChild(span);
  if (opts.dismissable) {
    const btn = document.createElement('button');
    btn.textContent = ' ✕';
    btn.style.cssText = 'background:transparent;border:0;color:inherit;cursor:pointer;float:right;font-size:14px;';
    btn.onclick = () => { hideError(); errorBoxEl.style.background = ''; errorBoxEl.style.borderColor = ''; };
    errorBoxEl.appendChild(btn);
  }
  errorBoxEl.classList.add('show');
  errorBoxEl.style.background = kind === 'ok' ? 'rgba(30, 90, 40, 0.92)' : '';
  errorBoxEl.style.borderColor = kind === 'ok' ? 'var(--ok)' : '';
  if (!opts.sticky) {
    setTimeout(() => { hideError(); errorBoxEl.style.background = ''; errorBoxEl.style.borderColor = ''; }, opts.timeout || 5000);
  }
}

async function saveBlob(blob, filename, ext) {
  // Preferred: File System Access API (Chromium) — user picks the location AFTER
  // we know we have data, so we never leave an empty file on disk.
  if ('showSaveFilePicker' in window) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{
          description: ext === 'mp4' ? 'MP4 video' : 'WebM video',
          accept: { [ext === 'mp4' ? 'video/mp4' : 'video/webm']: ['.' + ext] },
        }],
      });
      const w = await handle.createWritable();
      await w.write(blob);
      await w.close();
      return handle.name;
    } catch (e) {
      if (e.name === 'AbortError') return null;   // user cancelled — no fallback
      console.warn('[export] file handle write failed, falling back to download:', e);
    }
  }
  // Fallback: anchor-download (goes to browser's Downloads folder).
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(url);
      resolve(`~/Downloads/${filename}`);
    }, 500);
  });
}
function basename(p) { return p ? p.split('/').pop() : ''; }
function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function round(x) { return Math.round(x * 100) / 100; }

(async function bootstrap() {
  try {
    const mres = await fetch('manifest.json');
    if (mres.ok) state.manifest = await mres.json();
  } catch (e) {
    console.warn('No manifest.json — model dropdown will be empty', e);
  }
  const saved = loadFromLocalStorage();
  if (saved && Array.isArray(saved.scenes) && saved.scenes.length > 0) loadScript(saved);
  else {
    try {
      const r = await fetch('demo.json');
      if (r.ok) loadScript(await r.json());
      else loadScript(emptyScript());
    } catch { loadScript(emptyScript()); }
  }
})();
