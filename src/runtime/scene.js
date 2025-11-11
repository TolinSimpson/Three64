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

  static getParamDescriptions() {
    return [
      { key: 'lighting.directional.enabled', label: 'Dir Light Enabled', type: 'boolean', description: 'Enable the primary directional light.' },
      { key: 'lighting.directional.color', label: 'Dir Light Color', type: 'color', description: 'Directional light color (hex).' },
      { key: 'lighting.directional.intensity', label: 'Dir Light Intensity', type: 'number', min: 0, max: 5, step: 0.05, description: 'Directional light intensity.' },
      { key: 'lighting.directional.position', label: 'Dir Light Position [x,y,z]', type: 'vec3', description: 'Directional light position in world units.' },
      { key: 'lighting.ambient.enabled', label: 'Ambient Enabled', type: 'boolean', description: 'Enable ambient light for base illumination.' },
      { key: 'lighting.ambient.color', label: 'Ambient Color', type: 'color', description: 'Ambient light color (hex).' },
      { key: 'lighting.ambient.intensity', label: 'Ambient Intensity', type: 'number', min: 0, max: 2, step: 0.05, description: 'Ambient light intensity.' },
      { key: 'skybox.enabled', label: 'Skybox Enabled', type: 'boolean', description: 'Render a procedural gradient skybox.' },
      { key: 'skybox.size', label: 'Skybox Size', type: 'number', min: 10, max: 2000, step: 10, description: 'Skybox cube size.' },
      { key: 'skybox.topColor', label: 'Sky Top Color', type: 'color', description: 'Top hemisphere color (hex).' },
      { key: 'skybox.bottomColor', label: 'Sky Bottom Color', type: 'color', description: 'Bottom hemisphere color (hex).' },
      { key: 'skybox.offset', label: 'Sky Vertical Offset', type: 'number', min: -2, max: 2, step: 0.01, description: 'Vertical gradient offset.' },
      { key: 'skybox.exponent', label: 'Sky Exponent', type: 'number', min: 0.01, max: 3, step: 0.01, description: 'Gradient exponent shaping the curve.' },
      { key: 'skybox.followCamera', label: 'Sky Follow Camera', type: 'boolean', description: 'Keep sky centered on the camera.' },
    ];
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
