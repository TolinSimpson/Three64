'use strict';
import { RendererCore } from "./renderer.js";
import { PhysicsWorld } from "./physics.js";
import { SceneLoader } from "./assetLoader.js";
import { BudgetTracker, initDebugOverlay, Debug } from "./debug.js";
import { Object3D } from "three";
import { loadJSON } from "./io.js";
import LoadingScreen from "./loadingScreen.js";
import { EventSystem } from "./eventSystem.js";
import { UISystem } from "./uiSystem.js";
import { Statistic } from "./statistic.js";
import { StatisticBar } from "./statisticBar.js";
import { ensurePoolSingleton } from "./pool.js";
import { ArchetypeRegistry } from "./component.js";
import "./navmesh.js";
import "./raycaster.js";
import "./volume.js";
import "./player.js"; // ensure Player component registers itself via ComponentRegistry
import "./agent.js";
import "./locomotion.js";
import "./rigidbody.js";
import "./projectile.js";
import "./statistic.js";
import "./statisticBar.js";
import "./item.js";
import "./inventory.js";
import { MainMenu } from "./mainMenu.js";
import { SettingsMenu } from "./settingsMenu.js";
import { Input } from "./input.js";
import { NetworkSystem } from "./network.js";
import { MultisynqNetworkSystem } from "./multisynq.js";
export let config = null;

async function loadEngineConfig() {
  // Fallback defaults if JSON is unavailable
  const fallback = {
    targetFPS: 30,
    renderer: {
      internalWidth: 640,
      internalHeight: 480,
      defaultDoubleSided: false,
    },
    budgets: {
      trisPerFrame: 5333,
      ramBytes: 8 * 1024 * 1024,
      textureMemoryBytes: 4096,
      maxBonesPerMesh: 40,
      audio: { maxVoices: 24, maxRateHz: 44100 },
      particles: { maxActive: 512, trisPerQuad: 2 },
      ui: {
        allowedFormats: ["PNG8", "PNG_RGBA_SMALL"],
        maxSpriteSize: 96,
        maxAtlasSize: { w: 512, h: 256 },
        perFrameTiles: 12,
        requireTileMultiple: 8,
      },
    },
    devMode: (typeof __DEV__ !== 'undefined') ? __DEV__ : false,
  };
  try {
    const json = await loadJSON("build/assets/config/engine-config.json");
    // shallow-merge with fallback to ensure required keys exist
    config = { ...fallback, ...json };
    config.renderer = { ...fallback.renderer, ...(json?.renderer || {}) };
    config.budgets = { ...fallback.budgets, ...(json?.budgets || {}) };
    config.budgets.audio = { ...fallback.budgets.audio, ...(json?.budgets?.audio || {}) };
    config.budgets.particles = { ...fallback.budgets.particles, ...(json?.budgets?.particles || {}) };
    config.budgets.ui = { ...fallback.budgets.ui, ...(json?.budgets?.ui || {}) };
  } catch {
    config = fallback;
  }
  return config;
}

// EngineLimits removed; prefer reading from config directly

export function textureMemoryBytesForTexture({ width, height, bpp, paletteBytes = 0 }) {
  return (width * height * bpp) / 8 + paletteBytes;
}

export function fitsInTextureMemory({ width, height, bpp, paletteBytes = 0 }) {
  return textureMemoryBytesForTexture({ width, height, bpp, paletteBytes }) <= (config?.budgets?.textureMemoryBytes || 0);
}

export function getInternalResolution() {
  const w = config?.renderer?.internalWidth || 640;
  const h = config?.renderer?.internalHeight || 480;
  return { width: w, height: h };
}

export function uiSpriteWithinBudget({ width, height, format, paletteBytes = 0 }) {
  const ui = config.budgets.ui;
  const maxSprite = ui.maxSpriteSize;
  if (width > maxSprite || height > maxSprite) return false;
  if (!ui.allowedFormats?.includes(format)) return false;
  if (format === 'PNG_RGBA_SMALL') {
    if (width > 32 || height > 32) return false;
    return fitsInTextureMemory({ width, height, bpp: 32, paletteBytes: 0 });
  }
  const bpp = 8;
  return fitsInTextureMemory({ width, height, bpp, paletteBytes });
}

