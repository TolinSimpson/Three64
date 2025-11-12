'use strict';
export class UISystem {
  constructor(game) {
    this.game = game;
    this.root = null;
    this.layers = new Map();
    this._eventTarget = (typeof window !== 'undefined' && window.EventTarget) ? new EventTarget() : null;
    this._stylesLoaded = new Set();
    this._lastUITiles = 0;
    this._wiredDefaultHandlers = false;
  }

  init() {
    this._ensureRoot();
    // Create a default HUD layer
    this._ensureLayer('hud', 500);
    // Wire default handlers once (e.g., healthbar)
    if (!this._wiredDefaultHandlers) {
      this._wireDefaultHandlers();
      this._wiredDefaultHandlers = true;
    }
  }

  _ensureRoot() {
    if (this.root && document.body.contains(this.root)) return this.root;
    const host = document.getElementById('app-root') || document.body;
    const el = document.createElement('div');
    el.id = 'ui-root';
    el.style.position = 'absolute';
    el.style.inset = '0';
    el.style.pointerEvents = 'none';
    el.style.zIndex = '500';
    host.appendChild(el);
    this.root = el;
    return this.root;
  }

  _ensureLayer(name, zIndexBase = 500) {
    this._ensureRoot();
    const key = String(name);
    if (this.layers.has(key)) return this.layers.get(key);
    const el = document.createElement('div');
    el.className = `ui-layer ui-layer-${key}`;
    el.style.position = 'absolute';
    el.style.inset = '0';
    el.style.pointerEvents = 'none';
    el.style.zIndex = String(zIndexBase);
    this.root.appendChild(el);
    this.layers.set(key, el);
    return el;
  }

  async loadStylesheet(fileName) {
    const name = String(fileName || '').trim();
    if (!name || this._stylesLoaded.has(name)) return;
    const href = new URL(`../build/assets/css/${name}`, document.baseURI).href;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
    this._stylesLoaded.add(name);
  }

  async loadPageIntoLayer(layerName, pageFileName) {
    const topZ = (String(layerName) === 'debug') ? 1000 : undefined;
    const layer = this._ensureLayer(layerName || 'hud', topZ ?? 500);
    const url = new URL(`../build/assets/ui/${pageFileName}`, document.baseURI).href;
    let html = '';
    try {
      const res = await fetch(url);
      html = await res.text();
    } catch (e) {
      console.warn('UISystem: failed to load UI page', pageFileName, e);
      return;
    }
    layer.innerHTML = html;
    // Enable interactions inside layer
    layer.style.pointerEvents = 'none';
    // Allow pointer events on elements that opt-in
    layer.querySelectorAll('[data-interactive], button, a, input, select, textarea').forEach((el) => {
      el.style.pointerEvents = 'auto';
    });
    // Wire generic emit actions
    this._wireEmitters(layer);
  }

  _wireEmitters(scope) {
    const elements = (scope || this.root)?.querySelectorAll('[data-emit]');
    if (!elements) return;
    elements.forEach((el) => {
      const topic = el.getAttribute('data-emit');
      if (!topic) return;
      const handler = (ev) => {
        ev.preventDefault?.();
        let payload = undefined;
        const dataPayload = el.getAttribute('data-payload');
        const dataAmount = el.getAttribute('data-amount');
        if (dataPayload) {
          try { payload = JSON.parse(dataPayload); } catch { payload = dataPayload; }
        } else if (dataAmount != null) {
          const n = Number(dataAmount);
          payload = Number.isFinite(n) ? n : dataAmount;
        }
        this.emit(topic, payload);
      };
      el.addEventListener('click', handler);
      el.addEventListener('touchend', handler, { passive: true });
    });
  }

  on(topic, handler) {
    if (!this._eventTarget || typeof handler !== 'function') return () => {};
    const fn = (e) => handler(e?.detail);
    this._eventTarget.addEventListener(String(topic), fn);
    return () => {
      try { this._eventTarget.removeEventListener(String(topic), fn); } catch {}
    };
  }

  emit(topic, detail) {
    if (!this._eventTarget) return;
    const name = String(topic);
    try {
      this._eventTarget.dispatchEvent(new CustomEvent(name, { detail }));
    } catch (e) {
      try {
        const evt = document.createEvent('CustomEvent');
        evt.initCustomEvent(name, false, false, detail);
        this._eventTarget.dispatchEvent(evt);
      } catch {}
    }
  }

  setLayerVisible(name, visible) {
    const layer = this.layers.get(String(name));
    if (layer) layer.style.display = visible ? 'block' : 'none';
  }

  update(_dt) {
    // Budget: sum tiles from visible UI elements advertising data-ui-tiles
    let tiles = 0;
    if (this.root) {
      const nodes = this.root.querySelectorAll('[data-ui-tiles]');
      nodes.forEach((n) => {
        if (!n || !(n instanceof HTMLElement)) return;
        const isHidden = n.style.display === 'none' || n.style.visibility === 'hidden';
        if (isHidden) return;
        const v = Number(n.getAttribute('data-ui-tiles'));
        if (Number.isFinite(v)) tiles += Math.max(0, v | 0);
      });
    }
    if (tiles > 0) {
      this.game?.budget?.addUITiles(tiles);
      this._lastUITiles = tiles;
    } else {
      this._lastUITiles = 0;
    }
  }

  _wireDefaultHandlers() {
    // Healthbar: keep UI in sync with domain events
    this.on('health:changed', (data) => {
      const d = data || {};
      const max = Math.max(1, Number(d.max) || 100);
      const cur = Math.max(0, Math.min(max, Number(d.current) || 0));
      const pct = (cur / max) * 100;
      const fill = this.root?.querySelector('[data-health-fill]');
      if (fill) {
        fill.style.width = `${pct.toFixed(2)}%`;
      }
      const label = this.root?.querySelector('[data-health-label]');
      if (label) {
        label.textContent = `${Math.ceil(cur)}/${Math.ceil(max)}`;
      }
    });
  }
}


