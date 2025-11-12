'use strict';
import { Component, ComponentRegistry } from "./component.js";

export class StatisticBar extends Component {
  static getDefaultParams() {
    return {
      name: 'health',
    };
  }

  async Initialize() {
    const ui = this.game?.ui;
    if (!ui) return;
    const name = this._getName();
    // Load UI assets
    await ui.loadStylesheet('statbar.css');
    await ui.loadPageIntoLayer('hud', 'statbar.html');
    // Wire incoming stat updates
    this._unsubs = [];
    this._unsubs.push(ui.on(`stat:${name}:changed`, (data) => this._updateUI(data)));
    // Kick initial label and state if any
    this._updateUI(null);
  }

  Dispose() {
    if (Array.isArray(this._unsubs)) {
      for (const fn of this._unsubs) { try { fn(); } catch {} }
    }
    this._unsubs = null;
  }

  _getName() {
    const n = (this.options?.name || this.propName || 'stat').toString();
    return n.replace(/\s+/g, '').toLowerCase();
  }

  _updateUI(data) {
    const root = document.getElementById('ui-root') || document.body;
    const fill = root.querySelector('[data-stat-fill]');
    const label = root.querySelector('[data-stat-label]');
    const nameEl = root.querySelector('[data-stat-name]');
    if (nameEl) nameEl.textContent = (this.options?.name || 'stat').toString();
    if (!fill || !label) return;
    const o = this.options || {};
    const min = Number(data?.min ?? o.min ?? 0) || 0;
    const max = Number(data?.max ?? o.max ?? 100) || 100;
    let cur = Number(data?.current ?? o.current ?? max);
    if (!Number.isFinite(cur)) cur = max;
    const pct = max > min ? ((cur - min) / (max - min)) * 100 : 100;
    fill.style.width = `${Math.max(0, Math.min(100, pct)).toFixed(2)}%`;
    label.textContent = `${Math.ceil(cur)}/${Math.ceil(max)}`;
  }
}

ComponentRegistry.register('StatisticBar', StatisticBar);


