'use strict';
import { Component, ComponentRegistry } from "./component.js";
import { Statistic } from "./statistic.js";

/**
 * Timer Component
 *
 * A purpose-built time tracker that internally creates and manages a co-located
 * Statistic so the value is readable/syncable/persistable through the same system.
 * Adds start/stop/pause/reset semantics, threshold events, formatted output,
 * and completion detection with loop support.
 */
export class Timer extends Component {
  static getDefaultParams() {
    return {
      name: 'timer',
      duration: 60,
      direction: 'down',    // 'down' | 'up'
      autoStart: false,
      loop: false,
      thresholds: [],        // [{ value: 30, event: "timer:myTimer:30sec" }, ...]
      scope: 'object',       // forwarded to internal Statistic
      sync: 'none',          // forwarded to internal Statistic
      persist: false,         // forwarded to internal Statistic
    };
  }

  static getParamDescriptions() {
    return [
      { key: 'name',       label: 'Name',       type: 'string',  description: 'Unique identifier for this timer (also used as the internal Statistic name).' },
      { key: 'duration',   label: 'Duration (s)', type: 'number', min: 0, step: 1, description: 'Duration in seconds. For countdown: start value. For countup: target/max.' },
      { key: 'direction',  label: 'Direction',  type: 'string',  description: '"down" for countdown, "up" for countup.' },
      { key: 'autoStart',  label: 'Auto Start', type: 'boolean', description: 'If true, starts ticking immediately on Initialize.' },
      { key: 'loop',       label: 'Loop',       type: 'boolean', description: 'If true, resets and restarts when complete.' },
      { key: 'thresholds', label: 'Thresholds', type: 'object',  description: 'Array of { value, event } objects. Events emitted when value crosses threshold.' },
      { key: 'scope',      label: 'Scope',      type: 'string',  description: 'Forwarded to internal Statistic: "object", "global", or "local".' },
      { key: 'sync',       label: 'Sync',       type: 'string',  description: 'Forwarded to internal Statistic: "none", "authoritative", or "replicated".' },
      { key: 'persist',    label: 'Persist',    type: 'boolean', description: 'Forwarded to internal Statistic.' },
    ];
  }

  Initialize() {
    const o = this.options || {};
    this._running = false;
    this._complete = false;
    this._stat = null;
    this._firedThresholds = new Set();

    const name = (o.name || 'timer').toString().replace(/\s+/g, '').toLowerCase();
    const duration = Math.max(0, Number(o.duration) || 60);
    const isDown = (o.direction || 'down') === 'down';
    const startValue = isDown ? duration : 0;

    // Create internal Statistic on the same object
    this._stat = new Statistic({
      game: this.game,
      object: this.object,
      options: {
        name: name,
        min: 0,
        max: duration,
        current: startValue,
        regenPerSec: 0,
        clamp: true,
        easing: 'linear',
        scope: o.scope || 'object',
        sync: o.sync || 'none',
        persist: o.persist === true,
      },
      propName: 'Statistic',
    });
    this._stat.Initialize();
    this.game?.addComponent(this._stat);
    // Add to object's component list
    if (this.object && Array.isArray(this.object.__components)) {
      this.object.__components.push(this._stat);
    }

    // Parse thresholds
    this._thresholds = [];
    if (Array.isArray(o.thresholds)) {
      for (const t of o.thresholds) {
        if (t && typeof t.value === 'number' && t.event) {
          this._thresholds.push({ value: t.value, event: String(t.event) });
        }
      }
    }

    if (o.autoStart) {
      this.start();
    }
  }

  Dispose() {
    // Clean up internal statistic
    if (this._stat) {
      try { this._stat.Dispose(); } catch {}
    }
    this._stat = null;
  }

  Update(dt) {
    if (!this._running || this._complete || !this._stat) return;

    const o = this.options || {};
    const isDown = (o.direction || 'down') === 'down';
    const delta = isDown ? -dt : dt;
    const prevValue = this._stat.options.current;

    this._stat.add(delta);

    const curValue = this._stat.options.current;

    // Check thresholds
    for (const t of this._thresholds) {
      if (this._firedThresholds.has(t.event)) continue;
      const crossed = isDown
        ? (prevValue > t.value && curValue <= t.value)
        : (prevValue < t.value && curValue >= t.value);
      if (crossed) {
        this._firedThresholds.add(t.event);
        this.game?.eventSystem?.emit(t.event, { timer: o.name, value: curValue });
      }
    }

    // Check completion
    const done = isDown ? (curValue <= 0) : (curValue >= (Number(o.duration) || 60));
    if (done) {
      this._complete = true;
      this._running = false;
      const completeName = (o.name || 'timer').toString().replace(/\s+/g, '').toLowerCase();
      this.game?.eventSystem?.emit(`timer:${completeName}:complete`, { timer: o.name, value: curValue });

      if (o.loop) {
        this.reset();
        this.start();
      }
    }
  }

  // Public API
  start() {
    this._running = true;
    this._complete = false;
  }

  stop() {
    this._running = false;
  }

  pause() {
    this._running = false;
  }

  resume() {
    if (!this._complete) {
      this._running = true;
    }
  }

  reset() {
    const o = this.options || {};
    const isDown = (o.direction || 'down') === 'down';
    const duration = Math.max(0, Number(o.duration) || 60);
    if (this._stat) {
      this._stat.setCurrent(isDown ? duration : 0);
    }
    this._complete = false;
    this._running = false;
    this._firedThresholds.clear();
  }

  getTime() {
    return this._stat ? Number(this._stat.options.current) || 0 : 0;
  }

  getFormatted() {
    const t = Math.max(0, Math.floor(this.getTime()));
    const m = Math.floor(t / 60);
    const s = t % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  isRunning() {
    return this._running;
  }

  isComplete() {
    return this._complete;
  }
}

ComponentRegistry.register('Timer', Timer);