export function uiAtlasWithinBudget({ width, height }) {
  const ui = config.budgets.ui;
  const limit = ui.maxAtlasSize;
  return width <= (limit?.w || 0) && height <= (limit?.h || 0);
}

// -----------------------------
// Runtime bootstrap
// -----------------------------
let frameIntervalMs = 1000 / 60;
let lastStepTime = performance.now();
let app;

// -----------------------------
// Pool manager for archetype-driven spawning
// -----------------------------
class PoolManager {
  constructor(game) {
    this.game = game;
    this._pools = new Map(); // name -> { idle: Object3D[], active: Object3D[], createdCount: number }
    this._policies = new Map(); // name -> { max?: number, overflow?: "create"|"drop"|"reuseOldest" }
  }
  _getPool(name) {
    const key = String(name);
    if (!this._pools.has(key)) this._pools.set(key, { idle: [], active: [], createdCount: 0 });
    return this._pools.get(key);
  }
  setPolicy(name, { max, overflow } = {}) {
    const key = String(name);
    const policy = this._policies.get(key) || {};
    if (typeof max === "number") policy.max = Math.max(0, max | 0);
    if (typeof overflow === "string") policy.overflow = overflow;
    this._policies.set(key, policy);
  }
  prewarm(name, count = 0, opts = undefined) {
    const n = Math.max(0, count | 0);
    const pool = this._getPool(name);
    const entry = ArchetypeRegistry.get(name);
    for (let i = 0; i < n; i++) {
      const obj = ArchetypeRegistry.create(this.game, name, { overrides: opts?.overrides || {}, traits: opts?.traits || {} });
      if (!obj) continue;
      try { obj.visible = false; } catch {}
      try { obj.userData = obj.userData || {}; obj.userData.__pooled = true; } catch {}
      pool.idle.push(obj);
      pool.createdCount = (pool.createdCount | 0) + 1;
    }
  }
  obtain(name, { overrides = {}, traits = {} } = {}) {
    const pool = this._getPool(name);
    let obj = pool.idle.pop();
    if (!obj) {
      // Enforce policy if defined
      const policy = this._policies.get(String(name)) || {};
      const max = (typeof policy.max === "number") ? policy.max : undefined;
      const overflow = policy.overflow || "create";
      if (max != null && (pool.createdCount | 0) >= max) {
        if (overflow === "drop") {
          return null;
        } else if (overflow === "reuseOldest" && pool.active.length > 0) {
          // Reuse and return oldest active instance
          obj = pool.active.shift();
          try {
            if (obj?.parent) obj.parent.remove(obj);
            obj.visible = true;
          } catch {}
        } else {
          // overflow === "create" (default) -> continue to create a new one
          obj = ArchetypeRegistry.create(this.game, name, { overrides, traits });
          if (obj) pool.createdCount = (pool.createdCount | 0) + 1;
        }
      } else {
        obj = ArchetypeRegistry.create(this.game, name, { overrides, traits });
        if (obj) pool.createdCount = (pool.createdCount | 0) + 1;
      }
    }
    if (!obj) return null;
    try {
      obj.visible = true;
      obj.userData = obj.userData || {};
      obj.userData.__archetype = name;
      obj.userData.__traits = traits || {};
      obj.userData.__overrides = overrides || {};
    } catch {}
    // Track as active
    pool.active.push(obj);
    return obj;
  }
  release(obj) {
    if (!obj) return;
    const name = obj?.userData?.__archetype || "unknown";
    const pool = this._getPool(name);
    try {
      if (obj.parent) obj.parent.remove(obj);
      obj.visible = false;
    } catch {}
    // Remove from active list if present
    try {
      const idx = pool.active.indexOf(obj);
      if (idx >= 0) pool.active.splice(idx, 1);
    } catch {}
    pool.idle.push(obj);
  }
}

