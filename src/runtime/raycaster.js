'use strict';
import {
  Raycaster as ThreeRaycaster,
  Vector2,
  Vector3,
  Quaternion,
  Matrix4,
  Object3D
} from "three";
import { Component, ComponentRegistry } from "./component.js";

// Raycaster component providing multiple raycast modes and flexible event emission.
export class RaycasterComponent extends Component {
  constructor(ctx) {
    super(ctx);
    this._raycaster = new ThreeRaycaster();
    this._mouseNDC = new Vector2(0, 0);
    this._lastFireTime = 0;
    this._onMouseMove = null;
  }

  static getDefaultParams() {
    return {
      enabled: true,
      // Phase to run casts: input|fixed|update|late
      castPhase: "update",
      // Where to originate rays: screenCenter|mouse|object
      origin: "screenCenter",
      // If origin === "object", optional local offset [x,y,z]
      localOffset: [0, 0, 0],
      // Maximum ray length in meters
      maxDistance: 100,
      // Type: raycast|intersect|bounce|scatter|fan
      type: "raycast",
      // Scatter/Fan settings
      rays: 5,
      coneAngleDeg: 15,     // scatter cone full-angle
      fanAngleDeg: 30,      // fan horizontal full-angle
      // Bounce settings
      maxBounces: 1,
      // Frequency control
      intervalSeconds: 0,   // 0 => every eligible frame
      // Filters
      filters: {
        nameEquals: "",
        nameIncludes: "",
        hasComponent: "", // string or array of strings
        userDataMatch: {}, // { key: value }
      },
      // Event names to emit through EventSystem
      events: {
        onHit: "RaycastHit",
        onMiss: "RaycastMiss",
        onFilteredHit: "RaycastFilteredHit",
        onEachHit: "", // optional per-hit emission for intersect/scatter/fan/bounce
      },
      includePayloadObjectRef: false, // set true to include object refs in payload
    };
  }

  static getParamDescriptions() {
    return [
      { key: "enabled", label: "Enabled", type: "boolean", description: "Enable/disable the raycaster." },
      { key: "castPhase", label: "Cast Phase", type: "enum", options: ["input", "fixed", "update", "late"], description: "Game loop phase to run casts." },
      { key: "origin", label: "Origin", type: "enum", options: ["screenCenter", "mouse", "object"], description: "Ray origin mode." },
      { key: "localOffset", label: "Local Offset [x,y,z]", type: "vec3", description: "Local-space offset when using object origin." },
      { key: "maxDistance", label: "Max Distance", type: "number", min: 0.1, max: 1000, step: 0.1, description: "Maximum ray length." },
      { key: "type", label: "Type", type: "enum", options: ["raycast", "intersect", "bounce", "scatter", "fan"], description: "Raycast mode." },
      { key: "rays", label: "Rays (scatter/fan)", type: "number", min: 1, max: 128, step: 1, description: "Number of rays for scatter/fan." },
      { key: "coneAngleDeg", label: "Cone Angle (scatter)", type: "number", min: 0, max: 180, step: 1, description: "Full cone angle for scatter." },
      { key: "fanAngleDeg", label: "Fan Angle (fan)", type: "number", min: 0, max: 180, step: 1, description: "Horizontal fan angle for fan mode." },
      { key: "maxBounces", label: "Max Bounces", type: "number", min: 0, max: 16, step: 1, description: "Maximum number of reflections for bounce mode." },
      { key: "intervalSeconds", label: "Interval (s)", type: "number", min: 0, max: 10, step: 0.01, description: "Fire no more often than every N seconds (0 = every frame)." },
      { key: "filters.nameEquals", label: "Filter: Name Equals", type: "string", description: "Exact name match (case-sensitive)." },
      { key: "filters.nameIncludes", label: "Filter: Name Includes", type: "string", description: "Substring in object name (case-sensitive)." },
      { key: "filters.hasComponent", label: "Filter: Has Component", type: "string", description: "Component name required on hit object (string or JSON array)." },
      { key: "filters.userDataMatch", label: "Filter: userData Match", type: "object", description: "Key/value pairs to match against object.userData." },
      { key: "events.onHit", label: "Event: On Hit", type: "string", description: "Event name when any hit occurs." },
      { key: "events.onMiss", label: "Event: On Miss", type: "string", description: "Event name when no hit occurs." },
      { key: "events.onFilteredHit", label: "Event: On Filtered Hit", type: "string", description: "Event name for hits passing filters." },
      { key: "events.onEachHit", label: "Event: On Each Hit", type: "string", description: "Event name for each individual hit in multi-ray modes." },
      { key: "includePayloadObjectRef", label: "Include Object Ref", type: "boolean", description: "Include raw object reference in payload (use with care)." },
    ];
  }

