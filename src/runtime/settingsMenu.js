'use strict';
import { loadJSON, saveLocal, loadLocal } from './io.js';
import { config, getInternalResolution } from './engine.js';

const STORAGE_KEY = 'three64:settings';

export class SettingsMenu {
  constructor(game) {
    this.game = game;
    this.settings = null;
    this._initialized = false;
    this._unsubs = [];
  }

  async init() {
    if (this._initialized) return;
    await this.game.ui.loadStylesheet('settings-menu.css');
    await this.game.ui.loadPageIntoLayer('settings', 'settings-menu.html');
    // load defaults then merge user overrides
    let defaults = {};
    try { defaults = await loadJSON('build/assets/config/settings.json'); } catch {}
    const saved = loadLocal(STORAGE_KEY, {});
    this.settings = { ...defaults, ...saved };
    this._populateForm();
    this._wireEvents();
    this.hide();
    this._initialized = true;
  }

  _populateForm() {
    const root = this._layer();
    if (!root) return;
    // Audio
    const vol = root.querySelector('[data-setting="audio.masterVolume"]');
    if (vol) vol.value = String(this.settings?.audio?.masterVolume ?? 1);
    // Graphics
    const exp = root.querySelector('[data-setting="graphics.expansionPak"]');
    if (exp) exp.checked = !!(this.settings?.graphics?.expansionPak ?? config.expansionPak);
    const dbl = root.querySelector('[data-setting="graphics.doubleSided"]');
    if (dbl) dbl.checked = !!(this.settings?.graphics?.doubleSided ?? config.renderer.defaultDoubleSided);
    const fps = root.querySelector('[data-setting="graphics.targetFPS"]');
    if (fps) fps.value = String(this.settings?.graphics?.targetFPS ?? config.targetFPS);
    // Keybinds (simple pass-through text view)
    const kb = root.querySelector('[data-setting="keybinds.raw"]');
    if (kb) {
      const obj = this.settings?.keybinds || {};
      kb.value = JSON.stringify(obj, null, 2);
    }
  }

  _wireEvents() {
    this._unsubs.push(this.game.ui.on('settings:apply', () => {
      this.applyAndSave();
    }));
    this._unsubs.push(this.game.ui.on('settings:close', () => {
      this.hide();
    }));
    // Escape to close if visible
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') {
        const visible = this._isVisible();
        if (visible) this.hide();
        else this.show();
      }
    });
  }

  _readForm() {
    const root = this._layer();
    if (!root) return;
    const get = (sel) => root.querySelector(sel);
    const audio = {
      masterVolume: Number((get('[data-setting="audio.masterVolume"]') || {}).value || 1)
    };
    const graphics = {
      expansionPak: !!(get('[data-setting="graphics.expansionPak"]') || {}).checked,
      doubleSided: !!(get('[data-setting="graphics.doubleSided"]') || {}).checked,
      targetFPS: Number((get('[data-setting="graphics.targetFPS"]') || {}).value || config.targetFPS)
    };
    let keybinds = this.settings?.keybinds || {};
    const kbText = (get('[data-setting="keybinds.raw"]') || {}).value;
    if (kbText && typeof kbText === 'string') {
      try { keybinds = JSON.parse(kbText); } catch {}
    }
    this.settings = { audio, graphics, keybinds };
  }

  applyAndSave() {
    this._readForm();
    saveLocal(STORAGE_KEY, this.settings);
    // Apply graphics settings immediately
    if (this.settings?.graphics) {
      config.expansionPak = !!this.settings.graphics.expansionPak;
      config.targetFPS = Math.max(15, Math.min(60, Number(this.settings.graphics.targetFPS) || 30));
      if (this.settings.graphics.doubleSided != null) {
        config.renderer.defaultDoubleSided = !!this.settings.graphics.doubleSided;
        try { this.game.setDoubleSided(!!this.settings.graphics.doubleSided); } catch {}
      }
      // Resize render target to new internal resolution
      const { width, height } = getInternalResolution();
      const canvas = document.getElementById('app-canvas');
      if (canvas) {
        canvas.width = width;
        canvas.height = height;
      }
    }
    // Apply audio (future: route to AudioSystem master gain)
    // Keybinds are saved for future input remapping consumers.
    this._populateForm();
  }

  show() {
    this.game.ui.setLayerVisible('settings', true);
  }
  hide() {
    this.game.ui.setLayerVisible('settings', false);
  }
  toggle() {
    if (this._isVisible()) this.hide(); else this.show();
  }

  _isVisible() {
    const layer = this._layer();
    return layer && layer.style.display !== 'none';
  }
  _layer() {
    return this.game.ui?.layers?.get?.('settings') || document.querySelector('.ui-layer-settings');
  }
}

export default SettingsMenu;


