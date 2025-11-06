export class Component {
  constructor({ game, object, options, propName }) {
    this.game = game;
    this.object = object;
    this.options = options;
    this.propName = propName;
  }
  Initialize() {}
  Update(dt) {}
  Dispose() {}

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