  Initialize() {
    // Track mouse position in NDC for origin: 'mouse'
    const canvas = this.game?.rendererCore?.renderer?.domElement || document.getElementById("app-canvas");
    if (canvas) {
      this._onMouseMove = (e) => {
        const rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : { left: 0, top: 0, width: canvas.width, height: canvas.height };
        const x = (e.clientX - rect.left) / (rect.width || 1);
        const y = (e.clientY - rect.top) / (rect.height || 1);
        // Convert to NDC [-1,1]
        this._mouseNDC.set(x * 2 - 1, -(y * 2 - 1));
      };
      window.addEventListener("mousemove", this._onMouseMove, { passive: true });
    }
  }

  Dispose() {
    if (this._onMouseMove) {
      window.removeEventListener("mousemove", this._onMouseMove);
      this._onMouseMove = null;
    }
  }

  Input(dt)       { if (this._phaseEnabled("input")) this._tick(dt); }
  FixedUpdate(dt) { if (this._phaseEnabled("fixed")) this._tick(dt); }
  Update(dt)      { if (this._phaseEnabled("update")) this._tick(dt); }
  LateUpdate(dt)  { if (this._phaseEnabled("late")) this._tick(dt); }

  _phaseEnabled(phase) {
    const opts = this.options || {};
    if (opts.enabled === false) return false;
    const p = (opts.castPhase || "update").toLowerCase();
    return p === phase;
  }

  _tick(dt) {
    const opts = this.options || {};
    const now = performance.now() / 1000;
    const minInterval = Math.max(0, Number(opts.intervalSeconds) || 0);
    if (minInterval > 0 && (now - this._lastFireTime) < minInterval) return;
    this._lastFireTime = now;

    const results = this._performCast();
    this._emitEvents(results);
  }

  _performCast() {
    const opts = this.options || {};
    const app = this.game;
    const scene = app?.rendererCore?.scene;
    const camera = app?.rendererCore?.camera;
    if (!scene || !camera) return { type: opts.type, origin: null, direction: null, hits: [], firstHit: null };

    // Determine base ray (origin + direction)
    const { origin, direction } = this._computeBaseRay(camera);
    const type = String(opts.type || "raycast").toLowerCase();
    const maxDistance = Math.max(0.001, Number(opts.maxDistance) || 100);
    const hits = [];
    let firstHit = null;

    if (type === "raycast") {
      const h = this._raycastScene(origin, direction, maxDistance);
      if (h) { hits.push(h); firstHit = h; }
    } else if (type === "intersect") {
      const many = this._intersectScene(origin, direction, maxDistance);
      if (many.length) { hits.push(...many); firstHit = many[0]; }
    } else if (type === "bounce") {
      const bounces = Math.max(0, opts.maxBounces | 0);
      const seq = this._bounce(origin, direction, maxDistance, bounces);
      if (seq.length) { hits.push(...seq); firstHit = seq[0]; }
    } else if (type === "scatter") {
      const count = Math.max(1, opts.rays | 0);
      const angleDeg = Math.max(0, Number(opts.coneAngleDeg) || 0);
      const rays = this._scatterDirections(direction, angleDeg, count);
      for (let i = 0; i < rays.length; i++) {
        const h = this._raycastScene(origin, rays[i], maxDistance);
        if (h) hits.push(h);
      }
      if (hits.length) firstHit = hits[0];
    } else if (type === "fan") {
      const count = Math.max(1, opts.rays | 0);
      const angleDeg = Math.max(0, Number(opts.fanAngleDeg) || 0);
      const rays = this._fanDirections(camera, direction, angleDeg, count);
      for (let i = 0; i < rays.length; i++) {
        const h = this._raycastScene(origin, rays[i], maxDistance);
        if (h) hits.push(h);
      }
      if (hits.length) firstHit = hits[0];
    } else {
      // default to single raycast
      const h = this._raycastScene(origin, direction, maxDistance);
      if (h) { hits.push(h); firstHit = h; }
    }

    return { type, origin, direction, hits, firstHit };
  }

