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
    // Tabs: default to first tab active if none set
    if (!this._activeTab) this._openTab('audio');
    // Audio
    const vol = root.querySelector('[data-setting="audio.masterVolume"]');
    if (vol) vol.value = String(this.settings?.audio?.masterVolume ?? 1);
    // Graphics
    const dbl = root.querySelector('[data-setting="graphics.doubleSided"]');
    if (dbl) dbl.checked = !!(this.settings?.graphics?.doubleSided ?? config.renderer.defaultDoubleSided);
    const fps = root.querySelector('[data-setting="graphics.targetFPS"]');
    if (fps) fps.value = String(this.settings?.graphics?.targetFPS ?? config.targetFPS);
    // Keybinds: render rows
    this._renderKeybinds();
    // Show "Return to Main Menu" only when main menu is not visible
    const returnBtn = root.querySelector('[data-return-main]');
    if (returnBtn) {
      const menuLayer = this.game.ui?.layers?.get?.('menu');
      const visible = !!(menuLayer && menuLayer.style.display !== 'none');
      returnBtn.style.display = visible ? 'none' : 'inline-block';
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
    // Tab switching
    const root = this._layer();
    if (root) {
      root.querySelectorAll('[data-tab-target]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const name = btn.getAttribute('data-tab-target');
          this._openTab(name);
        });
      });
    }
  }

  _readForm() {
    const root = this._layer();
    if (!root) return;
    const get = (sel) => root.querySelector(sel);
    const audio = {
      masterVolume: Number((get('[data-setting="audio.masterVolume"]') || {}).value || 1)
    };
    const graphics = {
      doubleSided: !!(get('[data-setting="graphics.doubleSided"]') || {}).checked,
      targetFPS: Number((get('[data-setting="graphics.targetFPS"]') || {}).value || config.targetFPS)
    };
    const keybinds = this.settings?.keybinds || {};
    this.settings = { audio, graphics, keybinds };
  }

  applyAndSave() {
    this._readForm();
    saveLocal(STORAGE_KEY, this.settings);
    // Apply graphics settings immediately
    if (this.settings?.graphics) {
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

  _renderKeybinds() {
    const root = this._layer();
    if (!root) return;
    const cont = root.querySelector('[data-bindings-list]');
    if (!cont) return;
    const keybinds = this.settings?.keybinds || {};
    cont.innerHTML = '';
    const entries = Object.entries(keybinds);
    entries.sort((a, b) => a[0].localeCompare(b[0]));
    for (const [action, codes] of entries) {
      const row = document.createElement('div');
      row.className = 'kb-row';
      const label = document.createElement('div');
      label.className = 'kb-action';
      label.textContent = action;
      const value = document.createElement('div');
      value.className = 'kb-value';
      value.setAttribute('data-kb-value', action);
      value.textContent = Array.isArray(codes) ? codes.join(', ') : String(codes || '');
      const btn = document.createElement('button');
      btn.className = 'kb-btn';
      btn.textContent = 'Rebind';
      btn.setAttribute('data-rebind-action', action);
      row.appendChild(label);
      row.appendChild(value);
      row.appendChild(btn);
      cont.appendChild(row);
    }
    this._wireKeybindRebinders(cont);
  }

  _wireKeybindRebinders(scope) {
    const cont = scope || this._layer();
    if (!cont) return;
    cont.querySelectorAll('[data-rebind-action]').forEach((btn) => {
      const action = btn.getAttribute('data-rebind-action');
      btn.addEventListener('click', () => {
        this._beginRebind(action);
      });
    });
  }

  _beginRebind(action) {
    if (!action) return;
    // Visual hint
    const root = this._layer();
    const valueEl = root?.querySelector(`[data-kb-value="${CSS.escape(action)}"]`);
    if (valueEl) valueEl.textContent = '(press a key or mouse button...)';
    this._awaitingRebindAction = action;
    const onKey = (e) => {
      e.preventDefault?.();
      const code = e.code || e.key || '';
      this._commitRebind(code);
    };
    const onMouse = (e) => {
      e.preventDefault?.();
      const btn = e.button;
      const map = btn === 0 ? 'MouseLeft' : btn === 1 ? 'MouseMiddle' : btn === 2 ? 'MouseRight' : `Mouse${btn}`;
      this._commitRebind(map);
    };
    const cleanup = () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onMouse, true);
      clearTimeout(timer);
    };
    const timer = setTimeout(() => cleanup(), 10000);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onMouse, true);
    this._rebindCleanup = cleanup;
  }

  _commitRebind(code) {
    if (!this._awaitingRebindAction) return;
    const action = this._awaitingRebindAction;
    this._awaitingRebindAction = null;
    try { this._rebindCleanup?.(); } catch {}
    this._rebindCleanup = null;
    if (!code) {
      this._populateForm();
      return;
    }
    // Store as single primary binding array
    if (!this.settings.keybinds) this.settings.keybinds = {};
    this.settings.keybinds[action] = [String(code)];
    // Update visible label
    const root = this._layer();
    const valueEl = root?.querySelector(`[data-kb-value="${CSS.escape(action)}"]`);
    if (valueEl) valueEl.textContent = String(code);
    // Persist immediately for convenience
    saveLocal(STORAGE_KEY, this.settings);
  }

  show() {
    this.game.ui.setLayerVisible('settings', true);
    // Update "Return to Main Menu" visibility when opening
    this._populateForm();
  }
  hide() {
    this.game.ui.setLayerVisible('settings', false);
  }
  toggle() {
    if (this._isVisible()) this.hide(); else this.show();
  }

  _openTab(name) {
    const root = this._layer();
    if (!root) return;
    this._activeTab = name;
    root.querySelectorAll('[data-tab]').forEach((sec) => {
      const n = sec.getAttribute('data-tab');
      sec.style.display = (n === name) ? 'block' : 'none';
    });
    root.querySelectorAll('[data-tab-target]').forEach((btn) => {
      const n = btn.getAttribute('data-tab-target');
      if (n === name) btn.classList.add('active'); else btn.classList.remove('active');
    });
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


