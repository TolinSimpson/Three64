'use strict';
import { Box3, Object3D, Sphere, Vector3 } from "three";
import { Component, ComponentRegistry } from "./component.js";

// Volume trigger component: emits events when objects enter/exit/stay within bounds.
export class Volume extends Component {
  constructor(ctx) {
    super(ctx);
    this._inside = new Set(); // object.uuid currently inside
    this._box = new Box3();
    this._sphere = new Sphere();
    this._tmpBox = new Box3();
    this._tmpVec = new Vector3();
    this._elapsed = 0;
  }

  static getDefaultParams() {
    return {
      enabled: true,
      // Mode/shape
      shape: "box",            // "box" | "sphere"
      size: [1, 1, 1],         // for box (local-space extents, centered at object origin)
      radius: 1,               // for sphere (local radius)
      // Phase
      phase: "update",         // "input" | "fixed" | "update" | "late"
      // Frequency control
      intervalSeconds: 0,      // 0 => evaluate every eligible frame
      // Target selection
      target: {
        mode: "scene",         // "scene" | "property" | "names"
        property: "",          // if mode === "property", use scene property name (from scene-conventions)
        names: [],             // if mode === "names", array of object names (exact match)
        onlyMeshes: true,      // include only meshes when scanning scene
      },
      // Filters (further refinement over selected targets)
      filters: {
        nameEquals: "",
        nameIncludes: "",
        hasComponent: "",
        userDataMatch: {},
      },
      // Events
      events: {
        onEnter: "VolumeEnter",
        onExit: "VolumeExit",
        onStay: "",
      },
      includePayloadObjectRef: false,
    };
  }

  static getParamDescriptions() {
    return [
      { key: "enabled", label: "Enabled", type: "boolean", description: "Enable/disable the trigger volume." },
      { key: "shape", label: "Shape", type: "enum", options: ["box", "sphere"], description: "Bounding shape to use for tests." },
      { key: "size", label: "Box Size [x,y,z]", type: "vec3", description: "Local-space size for box volume, centered on object origin." },
      { key: "radius", label: "Sphere Radius", type: "number", min: 0.01, max: 1000, step: 0.01, description: "Radius for sphere volume." },
      { key: "phase", label: "Phase", type: "enum", options: ["input", "fixed", "update", "late"], description: "Game loop phase to evaluate the volume." },
      { key: "intervalSeconds", label: "Interval (s)", type: "number", min: 0, max: 10, step: 0.01, description: "Evaluate no more often than every N seconds (0 = each frame)." },
      { key: "target.mode", label: "Target Mode", type: "enum", options: ["scene", "property", "names"], description: "How to collect candidates to test." },
      { key: "target.property", label: "Scene Property Name", type: "string", description: "When mode=property, use this scene property to resolve objects." },
      { key: "target.names", label: "Target Names []", type: "string", description: "JSON array of exact object names when mode=names." },
      { key: "target.onlyMeshes", label: "Only Meshes", type: "boolean", description: "When mode=scene, include only mesh nodes." },
      { key: "filters.nameEquals", label: "Filter: Name Equals", type: "string", description: "Exact name match." },
      { key: "filters.nameIncludes", label: "Filter: Name Includes", type: "string", description: "Substring of object name." },
      { key: "filters.hasComponent", label: "Filter: Has Component", type: "string", description: "Require a component on the object (string or JSON array)." },
      { key: "filters.userDataMatch", label: "Filter: userData Match", type: "object", description: "Key/value pairs to match against object.userData." },
      { key: "events.onEnter", label: "Event: On Enter", type: "string", description: "Event name when an object enters the volume." },
      { key: "events.onExit", label: "Event: On Exit", type: "string", description: "Event name when an object exits the volume." },
      { key: "events.onStay", label: "Event: On Stay", type: "string", description: "Event name fired each evaluation while an object remains inside." },
      { key: "includePayloadObjectRef", label: "Include Object Ref", type: "boolean", description: "Include raw object in event payload." },
    ];
  }

  Input(dt)       { if (this._phaseEnabled("input")) this._evaluate(dt); }
  FixedUpdate(dt) { if (this._phaseEnabled("fixed")) this._evaluate(dt); }
  Update(dt)      { if (this._phaseEnabled("update")) this._evaluate(dt); }
  LateUpdate(dt)  { if (this._phaseEnabled("late")) this._evaluate(dt); }

  _phaseEnabled(phase) {
    const opts = this.options || {};
    if (opts.enabled === false) return false;
    const p = (opts.phase || "update").toLowerCase();
    return p === phase;
  }

  _evaluate(dt) {
    const opts = this.options || {};
    const nowInterval = Math.max(0, Number(opts.intervalSeconds) || 0);
    this._elapsed += dt;
    if (nowInterval > 0 && this._elapsed < nowInterval) return;
    this._elapsed = 0;

    const candidates = this._collectCandidates();
    const bus = this.game?.eventSystem;
    const events = opts.events || {};
    const includeRef = opts.includePayloadObjectRef === true;
    const insideNow = new Set();

    // Prepare world-space volume
    const shape = (opts.shape || "box").toLowerCase();
    if (shape === "box") this._computeWorldBox();
    else this._computeWorldSphere();

    // Check candidates
    for (let i = 0; i < candidates.length; i++) {
      const obj = candidates[i];
      if (!this._passesFilters(obj, opts.filters || {})) continue;
      const isInside = shape === "box" ? this._objectIntersectsWorldBox(obj) : this._objectIntersectsWorldSphere(obj);
      const id = obj.uuid;
      if (isInside) {
        insideNow.add(id);
        if (!this._inside.has(id) && events.onEnter && bus?.emit) {
          bus.emit(String(events.onEnter), this._payload(obj, includeRef));
        }
        if (events.onStay && bus?.emit) {
          bus.emit(String(events.onStay), this._payload(obj, includeRef));
        }
      } else if (this._inside.has(id) && events.onExit && bus?.emit) {
        bus.emit(String(events.onExit), this._payload(obj, includeRef));
      }
    }

    // Exit for any previously inside object not present/inside now
    if (events.onExit && this._inside.size && this.game?.rendererCore?.scene) {
      for (const prevId of this._inside) {
        if (!insideNow.has(prevId)) {
          const obj = this.game.rendererCore.scene.getObjectByProperty("uuid", prevId);
          if (obj && this._passesFilters(obj, opts.filters || {}) && this.game?.eventSystem?.emit) {
            this.game.eventSystem.emit(String(events.onExit), this._payload(obj, includeRef));
          }
        }
      }
    }

    // Update inside set
    this._inside = insideNow;
  }

