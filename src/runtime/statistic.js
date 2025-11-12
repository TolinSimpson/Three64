'use strict';
import { Component, ComponentRegistry } from "./component.js";

export class Statistic extends Component {
  static getDefaultParams() {
    return {
      name: 'health',
      min: 0,
      max: 100,
      current: 100,
      regenPerSec: 0,     // positive for regen, negative for drain
      clamp: true,
      easing: 'linear',   // default easing for over-time deltas
    };
  }

  Initialize() {
    this._activeTween = null; // { remaining, total, delta, start, easing }
    this._lastEmitValue = undefined;
    this._unsubs = [];
    // Subscribe to UI intents if UISystem exists
    const ui = this.game?.ui;
    const name = this._getName();
    if (ui) {
      this._unsubs.push(ui.on(`stat:${name}:add`, (amount) => {
        const n = Number(amount) || 0;
        if (n) this.add(n);
      }));
      this._unsubs.push(ui.on(`stat:${name}:damage`, (amount) => {
        const n = Number(amount) || 0;
        if (n) this.add(-Math.abs(n));
      }));
      this._unsubs.push(ui.on(`stat:${name}:heal`, (amount) => {
        const n = Number(amount) || 0;
        if (n) this.add(Math.abs(n));
      }));
      this._unsubs.push(ui.on(`stat:${name}:set`, (value) => {
        const v = Number(value);
        if (Number.isFinite(v)) this.setCurrent(v);
      }));
      this._unsubs.push(ui.on(`stat:${name}:addOverTime`, (payload) => {
        const p = payload || {};
        const delta = Number(p.delta) || 0;
        const duration = Math.max(0, Number(p.duration) || 0);
        const easing = p.easing || this.options?.easing || 'linear';
        if (duration > 0 && delta) this.applyDeltaOverTime(delta, duration, easing);
      }));
    }
    // Emit initial
    this._emitChanged();
  }

  Dispose() {
    if (Array.isArray(this._unsubs)) {
      for (const fn of this._unsubs) { try { fn(); } catch {} }
    }
    this._unsubs = null;
  }

  Update(dt) {
    const o = this.options || {};
    // Passive regen/drain
    const regen = Number(o.regenPerSec) || 0;
    if (regen) {
      this._applyInstant(regen * dt);
    }
    // Tweened delta
    if (this._activeTween && this._activeTween.remaining > 0) {
      const t = this._activeTween;
      const step = Math.min(t.remaining, dt);
      const prevElapsed = t.total - t.remaining;
      const newElapsed = prevElapsed + step;
      const easedPrev = t.easingFn(prevElapsed / t.total);
      const easedNow = t.easingFn(newElapsed / t.total);
      const deltaThisStep = (easedNow - easedPrev) * t.delta;
      this._applyInstant(deltaThisStep);
      t.remaining -= step;
      if (t.remaining <= 1e-6) {
        this._activeTween = null;
      }
    }
    // Emit only when changed
    this._emitChanged();
  }

  // Public API
  setCurrent(value) {
    const v = Number(value);
    if (!Number.isFinite(v)) return;
    const clamped = this._clamp(v);
    this.options.current = clamped;
    this._activeTween = null;
  }

  add(delta) {
    this._applyInstant(Number(delta) || 0);
  }

  applyDeltaOverTime(delta, durationSec, easing = 'linear') {
    const d = Number(delta) || 0;
    const total = Math.max(0.0001, Number(durationSec) || 0);
    const easingFn = getEasing(easing);
    this._activeTween = {
      remaining: total,
      total,
      delta: d,
      start: this.options.current,
      easing,
      easingFn,
    };
  }

  setMax(maxValue, keepRatio = false) {
    const oldMax = Number(this.options.max) || 1;
    const oldCur = Number(this.options.current) || 0;
    let newMax = Number(maxValue);
    if (!Number.isFinite(newMax)) return;
    if (newMax < (Number(this.options.min) || 0)) newMax = Number(this.options.min) || 0;
    this.options.max = newMax;
    if (keepRatio && oldMax > 0) {
      const ratio = Math.max(0, Math.min(1, oldCur / oldMax));
      this.options.current = this._clamp(ratio * newMax);
    } else {
      this.options.current = this._clamp(oldCur);
    }
  }

  setMin(minValue) {
    let newMin = Number(minValue);
    if (!Number.isFinite(newMin)) return;
    this.options.min = newMin;
    if (this.options.max < newMin) this.options.max = newMin;
    this.options.current = this._clamp(this.options.current);
  }

  // Helpers
  _applyInstant(delta) {
    if (!delta) return;
    const cur = Number(this.options.current) || 0;
    this.options.current = this._clamp(cur + delta);
  }

  _clamp(v) {
    if (this.options?.clamp === false) return v;
    const min = Number(this.options.min) || 0;
    const max = Number(this.options.max);
    const hi = Number.isFinite(max) ? max : v;
    return Math.max(min, Math.min(hi, v));
  }

  _getName() {
    const n = (this.options?.name || this.propName || 'stat').toString();
    return n.replace(/\s+/g, '').toLowerCase();
  }

  _emitChanged() {
    const name = this._getName();
    const cur = Number(this.options.current) || 0;
    const min = Number(this.options.min) || 0;
    const max = Number(this.options.max) || 0;
    const key = `${cur}|${min}|${max}`;
    if (this._lastEmitValue === key) return;
    this._lastEmitValue = key;
    this.game?.ui?.emit(`stat:${name}:changed`, { name, current: cur, min, max });
  }
}

function getEasing(name) {
  const map = {
    linear: (t) => t,
    easeInQuad: (t) => t * t,
    easeOutQuad: (t) => t * (2 - t),
    easeInOutCubic: (t) => (t < 0.5) ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  };
  return map[name] || map.linear;
}

ComponentRegistry.register('Statistic', Statistic);


