'use strict';
import { Component, ComponentRegistry } from "./component.js";
import { executeAction } from "./event.js";

/**
 * Sequencer Component
 *
 * Executes a timed sequence of actions. Supports:
 * - Loop, reverse, play, pause
 * - Event-triggered playback
 * - Random delays between steps
 * - Iterative repeats (run step N times with delay)
 *
 * Each step: { time, action, delay?, randomDelay?, repeat? }
 * Actions use the ActionRegistry (ModifyStatistic, SpawnFromPool, FireProjectile,
 * SendComponentMessage, etc.).
 */
export class Sequencer extends Component {
  static getDefaultParams() {
    return {
      name: 'sequencer',
      autoStart: false,
      loop: false,
      reverse: false,
      duration: 10,           // total sequence length (for loop/reset)
      steps: [],              // [{ time, action: { type, params }, delay?, randomDelay?, repeat? }]
      triggerEvents: [],      // event names that call play() on emit
      phase: 'update',       // "input" | "fixed" | "update" | "late"
      onComplete: '',        // event or action config fired when sequence completes (non-loop)
    };
  }

  static getParamDescriptions() {
    return [
      { key: 'name', label: 'Name', type: 'string', description: 'Unique identifier for this sequencer.' },
      { key: 'autoStart', label: 'Auto Start', type: 'boolean', description: 'Start playing immediately on Initialize.' },
      { key: 'loop', label: 'Loop', type: 'boolean', description: 'Restart from beginning when sequence completes.' },
      { key: 'reverse', label: 'Reverse', type: 'boolean', description: 'Play backwards (decrement time).' },
      { key: 'duration', label: 'Duration (s)', type: 'number', min: 0, step: 0.5, description: 'Total sequence length in seconds.' },
      { key: 'steps', label: 'Steps', type: 'object', description: 'Array of { time, action: { type, params }, delay?, randomDelay?, repeat? }.' },
      { key: 'triggerEvents', label: 'Trigger Events', type: 'object', description: 'Event names that start playback when emitted.' },
      { key: 'phase', label: 'Phase', type: 'string', description: 'Game loop phase: input, fixed, update, or late.' },
      { key: 'onComplete', label: 'On Complete', type: 'string', description: 'Event name or action config when sequence completes (non-loop).' },
    ];
  }

  Initialize() {
    const o = this.options || {};
    this._playing = false;
    this._paused = false;
    this._elapsed = 0;
    this._firedSteps = new Set();
    this._unsubs = [];
    this._repeatCounters = new Map();

    const name = (o.name || 'sequencer').toString().replace(/\s+/g, '').toLowerCase();
    this._duration = Math.max(0, Number(o.duration) || 10);

    // Parse and sort steps by time
    this._steps = [];
    const raw = Array.isArray(o.steps) ? o.steps : [];
    for (const s of raw) {
      if (!s || typeof s.action !== 'object' || !s.action?.type) continue;
      const time = Math.max(0, Number(s.time) || 0);
      this._steps.push({
        time,
        action: s.action,
        delay: Math.max(0, Number(s.delay) || 0),
        randomDelay: Array.isArray(s.randomDelay) && s.randomDelay.length >= 2
          ? [Number(s.randomDelay[0]) || 0, Number(s.randomDelay[1]) || 0]
          : null,
        repeat: Math.max(1, Math.floor(Number(s.repeat) || 1)),
      });
    }
    this._steps.sort((a, b) => (this.options?.reverse ? b.time - a.time : a.time - b.time));

    // Register in game sequencers map
    if (this.game?.sequencers) this.game.sequencers.set(name, this);

    // Subscribe to trigger events
    const triggers = Array.isArray(o.triggerEvents) ? o.triggerEvents : (o.triggerEvents ? [o.triggerEvents] : []);
    const es = this.game?.eventSystem;
    for (const ev of triggers) {
      if (!ev || typeof ev !== 'string') continue;
      const fn = () => this.play();
      es?.onEvent?.(ev, fn);
      this._unsubs.push(() => es?.offEvent?.(ev, fn));
    }

    if (o.autoStart) this.play();
  }