export async function createApp() {
  const canvas = document.getElementById("app-canvas");
  const rendererCore = new RendererCore(canvas);
  const budget = new BudgetTracker();
  const physics = new PhysicsWorld(rendererCore.scene, { enableGroundPlane: true, groundY: 0, debug: false });

  const playerRig = new Object3D();
  playerRig.name = "PlayerRig";
  const cam = rendererCore.camera;
  const eyeHeight = 1.6;
  playerRig.position.set(cam.position.x, Math.max(0, cam.position.y - eyeHeight), cam.position.z);
  rendererCore.scene.add(playerRig);
  playerRig.add(cam);
  cam.position.set(0, eyeHeight, 0);

  const updaters = [];
  app = {
    rendererCore,
    budget,
    physics,
    loading: new LoadingScreen(),
    profiler: Debug.profiler,
    errors: Debug.errors,
    toggles: Debug.toggles,
    componentInstances: [],
    updateLists: { input: [], fixed: [], update: [], late: [] },
    pool: null,
    addComponent(c) {
      if (!c) return;
      this.componentInstances.push(c);
      if (typeof c.Input === 'function') this.updateLists.input.push(c);
      if (typeof c.FixedUpdate === 'function') this.updateLists.fixed.push(c);
      if (typeof c.Update === 'function') this.updateLists.update.push(c);
      if (typeof c.LateUpdate === 'function') this.updateLists.late.push(c);
    },
    removeComponent(c) {
      if (!c) return;
      const idx = this.componentInstances.indexOf(c);
      if (idx >= 0) this.componentInstances.splice(idx, 1);
      const removeFrom = (list) => {
        const i = list.indexOf(c);
        if (i >= 0) list.splice(i, 1);
      };
      removeFrom(this.updateLists.input);
      removeFrom(this.updateLists.fixed);
      removeFrom(this.updateLists.update);
      removeFrom(this.updateLists.late);
    },
    onUpdate(fn) { if (typeof fn === "function") updaters.push(fn); },
    setWireframe(enabled) {
      rendererCore.scene.traverse((o) => {
        if (o.isMesh && o.material) {
          if (Array.isArray(o.material)) o.material.forEach(m => m.wireframe = enabled);
          else o.material.wireframe = enabled;
        }
      });
    },
    // Delegate global render toggles to the renderer
    setDoubleSided(enabled) { rendererCore.setDoubleSided?.(enabled); },
    _runUpdaters(dt) { for (let i = 0; i < updaters.length; i++) updaters[i](dt, app); }
  };
  window.__game = app;
  initDebugOverlay(app);

  // Input + Events
  app.eventSystem = new EventSystem({ fixedTimestep: 1 / 60 });
  app.input = new Input(canvas);
  
  // Network (choose implementation)
  const params = new URLSearchParams(window.location.search);
  if (params.has('key') || params.has('id') || params.has('multisynq')) {
    app.network = new MultisynqNetworkSystem(app);
  } else {
    app.network = new NetworkSystem(app);
  }

  // UI System
  app.ui = new UISystem(app);
  try { app.ui.init(); } catch (e) { console.warn("UISystem init failed:", e); }

  // Pooling
  app.pool = new PoolManager(app);

  // No default Player; rely on GLTF-authored Player component
  // Initialize generic Statistic + StatisticBar
  try {
    const stat = new Statistic({ game: app, object: null, options: { name: 'health', min: 0, max: 100, current: 100, regenPerSec: 0 }, propName: "Statistic" });
    stat.Initialize?.();
    app.addComponent(stat);
    const bar = new StatisticBar({ game: app, object: null, options: { name: 'health' }, propName: "StatisticBar" });
    await Promise.resolve(bar.Initialize?.());
    app.addComponent(bar);
  } catch (e) {
    console.warn("Statistic initialization failed:", e);
  }

  // Phase dispatchers
  const runPhase = (method, dt) => {
    let list;
    if (method === 'Input') list = app.updateLists.input;
    else if (method === 'FixedUpdate') list = app.updateLists.fixed;
    else if (method === 'Update') list = app.updateLists.update;
    else if (method === 'LateUpdate') list = app.updateLists.late;
    else list = app.componentInstances;

    const safeList = [...(list || [])];
    for (let i = 0; i < safeList.length; i++) {
      const c = safeList[i];
      // Skip if component was destroyed (game ref cleared)
      if (!c || !c.game) continue;
      const fn = c[method];
      if (typeof fn === "function") {
        try { fn.call(c, dt, app); } catch (e) { console.error(`${method} error:`, e); }
      }
    }
  };
  app.eventSystem.on('input', (dt) => {
    // Poll gamepad via Input helper inside consumers; still run component phase
    runPhase('Input', dt);
  });
  app.eventSystem.on('fixed', (dt) => {
    runPhase('FixedUpdate', dt);
  });
  app.eventSystem.on('update', (dt) => {
    runPhase('Update', dt);
    app.network.update(dt);
    app._runUpdaters(dt);
    try { app.ui?.update(dt); } catch {}
  });
  app.eventSystem.on('late', (dt) => {
    runPhase('LateUpdate', dt);
  });
}

