import { RendererCore } from "./renderer.js";
import { PhysicsWorld } from "./physics.js";
import { SceneLoader } from "./assetLoader.js";
import { BudgetTracker, initDebugOverlay, Debug } from "./debug.js";
import { config, getInternalResolution } from "./engine.js";
import * as THREE from "https://unpkg.com/three@0.161.0/build/three.module.js";
import { loadJSON } from "./io.js";
// Register built-in components
import "./default-assets/feature-showcase.js";
import { FPSController } from "./fpsController.js";

let frameIntervalMs = 1000 / 60;
let lastStepTime = performance.now();
let app;

function createApp() {
  const canvas = document.getElementById("app-canvas");
  const rendererCore = new RendererCore(canvas);
  const budget = new BudgetTracker();
  const physics = new PhysicsWorld(rendererCore.scene, { enableGroundPlane: true, groundY: 0, debug: false });
  const fps = new FPSController(canvas, rendererCore.camera);
  fps.setPhysics(physics);

  const playerRig = new THREE.Object3D();
  playerRig.name = "PlayerRig";
  const cam = rendererCore.camera;
  const eyeHeight = fps.eyeHeight;
  playerRig.position.set(cam.position.x, Math.max(0, cam.position.y - eyeHeight), cam.position.z);
  rendererCore.scene.add(playerRig);
  playerRig.add(cam);
  cam.position.set(0, eyeHeight, 0);
  fps.setRig(playerRig);

  const updaters = [];
  app = {
    rendererCore,
    budget,
    physics,
    fps,
    profiler: Debug.profiler,
    errors: Debug.errors,
    toggles: Debug.toggles,
    onUpdate(fn) { if (typeof fn === "function") updaters.push(fn); },
    setWireframe(enabled) {
      rendererCore.scene.traverse((o) => {
        if (o.isMesh && o.material) {
          if (Array.isArray(o.material)) o.material.forEach(m => m.wireframe = enabled);
          else o.material.wireframe = enabled;
        }
      });
    },
    _runUpdaters(dt) { for (let i = 0; i < updaters.length; i++) updaters[i](dt, app); }
  };
  window.__game = app;
  initDebugOverlay(app);
}

function animate() {
  const now = performance.now();
  const elapsedSinceStep = now - lastStepTime;
  if (elapsedSinceStep >= frameIntervalMs) {
    const cappedMs = Math.min(elapsedSinceStep, frameIntervalMs * 2);
    app.profiler.beginFrame();
    app.budget.resetFrame();
    app.fps.update(cappedMs / 1000);
    app._runUpdaters(cappedMs / 1000);
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

async function start() {
  frameIntervalMs = 1000 / (config.targetFPS || 60);
  const { width, height } = getInternalResolution();
  const canvas = document.getElementById("app-canvas");
  if (canvas) {
    canvas.width = width;
    canvas.height = height;
  }
  createApp();
  // Update all component instances once per frame
  app.onUpdate((dt) => {
    const list = app.componentInstances || [];
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c && typeof c.Update === "function") c.Update(dt);
    }
  });
  const sceneParam = new URLSearchParams(window.location.search).get("scene") || "showcase";
  const scenesIndex = await loadJSON("config/scene-manifest.json");
  let entry = (scenesIndex.scenes || []).find(s => s.id === sceneParam) || (scenesIndex.scenes || [])[0];
  if (!entry || !entry.module) {
    // Fallback: built-in default scene module
    const moduleUrl = new URL("/src/engine/default-assets/default-scene.js", document.baseURI).href;
    try {
      const mod = await import(moduleUrl);
      const def = mod.default || mod;
      const baseUrl = moduleUrl.replace(/\/[^\/]*$/, "");
      const loader = new SceneLoader(app);
      await loader.loadFromDefinition(def, baseUrl);
      positionPlayerFromMarkers();
    } catch (e) {
      console.error("Failed to load default scene module:", e);
      app.errors.show(["Failed to load default scene"]);
    }
  } else {
    const moduleUrl = new URL(`scenes/${entry.module}`, document.baseURI).href;
    try {
      const mod = await import(moduleUrl);
      const def = mod.default || mod;
      const baseUrl = moduleUrl.replace(/\/[^\/]*$/, "");
      const loader = new SceneLoader(app);
      await loader.loadFromDefinition(def, baseUrl);
      positionPlayerFromMarkers();
    } catch (e) {
      console.error("Failed to load scene module:", e);
      app.errors.show([`Failed to load ${moduleUrl}`]);
    }
  }
  animate();
}

start();

function positionPlayerFromMarkers() {
  // Prefer explicit P1_spawn, then any P1_*; fallback to ID0_showcase as anchor
  const markers = app.sceneMarkers || {};
  let target = null;
  let yaw = null;
  let pitch = null;
  if (markers.P1_spawn) target = markers.P1_spawn.position;
  if (markers.P1_spawn?.yaw !== undefined) yaw = markers.P1_spawn.yaw;
  if (markers.P1_spawn?.pitch !== undefined) pitch = markers.P1_spawn.pitch;
  if (!target) {
    const p1keys = Object.keys(markers).filter(k => k.startsWith("P1_"));
    if (p1keys.length) {
      target = markers[p1keys[0]].position;
      if (markers[p1keys[0]].yaw !== undefined) yaw = markers[p1keys[0]].yaw;
      if (markers[p1keys[0]].pitch !== undefined) pitch = markers[p1keys[0]].pitch;
    }
  }
  if (!target && markers.ID0_showcase) target = markers.ID0_showcase.position;
  if (!target) return;
  const rig = app.rendererCore.camera.parent; // playerRig holds camera as child
  if (rig) {
    rig.position.set(target.x, Math.max(0, target.y), target.z);
  }
  // Sync FPS controller internal state and facing
  if (app.fps) {
    app.fps.position.set(target.x, Math.max(0, target.y), target.z);
    if (typeof yaw === "number") {
      app.fps.yaw = yaw;
      app.fps.targetYaw = yaw;
    }
    if (typeof pitch === "number") {
      app.fps.pitch = pitch;
      app.fps.targetPitch = pitch;
    }
  }
}
