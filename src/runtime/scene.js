'use strict';
// Scene wrapper that represents a loaded scene instance.
// It proxies core systems from the underlying app and owns scene-scoped data.
// Now extends Component so it can also be authored/instantiated via GLTF userData.
import { Component, ComponentRegistry } from "./component.js";
import { DirectionalLight, AmbientLight } from "three";
import { createSkybox } from "./skybox.js";

export class Scene extends Component {
  static getDefaultParams() {
    return {
      lighting: {
        directional: {
          enabled: true,
          color: 0xffffff,
          intensity: 0.8,
          position: [1, 1, 1],
        },
        ambient: {
          enabled: true,
          color: 0x404040,
          intensity: 0.5,
        },
      },
      skybox: {
        enabled: true,
        size: 200,
        topColor: 0x6fb6ff,
        bottomColor: 0xded7b0,
        offset: 0.0,
        exponent: 0.6,
        followCamera: true,
      },
    };
  }
  constructor(appOrCtx) {
    // Support two construction modes:
    // 1) Legacy wrapper mode: new Scene(app)
    // 2) Component mode (via registry): new Scene({ game, object, options, propName })
    const isComponentCtx = appOrCtx && typeof appOrCtx === "object" && ("game" in appOrCtx || "object" in appOrCtx || "options" in appOrCtx);
    if (isComponentCtx) {
      super(appOrCtx);
      this.app = this.game;
      this._wireToApp(this.app);
    } else {
      super({ game: appOrCtx, object: null, options: undefined, propName: "Scene" });
      this.app = appOrCtx;
      this._wireToApp(this.app);
    }
  }

  static getDefaultParams() {
    // Extend with scene component authoring defaults as needed
    return {};
  }

  _wireToApp(app) {
    if (!app) return;
    // Proxy core systems for compatibility
    this.rendererCore = app.rendererCore;
    this.physics = app.physics;
    this.budget = app.budget;
    this.fps = app.fps;
    this.profiler = app.profiler;
    this.errors = app.errors;
    this.toggles = app.toggles;
    this.onUpdate = (...args) => app.onUpdate(...args);
    this.setWireframe = (...args) => app.setWireframe(...args);
    this._runUpdaters = (...args) => app._runUpdaters?.(...args);

    // Scene-scoped state
    this.sceneMarkers = app.sceneMarkers || {};
    this.componentInstances = app.componentInstances || [];
    this.sceneVolumes = app.sceneVolumes || [];
    this.sceneProperties = app.sceneProperties || {};
    this.sceneIds = app.sceneIds || {};

    // Mirror back to app for back-compat
    app.sceneMarkers = this.sceneMarkers;
    app.componentInstances = this.componentInstances;
    app.sceneVolumes = this.sceneVolumes;
    app.sceneProperties = this.sceneProperties;
    app.sceneIds = this.sceneIds;
  }

  // When authored as a component, allow Initialize to forward to optional init()
  Initialize() {
    if (typeof this.init === "function") {
      this.init();
    }

    // Include default scene initialization
    const { scene, camera } = this.rendererCore || {};
    if (scene && camera) {
      const opts = this.options || {};
      const lighting = opts.lighting || {};
      const dir = lighting.directional || {};
      const amb = lighting.ambient || {};
      if (dir.enabled !== false) {
        const d = new DirectionalLight(dir.color ?? 0xffffff, dir.intensity ?? 0.8);
        const p = Array.isArray(dir.position) && dir.position.length === 3 ? dir.position : [1, 1, 1];
        d.position.set(p[0], p[1], p[2]);
        scene.add(d);
      }
      if (amb.enabled !== false) {
        scene.add(new AmbientLight(amb.color ?? 0x404040, amb.intensity ?? 0.5));
      }

      const skyOpts = opts.skybox || {};
      if (skyOpts.enabled !== false) {
        const sky = createSkybox(camera, {
          size: skyOpts.size,
          topColor: skyOpts.topColor,
          bottomColor: skyOpts.bottomColor,
          offset: skyOpts.offset,
          exponent: skyOpts.exponent,
        });
        scene.add(sky);
        if (skyOpts.followCamera !== false) {
          this.onUpdate?.(() => sky.position.copy(camera.position));
        }
      }
    }
  }
}

// Register as a component so GLTF userData can reference it (e.g., comp.Scene: true)
ComponentRegistry.register("Scene", Scene);
ComponentRegistry.register("scene", Scene);
