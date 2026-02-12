'use strict';
import { Component, ComponentRegistry } from "./component.js";

/**
 * NetworkState Component
 *
 * A generic property-sync component. Attach it to any object to replicate
 * arbitrary properties over the network. Decouples "what to sync" from
 * "how to sync" (WebSocket vs Multisynq).
 *
 * In addition to explicit syncProperties, auto-collects all Statistics on the
 * same object that have sync: "authoritative" and includes them in outgoing
 * packets. On the receiving end, Statistics with sync: "replicated" are updated.
 */
export class NetworkState extends Component {
  static getDefaultParams() {
    return {
      syncProperties: [
        { path: 'position',   strategy: 'interpolate', rate: 20 },
        { path: 'rotation.y', strategy: 'interpolate', rate: 20 },
      ],
      ownership: 'local',           // 'local' | 'remote' | 'authority'
      interpolationSpeed: 10,        // default lerp factor
      syncRate: 20,                  // default sends/sec if not overridden per-property
    };
  }

  static getParamDescriptions() {
    return [
      { key: 'syncProperties',     label: 'Sync Properties',     type: 'object',  description: 'Array of { path, strategy, rate, source }. Strategy: "interpolate", "snap", or "predict".' },
      { key: 'ownership',          label: 'Ownership',           type: 'string',  description: '"local" = this client sends, "remote" = receives, "authority" = server decides.' },
      { key: 'interpolationSpeed', label: 'Interpolation Speed', type: 'number',  min: 1, max: 60, step: 1, description: 'Default lerp factor for interpolate strategy.' },
      { key: 'syncRate',           label: 'Sync Rate (Hz)',      type: 'number',  min: 1, max: 60, step: 1, description: 'Default sends per second.' },
    ];
  }

  Initialize() {
    const o = this.options || {};
    this._timer = 0;
    this._syncRate = 1 / Math.max(1, Number(o.syncRate) || 20);
    this._lerpSpeed = Number(o.interpolationSpeed) || 10;
    this._ownership = o.ownership || 'local';

    // Parse syncProperties
    this._syncProps = [];
    let props = o.syncProperties || [];
    if (typeof props === 'string') {
      try { props = JSON.parse(props); } catch { props = []; }
    }
    if (Array.isArray(props)) {
      for (const p of props) {
        if (p && p.path) {
          this._syncProps.push({
            path: String(p.path),
            strategy: p.strategy || 'snap',
            rate: p.rate ? (1 / Math.max(1, Number(p.rate))) : this._syncRate,
            source: p.source || null,
            _timer: 0,
            _target: null,
          });
        }
      }
    }

    // Buffer for incoming state (remote ownership)
    this._remoteState = {};
  }

  Update(dt) {
    if (!this.game?.network?.connected) return;

    if (this._ownership === 'local') {
      this._timer += dt;
      if (this._timer >= this._syncRate) {
        this._timer = 0;
        this._sendState();
      }
    } else if (this._ownership === 'remote') {
      this._applyRemoteState(dt);
    }
  }

  // Called externally when a state message arrives for this object
  receiveState(props) {
    if (!props || typeof props !== 'object') return;
    this._remoteState = { ...this._remoteState, ...props };
  }

  // Gather and send state
  _sendState() {
    const net = this.game?.network;
    if (!net || !net.connected) return;

    const props = {};

    // Explicit sync properties
    for (const sp of this._syncProps) {
      const value = this._readProperty(sp.path, sp.source);
      if (value !== undefined) {
        props[sp.path] = value;
      }
    }

    // Auto-collect authoritative Statistics on same object
    const comps = this.object?.__components || [];
    for (const c of comps) {
      if (c?.constructor?.name === 'Statistic' && c.options?.sync === 'authoritative') {
        const name = (c.options?.name || '').toString().replace(/\s+/g, '').toLowerCase();
        if (name) {
          props[`stat:${name}`] = c.options.current;
        }
      }
    }

    // Also check global statistics if this object owns any
    if (this.game?.statistics) {
      for (const [name, stat] of this.game.statistics) {
        if (stat.options?.sync === 'authoritative' && stat.object === this.object) {
          props[`stat:${name}`] = stat.options.current;
        }
      }
    }

    if (Object.keys(props).length === 0) return;

    const objName = this.object?.name || this.object?.uuid || '';
    if (typeof net.sendState === 'function') {
      net.sendState(objName, props);
    } else if (net.ws && net.ws.readyState === 1) {
      // Fallback: direct WebSocket send
      net.ws.send(JSON.stringify({
        type: 'state',
        objectId: objName,
        props,
      }));
    }
  }

