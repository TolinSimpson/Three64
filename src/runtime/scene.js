'use strict';
// Scene wrapper that represents a loaded scene instance.
// It proxies core systems from the underlying app and owns scene-scoped data.
// Now extends Component so it can also be authored/instantiated via GLTF userData.
import { Component, ComponentRegistry } from "./component.js";
import { DirectionalLight, AmbientLight } from "three";
import { createSkybox } from "./skybox.js";

export class Scene extends Component {
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
      const light = new DirectionalLight(0xffffff, 0.8);
      light.position.set(1, 1, 1);
      scene.add(light);
      scene.add(new AmbientLight(0x404040, 0.5));

      const sky = createSkybox(camera);
      scene.add(sky);
      this.onUpdate?.(() => sky.position.copy(camera.position));
    }
  }
}

// Register as a component so GLTF userData can reference it (e.g., comp.Scene: true)
ComponentRegistry.register("Scene", Scene);
ComponentRegistry.register("scene", Scene);