  _payload(object, includeRef) {
    const p = {
      name: object?.name || "",
      userData: object?.userData || {},
    };
    if (includeRef) p.object = object;
    return p;
  }

  _collectCandidates() {
    const opts = this.options || {};
    const t = opts.target || {};
    const mode = (t.mode || "scene").toLowerCase();
    const scene = this.game?.rendererCore?.scene;
    if (!scene) return [];
    if (mode === "names" && Array.isArray(t.names)) {
      const out = [];
      for (const n of t.names) {
        const arr = [];
        scene.traverse((o) => { if (o.name === n) arr.push(o); });
        out.push(...arr);
      }
      return out;
    }
    if (mode === "property" && t.property) {
      const arr = this.game?.sceneProperties?.[t.property] || this.game?.sceneIds?.[t.property] || [];
      return Array.isArray(arr) ? arr : [];
    }
    // Default: scan scene (meshes only if configured)
    const out = [];
    scene.traverse((o) => {
      if (t.onlyMeshes !== false) {
        if (o && o.isMesh && o.visible !== false) out.push(o);
      } else {
        if (o && o.visible !== false) out.push(o);
      }
    });
    return out;
  }

  _computeWorldBox() {
    // Box is centered at object origin with given local size, transformed into world space via object matrix
    const size = Array.isArray(this.options?.size) ? this.options.size : [1, 1, 1];
    const hx = Math.max(0.001, Number(size[0]) || 1) * 0.5;
    const hy = Math.max(0.001, Number(size[1]) || 1) * 0.5;
    const hz = Math.max(0.001, Number(size[2]) || 1) * 0.5;
    const localMin = new Vector3(-hx, -hy, -hz);
    const localMax = new Vector3(hx, hy, hz);
    this._box.makeEmpty();
    // Sample the 8 corners transformed by matrixWorld to build a world AABB
    const corners = [
      new Vector3(localMin.x, localMin.y, localMin.z),
      new Vector3(localMin.x, localMin.y, localMax.z),
      new Vector3(localMin.x, localMax.y, localMin.z),
      new Vector3(localMin.x, localMax.y, localMax.z),
      new Vector3(localMax.x, localMin.y, localMin.z),
      new Vector3(localMax.x, localMin.y, localMax.z),
      new Vector3(localMax.x, localMax.y, localMin.z),
      new Vector3(localMax.x, localMax.y, localMax.z),
    ];
    const m = this.object?.matrixWorld;
    if (!m) return;
    for (let i = 0; i < corners.length; i++) {
      this._tmpVec.copy(corners[i]).applyMatrix4(m);
      this._box.expandByPoint(this._tmpVec);
    }
  }

  _computeWorldSphere() {
    const r = Math.max(0.001, Number(this.options?.radius) || 1);
    const center = this.object?.getWorldPosition(new Vector3()) || new Vector3();
    this._sphere.center.copy(center);
    // Scale radius by the maximum world scale axis to approximate
    const s = this.object?.getWorldScale?.(new Vector3()) || new Vector3(1, 1, 1);
    const scaleMax = Math.max(s.x || 1, s.y || 1, s.z || 1);
    this._sphere.radius = r * scaleMax;
  }

  _objectIntersectsWorldBox(obj) {
    // Test via object's world AABB against volume world AABB
    try {
      this._tmpBox.setFromObject(obj);
      return this._tmpBox.intersectsBox(this._box);
    } catch {
      return false;
    }
  }

  _objectIntersectsWorldSphere(obj) {
    try {
      // Use object's world AABB vs sphere intersection as a quick proxy
      this._tmpBox.setFromObject(obj);
      return this._sphere.intersectsBox(this._tmpBox);
    } catch {
      return false;
    }
  }

  _passesFilters(object, filters) {
    if (!object) return false;
    try {
      const nameEq = (filters.nameEquals || "").toString();
      if (nameEq && object.name !== nameEq) return false;
      const nameSub = (filters.nameIncludes || "").toString();
      if (nameSub && !object.name.includes(nameSub)) return false;
      const hasComp = filters.hasComponent;
      if (hasComp) {
        const want = Array.isArray(hasComp) ? hasComp : [hasComp];
        const comps = object.__components || [];
        const norm = (s) => String(s || "").replace(/[\s\-_]/g, "").toLowerCase();
        let any = false;
        for (const w of want) {
          const target = norm(w);
          for (const c of comps) {
            const cname = norm(c?.propName || c?.__typeName || c?.constructor?.name);
            if (cname === target) { any = true; break; }
          }
          if (any) break;
        }
        if (!any) return false;
      }
      const ud = object.userData || {};
      const match = filters.userDataMatch || {};
      for (const [k, v] of Object.entries(match)) {
        if (ud[k] !== v) return false;
      }
      return true;
    } catch {
      return false;
    }
  }
}

ComponentRegistry.register("Volume", Volume);
ComponentRegistry.register("volume", Volume);