  _computeBaseRay(camera) {
    const opts = this.options || {};
    const originMode = String(opts.origin || "screenCenter").toLowerCase();
    const origin = new Vector3();
    const direction = new Vector3();

    if (originMode === "mouse") {
      this._raycaster.setFromCamera(this._mouseNDC, camera);
      origin.copy(this._raycaster.ray.origin);
      direction.copy(this._raycaster.ray.direction);
    } else if (originMode === "object" && this.object && this.object instanceof Object3D) {
      // World-space position from object, with optional local offset
      const offset = Array.isArray(opts.localOffset) && opts.localOffset.length === 3 ? opts.localOffset : [0, 0, 0];
      const m = new Matrix4().copy(this.object.matrixWorld);
      const local = new Vector3(offset[0] || 0, offset[1] || 0, offset[2] || 0).applyMatrix4(m);
      origin.copy(local);
      // Forward (-Z in local)
      const forwardLocal = new Vector3(0, 0, -1);
      const worldDir = forwardLocal.applyQuaternion(this.object.getWorldQuaternion(new Quaternion()));
      direction.copy(worldDir).normalize();
    } else {
      // Default: screen center from camera forward
      origin.copy(camera.position);
      camera.getWorldDirection(direction);
    }
    return { origin, direction };
  }

  _raycastScene(origin, direction, maxDistance) {
    const ray = this._raycaster;
    const app = this.game;
    const scene = app?.rendererCore?.scene;
    ray.set(origin, direction.clone().normalize());
    ray.far = maxDistance;
    const meshes = [];
    scene.traverse((o) => { if (o && o.isMesh && o.visible !== false) meshes.push(o); });
    const hits = ray.intersectObjects(meshes, true);
    return hits && hits.length ? this._mapHit(hits[0]) : null;
  }

  _intersectScene(origin, direction, maxDistance) {
    const ray = this._raycaster;
    const app = this.game;
    const scene = app?.rendererCore?.scene;
    ray.set(origin, direction.clone().normalize());
    ray.far = maxDistance;
    const meshes = [];
    scene.traverse((o) => { if (o && o.isMesh && o.visible !== false) meshes.push(o); });
    const hits = ray.intersectObjects(meshes, true) || [];
    return hits.map(h => this._mapHit(h));
  }

  _bounce(origin, direction, maxDistance, maxBounces) {
    const EPS = 1e-4;
    const hits = [];
    let o = origin.clone();
    let d = direction.clone().normalize();
    let remaining = Math.max(0.001, maxDistance);
    for (let i = 0; i <= maxBounces && remaining > EPS; i++) {
      const h = this._raycastScene(o, d, remaining);
      if (!h) break;
      hits.push(h);
      // Reflect direction across hit normal
      const n = h.normal.clone().normalize();
      const inDot = d.dot(n);
      const r = d.clone().sub(n.multiplyScalar(2 * inDot)).normalize();
      // Advance origin slightly past hit point to avoid self-hit
      o = h.point.clone().addScaledVector(r, EPS * 2);
      // Reduce remaining distance
      remaining = Math.max(0, remaining - h.distance);
      d = r;
    }
    return hits;
  }

