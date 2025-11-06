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
