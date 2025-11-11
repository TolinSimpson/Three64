'use strict';
import { RendererCore } from "./renderer.js";
import { PhysicsWorld } from "./physics.js";
import { SceneLoader } from "./assetLoader.js";
import { BudgetTracker, initDebugOverlay, Debug } from "./debug.js";
import { Object3D } from "three";
import { loadJSON } from "./io.js";
import LoadingScreen from "./loadingScreen.js";
import { EventSystem } from "./eventSystem.js";
import { Player } from "./player.js";
import "./navmesh.js";
export const config = {
  expansionPak: true,
  targetFPS: 30,
  renderer: {
    internalWidthBase: 320,
    internalHeightBase: 240,
    internalWidthExpansion: 640,
    internalHeightExpansion: 480,
    // If true, force all imported materials to render double-sided by default
    defaultDoubleSided: false,
  },
  budgets: {
    trisPerFrame: 5333,
    ramBytesBase: 4 * 1024 * 1024,
    ramBytesExpansion: 8 * 1024 * 1024,
    tmemBytes: 4096,
    maxBonesPerMesh: 40,
    audio: {
      maxVoices: 24,
      maxRateHz: 44100,
    },
    particles: {
      maxActiveBase: 256,
      maxActiveExpansion: 512,
      trisPerQuad: 2,
    },
    ui: {
      allowedFormats: ["PNG8", "PNG_RGBA_SMALL"],
      maxSpriteSizeBase: 64,
      maxSpriteSizeExpansion: 96,
      maxAtlasSizeBase: { w: 256, h: 256 },
      maxAtlasSizeExpansion: { w: 512, h: 256 },
      perFrameTilesBase: 8,
      perFrameTilesExpansion: 12,
      requireTileMultiple: 8,
    },
  },
  devMode: true,
};

// EngineLimits removed; prefer reading from config directly

export function tmemBytesForTexture({ width, height, bpp, paletteBytes = 0 }) {
  return (width * height * bpp) / 8 + paletteBytes;
}

export function fitsInTMEM({ width, height, bpp, paletteBytes = 0 }) {
  return tmemBytesForTexture({ width, height, bpp, paletteBytes }) <= (config.budgets.tmemBytes || 0);
}

export function getInternalResolution() {
  const w = config.expansionPak ? config.renderer.internalWidthExpansion : config.renderer.internalWidthBase;
  const h = config.expansionPak ? config.renderer.internalHeightExpansion : config.renderer.internalHeightBase;
  return { width: w, height: h };
}

export function uiSpriteWithinBudget({ width, height, format, paletteBytes = 0 }) {
  const ui = config.budgets.ui;
  const maxSprite = config.expansionPak ? ui.maxSpriteSizeExpansion : ui.maxSpriteSizeBase;
  if (width > maxSprite || height > maxSprite) return false;
  if (!ui.allowedFormats?.includes(format)) return false;
  if (format === 'PNG_RGBA_SMALL') {
    if (width > 32 || height > 32) return false;
    return fitsInTMEM({ width, height, bpp: 32, paletteBytes: 0 });
  }
  const bpp = 8;
  return fitsInTMEM({ width, height, bpp, paletteBytes });
}

export function uiAtlasWithinBudget({ width, height }) {
  const ui = config.budgets.ui;
  const limit = config.expansionPak ? ui.maxAtlasSizeExpansion : ui.maxAtlasSizeBase;
  return width <= (limit?.w || 0) && height <= (limit?.h || 0);
}

// -----------------------------
// Runtime bootstrap
// -----------------------------
let frameIntervalMs = 1000 / 60;
let lastStepTime = performance.now();
let app;

export function createApp() {
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
  app.eventSystem = new EventSystem({ fixedTimestep: 1 / 60, dom: canvas });

  // Create player component bound to the camera rig
  const player = new Player({ game: app, object: playerRig, options: {}, propName: "Player" });
  try { player.Initialize?.(); } catch (e) { console.error("Player.Initialize failed:", e); }
  app.componentInstances.push(player);

  // Phase dispatchers
  const runPhase = (method, dt) => {
    const list = app.componentInstances || [];
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (!c) continue;
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
    app._runUpdaters(dt);
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
  const sceneParam = params.get("scene") || "showcase";
  const scenesIndex = await loadJSON("build/assets/config/scene-manifest.json");
  let entry = (scenesIndex.scenes || []).find(s => s.id === sceneParam) || (scenesIndex.scenes || [])[0];
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
      const def = {
        assets: [
          {
            type: "gltf",
            url: "models/default-scene.glb",
            physics: { collider: "convex", mergeChildren: true, visible: false }
          }
        ]
      };
      await loader.loadFromDefinition(def, baseUrl);
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
