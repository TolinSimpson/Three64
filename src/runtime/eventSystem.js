'use strict';
import { loadJSON } from "./io.js";

export class EventSystem {
  constructor({ fixedTimestep = 1 / 60, dom = null } = {}) {
    this.fixedTimestep = fixedTimestep;
    this._accum = 0;
    this.handlers = {
      input: [],
      fixed: [],
      update: [],
      late: [],
    };
    // Named gameplay events (pub/sub)
    this._events = new Map();
  }
  on(phase, fn) {
    if (this.handlers[phase] && typeof fn === 'function') {
      this.handlers[phase].push(fn);
    }
  }
  off(phase, fn) {
    if (this.handlers[phase] && typeof fn === 'function') {
      const idx = this.handlers[phase].indexOf(fn);
      if (idx >= 0) this.handlers[phase].splice(idx, 1);
    }
  }
  tick(app, frameDt) {
    const dt = Math.max(0, Number(frameDt) || 0);
    // Input phase (poll devices, queue actions)
    this._emit('input', dt, app);
    // Fixed updates (deterministic simulation; physics/controllers)
    this._accum += dt;
    const step = this.fixedTimestep;
    let guard = 0;
    while (this._accum >= step && guard < 8) {
      this._emit('fixed', step, app);
      this._accum -= step;
      guard++;
    }
    // Variable update (smoothing, VFX, non-deterministic)
    this._emit('update', dt, app);
    // Late update (sync transforms just before render)
    this._emit('late', dt, app);
  }
  _emit(phase, dt, app) {
    const list = this.handlers[phase];
    if (!list) return;
    // Iterate over a copy to allow handlers to unregister themselves during the loop without breaking iteration
    const safeList = [...list];
    for (let i = 0; i < safeList.length; i++) {
      try {
        safeList[i](dt, app);
      } catch (e) {
        console.error(`EventSystem ${phase} handler error:`, e);
      }
    }
  }

  // ---------------------------
  // Gameplay event pub/sub
  // ---------------------------
  onEvent(name, fn) {
    if (!name || typeof fn !== 'function') return;
    const key = String(name);
    if (!this._events.has(key)) this._events.set(key, []);
    this._events.get(key).push(fn);
  }
  offEvent(name, fn) {
    const key = String(name || '');
    const list = this._events.get(key);
    if (!list) return;
    if (!fn) { this._events.delete(key); return; }
    const idx = list.indexOf(fn);
    if (idx >= 0) list.splice(idx, 1);
  }
  emit(name, payload) {
    const key = String(name || '');
    const list = this._events.get(key) || [];
    for (let i = 0; i < list.length; i++) {
      try { list[i](payload); } catch (e) { console.error(`EventSystem emit '${key}' error:`, e); }
    }
  }
}