  _scatterDirections(baseDir, coneAngleDeg, count) {
    const out = [];
    const half = (coneAngleDeg * Math.PI / 180) * 0.5;
    const forward = baseDir.clone().normalize();
    const upRef = Math.abs(forward.y) < 0.99 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
    const right = new Vector3().crossVectors(forward, upRef).normalize();
    const up = new Vector3().crossVectors(right, forward).normalize();
    for (let i = 0; i < count; i++) {
      const yaw = (Math.random() * 2 - 1) * half;
      const pitch = (Math.random() * 2 - 1) * half;
      const q = new Quaternion().setFromAxisAngle(up, yaw);
      const dir1 = forward.clone().applyQuaternion(q);
      const q2 = new Quaternion().setFromAxisAngle(right, pitch);
      dir1.applyQuaternion(q2).normalize();
      out.push(dir1);
    }
    return out;
  }

  _fanDirections(camera, baseDir, fanAngleDeg, count) {
    const out = [];
    const half = (fanAngleDeg * Math.PI / 180) * 0.5;
    if (count === 1) return [baseDir.clone().normalize()];
    const forward = baseDir.clone().normalize();
    const upRef = new Vector3(0, 1, 0);
    const right = new Vector3().crossVectors(forward, upRef).normalize();
    const up = new Vector3().crossVectors(right, forward).normalize();
    for (let i = 0; i < count; i++) {
      const t = count <= 1 ? 0 : i / (count - 1); // 0..1
      const yaw = -half + t * (2 * half);
      const q = new Quaternion().setFromAxisAngle(up, yaw);
      const dir = forward.clone().applyQuaternion(q).normalize();
      out.push(dir);
    }
    return out;
  }

  _mapHit(h) {
    // h from three.js: { distance, point, face, faceIndex, object, uv, ... }
    const n = h.face?.normal ? h.face.normal.clone() : new Vector3(0, 1, 0);
    // Transform normal to world space if object/worldMatrix present
    if (h.object && h.object.isObject3D) {
      const m3 = new Matrix4().extractRotation(h.object.matrixWorld);
      n.applyMatrix4(m3).normalize();
    }
    return {
      distance: h.distance,
      point: h.point.clone(),
      normal: n,
      object: h.object || null,
      name: h.object?.name || "",
      userData: h.object?.userData || {},
    };
  }

  _emitEvents(result) {
    const opts = this.options || {};
    const events = opts.events || {};
    const includeRef = opts.includePayloadObjectRef === true;
    const bus = this.game?.eventSystem;
    if (!bus || typeof bus.emit !== "function") return;

    const filters = opts.filters || {};
    const matched = [];
    for (let i = 0; i < result.hits.length; i++) {
      const h = result.hits[i];
      if (this._passesFilters(h.object, filters)) matched.push(h);
    }

    const payload = (hitOpt) => {
      const base = {
        type: result.type,
        origin: { x: result.origin?.x ?? 0, y: result.origin?.y ?? 0, z: result.origin?.z ?? 0 },
        direction: { x: result.direction?.x ?? 0, y: result.direction?.y ?? 0, z: result.direction?.z ?? 0 },
        hits: result.hits.map(h => this._hitPayload(h, includeRef)),
        firstHit: result.firstHit ? this._hitPayload(result.firstHit, includeRef) : null,
      };
      if (hitOpt) base.hit = this._hitPayload(hitOpt, includeRef);
      return base;
    };

    if (result.hits.length === 0) {
      if (events.onMiss) bus.emit(String(events.onMiss), payload(null));
      return;
    }

    if (events.onHit) bus.emit(String(events.onHit), payload(result.firstHit));
    if (matched.length && events.onFilteredHit) {
      for (const h of matched) {
        bus.emit(String(events.onFilteredHit), payload(h));
      }
    }
    if (events.onEachHit) {
      for (const h of result.hits) {
        bus.emit(String(events.onEachHit), payload(h));
      }
    }
  }

  _hitPayload(h, includeRef) {
    const p = {
      name: h.name || "",
      distance: h.distance,
      point: { x: h.point.x, y: h.point.y, z: h.point.z },
      normal: { x: h.normal.x, y: h.normal.y, z: h.normal.z },
      userData: h.userData || {},
    };
    if (includeRef) p.object = h.object || null;
    return p;
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

ComponentRegistry.register("Raycaster", RaycasterComponent);
ComponentRegistry.register("raycaster", RaycasterComponent);


