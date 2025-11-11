'use strict';
// Scene wrapper that represents a loaded scene instance.
// It proxies core systems from the underlying app and owns scene-scoped data.

export class Scene {
  constructor(app) {
    this.app = app;

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
}