  Dispose() {
    const name = (this.options?.name || 'sequencer').toString().replace(/\s+/g, '').toLowerCase();
    if (this.game?.sequencers?.get(name) === this) this.game.sequencers.delete(name);
    for (const fn of this._unsubs) { try { fn(); } catch {} }
    this._unsubs = [];
  }

  Input(dt)       { if (this._phaseEnabled('input')) this._tick(dt); }
  FixedUpdate(dt) { if (this._phaseEnabled('fixed')) this._tick(dt); }
  Update(dt)      { if (this._phaseEnabled('update')) this._tick(dt); }
  LateUpdate(dt)  { if (this._phaseEnabled('late')) this._tick(dt); }

  _phaseEnabled(phase) {
    const p = (this.options?.phase || 'update').toLowerCase();
    return p === phase;
  }

  _tick(dt) {
    if (!this._playing || this._paused) return;
    const o = this.options || {};
    const reverse = o.reverse === true;
    const loop = o.loop === true;

    this._elapsed += reverse ? -dt : dt;

    // Handle loop wrap
    if (loop) {
      if (reverse && this._elapsed < 0) this._elapsed = this._duration;
      else if (!reverse && this._elapsed >= this._duration) this._elapsed = 0;
    }

    // Check completion (non-loop)
    if (!loop) {
      const done = reverse ? (this._elapsed <= 0) : (this._elapsed >= this._duration);
      if (done) {
        this._playing = false;
        this._elapsed = reverse ? 0 : this._duration;
        this._emitComplete();
        return;
      }
    }

    const ctx = { game: this.game, object: this.object, component: this };
    for (const step of this._steps) {
      const crossed = reverse
        ? (step.time <= this._elapsed + dt && step.time > this._elapsed)
        : (this._elapsed - dt < step.time && this._elapsed >= step.time);

      if (!crossed) continue;

      const repeat = step.repeat || 1;
      this._executeStep(ctx, step);
      if (repeat > 1) {
        const rand = step.randomDelay
          ? step.randomDelay[0] + Math.random() * Math.max(0, step.randomDelay[1] - step.randomDelay[0])
          : 0;
        const intervalMs = (step.delay + rand) * 1000;
        for (let i = 1; i < repeat; i++) {
          const s = step;
          setTimeout(() => this._executeStep(ctx, s), intervalMs * i);
        }
      }
    }
  }

  async _executeStep(ctx, step) {
    const action = step.action;
    if (!action) return;
    try {
      await executeAction(ctx, action, { sequencer: this, step });
    } catch (e) {
      try { console.warn('[Sequencer] Step execute failed:', action?.type, e); } catch {}
    }
  }

  async _emitComplete() {
    const cfg = this.options?.onComplete;
    if (!cfg) return;
    try {
      if (typeof cfg === 'string') {
        this.game?.eventSystem?.emit(String(cfg), { sequencer: this });
      } else {
        const mod = await import('./event.js');
        await mod.executeActions(
          { game: this.game, object: this.object, component: this },
          cfg,
          { sequencer: this }
        );
      }
    } catch {}
  }

  play() {
    this._playing = true;
    this._paused = false;
  }

  pause() {
    this._paused = true;
  }

  resume() {
    this._paused = false;
  }

  stop() {
    this._playing = false;
    this._paused = false;
  }

  reset() {
    const o = this.options || {};
    this._elapsed = o.reverse ? this._duration : 0;
    this._firedSteps.clear();
    this._repeatCounters.clear();
    this._playing = false;
    this._paused = false;
  }

  seek(time) {
    this._elapsed = Math.max(0, Math.min(time, this._duration));
  }

  isPlaying() { return this._playing; }
  isPaused()  { return this._paused; }
  getElapsed() { return this._elapsed; }
  getDuration() { return this._duration; }
}

ComponentRegistry.register('Sequencer', Sequencer);
ComponentRegistry.register('sequencer', Sequencer);