  // Apply received remote state with interpolation/snap
  _applyRemoteState(dt) {
    for (const sp of this._syncProps) {
      const key = sp.path;
      if (!(key in this._remoteState)) continue;

      const targetValue = this._remoteState[key];
      if (sp.strategy === 'interpolate' && typeof targetValue === 'number') {
        const current = this._readProperty(key, sp.source);
        if (typeof current === 'number') {
          const lerped = current + (targetValue - current) * Math.min(1, this._lerpSpeed * dt);
          this._writeProperty(key, sp.source, lerped);
        } else {
          this._writeProperty(key, sp.source, targetValue);
        }
      } else {
        this._writeProperty(key, sp.source, targetValue);
      }
    }

    // Apply replicated Statistics
    const comps = this.object?.__components || [];
    for (const c of comps) {
      if (c?.constructor?.name === 'Statistic' && c.options?.sync === 'replicated') {
        const name = (c.options?.name || '').toString().replace(/\s+/g, '').toLowerCase();
        const key = `stat:${name}`;
        if (key in this._remoteState) {
          c.setCurrent(this._remoteState[key]);
        }
      }
    }
  }

  // Read a property value from this object or a component
  _readProperty(path, source) {
    if (source) {
      return this._readComponentProperty(source);
    }
    // Read from object (supports dotted paths like position.x, rotation.y)
    return this._readDottedPath(this.object, path);
  }

  _writeProperty(path, source, value) {
    if (source) {
      this._writeComponentProperty(source, value);
      return;
    }
    this._writeDottedPath(this.object, path, value);
  }

  _readDottedPath(obj, path) {
    if (!obj || !path) return undefined;
    // Special: "position" returns [x,y,z]
    if (path === 'position' && obj.position) {
      return [obj.position.x, obj.position.y, obj.position.z];
    }
    const parts = path.split('.');
    let cur = obj;
    for (const p of parts) {
      if (cur == null) return undefined;
      cur = cur[p];
    }
    return cur;
  }

  _writeDottedPath(obj, path, value) {
    if (!obj || !path) return;
    // Special: "position" from [x,y,z]
    if (path === 'position' && Array.isArray(value) && obj.position) {
      obj.position.set(value[0], value[1], value[2]);
      return;
    }
    const parts = path.split('.');
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      if (cur == null) return;
      cur = cur[parts[i]];
    }
    if (cur != null) {
      cur[parts[parts.length - 1]] = value;
    }
  }

  _readComponentProperty(source) {
    // source formats: "statistic:health", "component:AnimationController:currentState"
    const parts = source.split(':');
    if (parts[0] === 'statistic') {
      const statName = parts[1] || '';
      const comps = this.object?.__components || [];
      for (const c of comps) {
        if (c?.constructor?.name === 'Statistic') {
          const n = (c.options?.name || '').toString().replace(/\s+/g, '').toLowerCase();
          if (n === statName.toLowerCase()) return c.options.current;
        }
      }
    } else if (parts[0] === 'component') {
      const typeName = parts[1] || '';
      const propName = parts[2] || '';
      const comps = this.object?.__components || [];
      for (const c of comps) {
        const n = (c?.propName || c?.constructor?.name || '').toString().toLowerCase();
        if (n === typeName.toLowerCase() && propName) {
          return c[propName];
        }
      }
    }
    return undefined;
  }

  _writeComponentProperty(source, value) {
    const parts = source.split(':');
    if (parts[0] === 'statistic') {
      const statName = parts[1] || '';
      const comps = this.object?.__components || [];
      for (const c of comps) {
        if (c?.constructor?.name === 'Statistic') {
          const n = (c.options?.name || '').toString().replace(/\s+/g, '').toLowerCase();
          if (n === statName.toLowerCase()) {
            c.setCurrent(value);
            return;
          }
        }
      }
    } else if (parts[0] === 'component') {
      const typeName = parts[1] || '';
      const propName = parts[2] || '';
      const comps = this.object?.__components || [];
      for (const c of comps) {
        const n = (c?.propName || c?.constructor?.name || '').toString().toLowerCase();
        if (n === typeName.toLowerCase() && propName) {
          c[propName] = value;
          return;
        }
      }
    }
  }
}

ComponentRegistry.register('NetworkState', NetworkState);