function animate() {
  const now = performance.now();
  const elapsedSinceStep = now - lastStepTime;
  if (elapsedSinceStep >= frameIntervalMs) {
    const cappedMs = Math.min(elapsedSinceStep, frameIntervalMs * 2);
    app.profiler.beginFrame();
    app.budget.resetFrame();
    // Run event phases including fixed/update/late
    app.eventSystem.tick(app, cappedMs / 1000);
    // Step physics world
    try { app.physics.step(cappedMs / 1000); } catch {}
    app.rendererCore.update(cappedMs / 1000);
    app.rendererCore.render();
    const tris = app.rendererCore.getTriangleCount();
    app.budget.addTriangles(tris);

    const messages = [];
    if (!app.budget.withinTriangleBudget()) messages.push("Triangle budget exceeded");
    if (!app.budget.withinParticleBudget()) messages.push("Particle budget exceeded");
    if (!app.budget.withinUITilesBudget()) messages.push("UI tile budget exceeded");
    if (!app.budget.withinRAMBudget()) messages.push("RAM budget exceeded");
    if (Debug.toggles.budgetOverlay && messages.length) app.errors.show(messages); else app.errors.hide();

    app.profiler.endFrame({
      tris,
      tiles: app.budget.frameTilesUsed,
      ramBytes: app.budget.cumulativeBytes,
      voices: app.budget.frameVoices,
      particles: app.budget.frameParticles,
    });
    lastStepTime = now;
  }
  requestAnimationFrame(animate);
}

