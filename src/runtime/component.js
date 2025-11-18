'use strict';
export class Component {
  constructor({ game, object, options, propName }) {
    this.game = game;
    this.object = object;
    this.options = options;
    this.propName = propName;
  }
  // Components can override to expose default parameter presets for tooling/runtime
  static getDefaultParams() { return {}; }
  // Components can override to describe their parameters for tooling/editors
  // Each entry: { key, label, type, min, max, step, options, description }
  static getParamDescriptions() { return []; }
  Initialize() {}
  Update(dt) {}
  Dispose() {
    // 1. Remove from Game Loop
    try { this.game?.removeComponent?.(this); } catch {}

    // 2. Remove from Object's component list
    if (this.object && Array.isArray(this.object.__components)) {
      const idx = this.object.__components.indexOf(this);
      if (idx >= 0) this.object.__components.splice(idx, 1);
    }

    // 3. Clear references
    this.game = null;
    this.object = null;
  }

  // Event execution helper: executes configured actions in options.events[name]
  async onEvent(name, payload) {
    const cfg = this?.options?.events ? this.options.events[name] : undefined;
    if (!cfg) return;
    if (typeof cfg === "string") {
      try { this.game?.eventSystem?.emit(String(cfg), payload); } catch {}
      return;
    }
    // Lazy import to avoid cycles
    try {
      const mod = await import("./event.js");
      await mod.executeActions({ game: this.game, object: this.object, component: this }, cfg, payload);
    } catch {}
  }

  // Alias for clarity in components
  async triggerConfiguredEvent(key, payload) {
    return this.onEvent(key, payload);
  }

  // Serialization
  Serialize() {
    const typeName = this.propName || this.constructor?.name || "Component";
    const objectId = this.object?.userData?.saveId || this.object?.uuid;
    const keys = this.serializableKeys || this.constructor?.serializableKeys || null;
    let data = {};
    if (Array.isArray(keys)) {
      for (const k of keys) {
        if (k in this) data[k] = this[k];
      }
    } else if (typeof this.getSerializableState === "function") {
      data = this.getSerializableState() || {};
    }
    return { type: typeName, objectId, data };
  }

  Deserialize(data) {
    if (!data || typeof data !== "object") return;
    const keys = this.serializableKeys || this.constructor?.serializableKeys || null;
    if (Array.isArray(keys) && data) {
      for (const k of keys) {
        if (k in data) this[k] = data[k];
      }
    } else if (typeof this.applyDeserializedState === "function") {
      this.applyDeserializedState(data);
    }
  }

  // Component lookup helpers
  getComponent(typeOrName) {
    const list = this.object?.__components || [];
    const wantName = typeof typeOrName === "string" ? String(typeOrName) : null;
    for (const c of list) {
      if (!c) continue;
      if (wantName) {
        const a = (c.propName || c.__typeName || c.constructor?.name || "").toString();
        if (normalizeName(a) === normalizeName(wantName)) return c;
      } else if (typeof typeOrName === "function" && c instanceof typeOrName) {
        return c;
      }
    }
    return null;
  }

  getComponents(typeOrName) {
    const list = this.object?.__components || [];
    const out = [];
    const wantName = typeof typeOrName === "string" ? String(typeOrName) : null;
    for (const c of list) {
      if (!c) continue;
      if (!typeOrName) { out.push(c); continue; }
      if (wantName) {
        const a = (c.propName || c.__typeName || c.constructor?.name || "").toString();
        if (normalizeName(a) === normalizeName(wantName)) out.push(c);
      } else if (typeof typeOrName === "function" && c instanceof typeOrName) {
        out.push(c);
      }
    }
    return out;
  }

  findComponent(typeOrName) {
    const list = this.game?.componentInstances || [];
    const wantName = typeof typeOrName === "string" ? String(typeOrName) : null;
    for (const c of list) {
      if (!c) continue;
      if (wantName) {
        const a = (c.propName || c.__typeName || c.constructor?.name || "").toString();
        if (normalizeName(a) === normalizeName(wantName)) return c;
      } else if (typeof typeOrName === "function" && c instanceof typeOrName) {
        return c;
      }
    }
    return null;
  }

  findComponents(typeOrName) {
    const out = [];
    const list = this.game?.componentInstances || [];
    const wantName = typeof typeOrName === "string" ? String(typeOrName) : null;
    for (const c of list) {
      if (!c) continue;
      if (!typeOrName) { out.push(c); continue; }
      if (wantName) {
        const a = (c.propName || c.__typeName || c.constructor?.name || "").toString();
        if (normalizeName(a) === normalizeName(wantName)) out.push(c);
      } else if (typeof typeOrName === "function" && c instanceof typeOrName) {
        out.push(c);
      }
    }
    return out;
  }
}

function normalizeName(s) {
  return String(s || "").replace(/[\s\-_]/g, "").toLowerCase();
}

export const ComponentRegistry = (() => {
  const map = new Map();
  return {
    register(name, ctorOrFactory) {
      if (!name) return;
      map.set(String(name), ctorOrFactory);
    },
    get(name) {
      if (!name) return undefined;
      const key = String(name);
      const direct = map.get(key);
      if (direct) return direct;
      const norm = (s) => String(s).replace(/[\s\-_]/g, "").toLowerCase();
      const target = norm(key);
      for (const [k, v] of map.entries()) {
        if (k === key) return v;
        if (norm(k) === target) return v;
      }
      return undefined;
    },
    list() {
      return Array.from(map.keys());
    }
  };
})();

// Archetype registry for prefab-style authoring
export const ArchetypeRegistry = (() => {
  const map = new Map();
  const normalize = (s) => String(s || "").replace(/[\s\-_]/g, "").toLowerCase();
  const deepMerge = (a, b) => {
    if (!b || typeof b !== "object") return a || {};
    const out = Array.isArray(a) ? a.slice() : { ...(a || {}) };
    for (const [k, v] of Object.entries(b)) {
      if (v && typeof v === "object" && !Array.isArray(v)) {
        out[k] = deepMerge(out[k] && typeof out[k] === "object" ? out[k] : {}, v);
      } else {
        out[k] = v;
      }
    }
    return out;
  };
  return {
    register(name, defOrFactory) {
      if (!name) return;
      map.set(String(name), defOrFactory);
    },
    get(name) {
      if (!name) return undefined;
      const key = String(name);
      const direct = map.get(key);
      if (direct) return direct;
      const target = normalize(key);
      for (const [k, v] of map.entries()) {
        if (normalize(k) === target) return v;
      }
      return undefined;
    },
    list() {
      return Array.from(map.keys());
    },
    create(game, name, { overrides = {}, traits = {} } = {}) {
      const entry = this.get(name);
      if (!entry) return null;
      try {
        // Entry may be:
        // - factory: (game, { overrides, traits }) => Object3D
        // - object: { defaults, create(game, params, traits) }
        if (typeof entry === "function") {
          return entry(game, { overrides, traits });
        }
        const defaults = (entry && typeof entry.defaults === "object") ? entry.defaults : {};
        const params = deepMerge(defaults, overrides || {});
        if (entry && typeof entry.create === "function") {
          return entry.create(game, params, traits || {});
        }
      } catch (e) {
        try { console.warn("Archetype create failed:", name, e); } catch {}
      }
      return null;
    }
  };
})();