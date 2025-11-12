'use strict';
import { Component, ComponentRegistry } from "./component.js";

export class HealthbarComponent extends Component {
  static getDefaultParams() {
    return {
      maxHealth: 100,
      currentHealth: 100,
      showDemo: true
    };
  }

  Initialize() {
    // Ensure UI system exists
    const ui = this.game?.ui;
    if (!ui) return;
    // Load assets
    ui.loadStylesheet('healthbar.css');
    ui.loadPageIntoLayer('hud', 'healthbar.html');
    // Subscribe to UI intents
    this._unsubs = [];
    this._unsubs.push(ui.on('health:damage', (amount) => {
      const n = Number(amount) || 0;
      if (n) this._applyDelta(-Math.abs(n));
    }));
    this._unsubs.push(ui.on('health:heal', (amount) => {
      const n = Number(amount) || 0;
      if (n) this._applyDelta(Math.abs(n));
    }));
    // Push initial state to UI
    this._emitChanged();
  }

  Dispose() {
    if (Array.isArray(this._unsubs)) {
      for (const fn of this._unsubs) { try { fn(); } catch {} }
    }
    this._unsubs = null;
  }

  _applyDelta(delta) {
    const o = this.options || {};
    const max = Math.max(1, Number(o.maxHealth) || 100);
    let cur = Number(o.currentHealth);
    if (!Number.isFinite(cur)) cur = max;
    cur = Math.max(0, Math.min(max, cur + delta));
    this.options.currentHealth = cur;
    this._emitChanged();
  }

  _emitChanged() {
    const o = this.options || {};
    const max = Math.max(1, Number(o.maxHealth) || 100);
    let cur = Number(o.currentHealth);
    if (!Number.isFinite(cur)) cur = max;
    this.game?.ui?.emit('health:changed', { current: cur, max });
  }
}

ComponentRegistry.register('Healthbar', HealthbarComponent);