export async function start() {
  await loadEngineConfig();
  frameIntervalMs = 1000 / (config.targetFPS || 60);
  const { width, height } = getInternalResolution();
  const canvas = document.getElementById("app-canvas");
  if (canvas) {
    canvas.width = width;
    canvas.height = height;
  }
  createApp();
  const params = new URLSearchParams(window.location.search);
  const gltfUrlParam = params.get("gltf");
  const sceneParam = params.get("scene") || null;
  const lanParam = params.get("lan");
  const multisynqParam = params.has("multisynq") || params.has("key");

  // Initialize settings and main menu systems
  const settingsMenu = new SettingsMenu(app);
  await settingsMenu.init();
  const mainMenu = new MainMenu(app, settingsMenu);
  await mainMenu.init();

  if (multisynqParam) {
    // Auto-connect Multisynq (args handled inside connect)
    app.network.connect();
  } else if (lanParam) {
    // Auto-connect LAN
    app.network.connect(lanParam === 'true' ? undefined : lanParam);
  }

  // If no explicit scene/glTF requested, show the main menu and return to animation loop
  if (!gltfUrlParam && !sceneParam) {
    try { mainMenu.show(); } catch {}
    animate();
    return;
  }

  // If a scene ID is provided, try to read manifest entry (optional)
  let entry = null;
  if (sceneParam) {
    try {
      const scenesIndex = await loadJSON("build/assets/config/scene-manifest.json");
      entry = (scenesIndex.scenes || []).find(s => s.id === sceneParam) || null;
    } catch {}
  }
  if (gltfUrlParam) {
    try {
      app.loading.show("Loading GLTF...");
      let loadUrl = gltfUrlParam;
      if (gltfUrlParam.startsWith('inline:')) {
        const key = gltfUrlParam.substring('inline:'.length);
        let b64 = null;
        try { b64 = sessionStorage.getItem(key); } catch {}
        if (!b64) {
          try { b64 = localStorage.getItem(key); } catch {}
        }
        if (!b64) {
          console.warn('inline glb not found, falling back to default scene');
          loadUrl = null;
        } else {
          const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
          const blob = new Blob([bytes], { type: 'model/gltf-binary' });
          loadUrl = URL.createObjectURL(blob);
        }
      } else {
        loadUrl = new URL(gltfUrlParam, document.baseURI).toString();
      }
      if (loadUrl) {
        // Treat GLTF as a scene: use SceneLoader to get userData components and id-mappings
        const loader = new SceneLoader(app);
        let baseUrlForDef = undefined;
        try { baseUrlForDef = new URL('.', loadUrl).href; } catch { baseUrlForDef = new URL("build/assets/", document.baseURI).href; }
        const def = { assets: [ { type: "gltf", url: loadUrl } ] };
        await loader.loadFromDefinition(def, baseUrlForDef);
        try { ensurePoolSingleton(app)?.scanAndPrewarm?.(); } catch {}
        app.loading.setProgress(1);
        app.loading.hide();
        animate();
        return;
      }
    } catch (e) {
      console.error("Failed to load gltf param:", e);
      app.errors.show([`Failed to load ${gltfUrlParam}`]);
      app.loading.hide();
    }
  } else if (!entry || !entry.module) {
    // Fallback: load default GLTF via dynamic import of asset URL
    try {
      app.loading.show("Loading scene...");
      const loader = new SceneLoader(app);
      const mod = await import('../assets/models/default-scene.glb');
      const url = (mod && mod.default) || mod;
      const def = { assets: [{ type: "gltf", url, physics: { collider: "convex", mergeChildren: true, visible: false } }] };
      await loader.loadFromDefinition(def, new URL('.', url).href);
      try { ensurePoolSingleton(app)?.scanAndPrewarm?.(); } catch {}
      app.loading.setProgress(1);
      app.loading.hide();
    } catch (e) {
      console.error("Failed to load default GLTF scene:", e);
      app.errors.show(["Failed to load default scene"]);
      app.loading.hide();
    }
  } else {
    try {
      app.loading.show("Loading scene...");
      const loader = new SceneLoader(app);
      const baseUrl = new URL("build/assets/", document.baseURI).href;
      const def = entry && entry.assets ? entry : {
        assets: [
          {
            type: "gltf",
            url: "models/default-scene.glb",
            physics: { collider: "convex", mergeChildren: true, visible: false }
          }
        ]
      };
      await loader.loadFromDefinition(def, baseUrl);
      try { ensurePoolSingleton(app)?.scanAndPrewarm?.(); } catch {}
      app.loading.setProgress(1);
      app.loading.hide();
    } catch (e) {
      console.error("Failed to load default GLTF scene:", e);
      app.errors.show(["Failed to load default scene"]);
      app.loading.hide();
    }
  }
  animate();
}

// Auto-start when bundled for the browser (single run guard)
if (typeof window !== "undefined") {
  if (!window.__engineStarted) {
    window.__engineStarted = true;
    start();
  }
}
