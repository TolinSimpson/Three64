'use strict';
import {
  Object3D,
  Mesh,
  MeshBasicMaterial,
  TextureLoader,
  NearestFilter,
  DoubleSide,
  Vector3,
  Euler,
  Color,
} from "three";
import { DecalGeometry } from "three/examples/jsm/geometries/DecalGeometry.js";
import { Component, ComponentRegistry, ArchetypeRegistry } from "./component.js";

// Module-level texture cache: URL -> THREE.Texture
const _textureCache = new Map();
const _textureLoader = new TextureLoader();

function loadCachedTexture(url) {
  if (!url) return null;
  const key = String(url);
  if (_textureCache.has(key)) return _textureCache.get(key);
  const tex = _textureLoader.load(key);
  tex.minFilter = NearestFilter;
  tex.magFilter = NearestFilter;
  tex.generateMipmaps = false;
  _textureCache.set(key, tex);
  return tex;
}

/**
 * Decal Component
 *
 * Projects a textured decal onto a target mesh in the scene. Designed to be
 * pooled via the ArchetypeRegistry / PoolManager for efficient reuse (e.g.
 * bullet holes, scorch marks, splats).
 *
 * Usage (pooled):
 *   const obj = game.pool.obtain("Decal");
 *   const decal = obj.__components?.find(c => c.propName === "Decal");
 *   decal.project({ position, normal, target });
 *
 * Usage (standalone):
 *   const decal = new Decal({ game, object: new Object3D(), options: {...} });
 *   decal.Initialize();
 *   game.addComponent(decal);
 *   decal.project({ position, normal, target });
 */
export class Decal extends Component {
  constructor(ctx) {
    super(ctx);
    const o = (ctx && ctx.options) || {};
    this.image       = o.image || "";           // URL / path to decal texture
    this.sizeX       = typeof o.sizeX === "number" ? o.sizeX : (typeof o.size === "number" ? o.size : 1);
    this.sizeY       = typeof o.sizeY === "number" ? o.sizeY : (typeof o.size === "number" ? o.size : 1);
    this.sizeZ       = typeof o.sizeZ === "number" ? o.sizeZ : (typeof o.size === "number" ? o.size : 1);
    this.opacity     = typeof o.opacity === "number" ? o.opacity : 1.0;
    this.color       = o.color || "#ffffff";
    this.rotation    = typeof o.rotation === "number" ? o.rotation : 0; // radians around the normal
    this.lifeSeconds = typeof o.lifeSeconds === "number" ? o.lifeSeconds : 0; // 0 = permanent
    this.fadeSeconds = typeof o.fadeSeconds === "number" ? o.fadeSeconds : 0;  // fade-out before despawn
    this.depthWrite  = o.depthWrite === true;
    this.depthTest   = o.depthTest !== false;    // default true
    this.polygonOffsetFactor = typeof o.polygonOffsetFactor === "number" ? o.polygonOffsetFactor : -4;

    this._active     = false;
    this._ttl        = 0;
    this._fadeTTL    = 0;
    this._mesh       = null;  // the projected decal mesh (child of this.object)
    this._material   = null;
    this._baseOpacity = this.opacity;
  }

  static getDefaultParams() {
    return {
      image: "",
      size: 1,
      sizeX: 1,
      sizeY: 1,
      sizeZ: 1,
      opacity: 1.0,
      color: "#ffffff",
      rotation: 0,
      lifeSeconds: 0,
      fadeSeconds: 0,
      depthWrite: false,
      depthTest: true,
      polygonOffsetFactor: -4,
    };
  }

  static getParamDescriptions() {
    return [
      { key: "image",       label: "Image",          type: "string",  description: "URL or path to the decal texture image." },
      { key: "sizeX",       label: "Size X",         type: "number",  min: 0.01, step: 0.1, description: "Width of the projected decal." },
      { key: "sizeY",       label: "Size Y",         type: "number",  min: 0.01, step: 0.1, description: "Height of the projected decal." },
      { key: "sizeZ",       label: "Size Z (Depth)",  type: "number",  min: 0.01, step: 0.1, description: "Projection depth of the decal." },
      { key: "opacity",     label: "Opacity",        type: "number",  min: 0, max: 1, step: 0.05, description: "Base opacity." },
      { key: "color",       label: "Color",          type: "string",  description: "Tint color (hex string)." },
      { key: "rotation",    label: "Rotation (rad)",  type: "number",  step: 0.1, description: "Rotation around the surface normal (radians)." },
      { key: "lifeSeconds", label: "Lifetime (s)",   type: "number",  min: 0, step: 0.5, description: "Auto-despawn after N seconds (0 = permanent)." },
      { key: "fadeSeconds",  label: "Fade (s)",       type: "number",  min: 0, step: 0.25, description: "Fade-out duration before despawn." },
      { key: "depthWrite",   label: "Depth Write",    type: "boolean", description: "Whether the decal writes to the depth buffer." },
      { key: "depthTest",    label: "Depth Test",     type: "boolean", description: "Whether the decal tests against the depth buffer." },
      { key: "polygonOffsetFactor", label: "Polygon Offset", type: "number", step: 1, description: "Polygon offset factor to prevent z-fighting." },
    ];
  }

  Initialize() {
    if (!this.object || !this.object.isObject3D) {
      this.object = new Object3D();
    }
    // Pre-create the shared material (texture assigned on project)
    this._material = new MeshBasicMaterial({
      transparent: true,
      opacity: this.opacity,
      depthWrite: this.depthWrite,
      depthTest: this.depthTest,
      polygonOffset: true,
      polygonOffsetFactor: this.polygonOffsetFactor,
      polygonOffsetUnits: 1,
      side: DoubleSide,
    });
    try { this._material.color.set(this.color); } catch {}

    // If an image is already specified, load it
    if (this.image) {
      const tex = loadCachedTexture(this.image);
      if (tex) this._material.map = tex;
      this._material.needsUpdate = true;
    }

    this._active = false;
    this._ttl = 0;
    this._fadeTTL = 0;
    this._baseOpacity = this.opacity;
    this.object.visible = false;
  }

  /**
   * Project the decal onto a target mesh.
   *
   * @param {Object} opts
   * @param {THREE.Vector3}  opts.position  - World-space hit point
   * @param {THREE.Vector3}  opts.normal    - Surface normal at hit point
   * @param {THREE.Object3D} opts.target    - The mesh to project onto
   * @param {number}         [opts.rotation] - Override rotation around normal (radians)
   * @param {THREE.Vector3|{x,y,z}} [opts.size] - Override decal size {x,y,z}
   * @param {string}         [opts.image]   - Override decal image URL
   * @param {string}         [opts.color]   - Override tint color
   * @param {number}         [opts.opacity] - Override base opacity
   * @param {number}         [opts.lifeSeconds] - Override lifetime
   * @param {number}         [opts.fadeSeconds] - Override fade duration
   */
  project(opts = {}) {
    const {
      position,
      normal,
      target,
      rotation,
      size,
      image,
      color,
      opacity,
      lifeSeconds,
      fadeSeconds,
    } = opts;

    if (!target || !position) return;

    // Clean up previous projection
    this._removeDecalMesh();

    // Override per-shot parameters
    if (image && image !== this.image) {
      this.image = image;
      const tex = loadCachedTexture(image);
      if (this._material) {
        this._material.map = tex;
        this._material.needsUpdate = true;
      }
    }
    if (color !== undefined && this._material) {
      try { this._material.color.set(color); } catch {}
    }

    const baseOpacity = typeof opacity === "number" ? opacity : this.opacity;
    this._baseOpacity = baseOpacity;
    if (this._material) this._material.opacity = baseOpacity;

    // Compute orientation from surface normal
    const nrm = normal
      ? (normal.clone ? normal.clone().normalize() : new Vector3(normal.x || 0, normal.y || 1, normal.z || 0).normalize())
      : new Vector3(0, 1, 0);

    const pos = position.clone ? position.clone() : new Vector3(position.x || 0, position.y || 0, position.z || 0);

    // Build Euler orientation: align decal Z-axis with the surface normal
    const euler = new Euler();
    euler.set(
      Math.atan2(nrm.y, Math.sqrt(nrm.x * nrm.x + nrm.z * nrm.z)),
      Math.atan2(nrm.x, nrm.z),
      typeof rotation === "number" ? rotation : this.rotation,
    );

    // Decal size
    const sx = size?.x ?? this.sizeX;
    const sy = size?.y ?? this.sizeY;
    const sz = size?.z ?? this.sizeZ;
    const decalSize = new Vector3(sx, sy, sz);

    // Find the mesh to project onto. DecalGeometry needs a Mesh with geometry.
    const targetMesh = this._findProjectableMesh(target);
    if (!targetMesh) return;

    // Ensure target world matrix is up-to-date
    try { targetMesh.updateWorldMatrix(true, false); } catch {}

    try {
      const decalGeo = new DecalGeometry(targetMesh, pos, euler, decalSize);
      this._mesh = new Mesh(decalGeo, this._material);
      this._mesh.renderOrder = 100; // render on top of base geometry
      this._mesh.frustumCulled = false;

      // Add decal mesh directly to the scene (world-space projection)
      const scene = this.game?.rendererCore?.scene;
      if (scene) {
        scene.add(this._mesh);
      } else if (this.object.parent) {
        this.object.parent.add(this._mesh);
      } else {
        this.object.add(this._mesh);
      }
    } catch (e) {
      try { console.warn("Decal projection failed:", e); } catch {}
      return;
    }

    // Lifetime
    const life = typeof lifeSeconds === "number" ? lifeSeconds : this.lifeSeconds;
    const fade = typeof fadeSeconds === "number" ? fadeSeconds : this.fadeSeconds;
    this._ttl = life > 0 ? life : 0;
    this._fadeTTL = fade > 0 ? fade : 0;
    this._active = true;
    this.object.visible = true;
  }

  /**
   * Walk the target hierarchy to find a Mesh with geometry for DecalGeometry.
   */
  _findProjectableMesh(target) {
    if (target.isMesh && target.geometry) return target;
    // Search children
    let found = null;
    target.traverse((child) => {
      if (!found && child.isMesh && child.geometry) {
        found = child;
      }
    });
    return found;
  }

  Update(dt) {
    if (!this._active) return;
    if (this._ttl <= 0 && this.lifeSeconds <= 0) return; // permanent decal

    this._ttl -= dt;

    // Fade phase
    if (this._fadeTTL > 0 && this._ttl <= this._fadeTTL && this._material) {
      const t = Math.max(0, this._ttl) / this._fadeTTL;
      this._material.opacity = this._baseOpacity * t;
    }

    if (this._ttl <= 0) {
      this._despawn();
    }
  }

  /**
   * Reset the decal for pool reuse.
   */
  reset() {
    this._active = false;
    this._ttl = 0;
    this._fadeTTL = 0;
    this._removeDecalMesh();
    if (this._material) {
      this._material.opacity = this._baseOpacity;
    }
    if (this.object) this.object.visible = false;
  }

  _removeDecalMesh() {
    if (this._mesh) {
      try { this._mesh.geometry?.dispose(); } catch {}
      try {
        if (this._mesh.parent) this._mesh.parent.remove(this._mesh);
      } catch {}
      this._mesh = null;
    }
  }

  _despawn() {
    if (!this._active) return;
    this.reset();
    // Return to pool if pooled
    if (this.object?.userData?.__pooled && this.game?.pool) {
      try { this.game.pool.release(this.object); } catch {}
    } else {
      try {
        if (this.object?.parent) this.object.parent.remove(this.object);
      } catch {}
    }
  }

  Dispose() {
    this._removeDecalMesh();
    // Dispose the material instance (textures are shared/cached, not disposed here)
    try { this._material?.dispose(); } catch {}
    this._material = null;
    this._active = false;
    super.Dispose?.();
  }
}

ComponentRegistry.register("Decal", Decal);
ComponentRegistry.register("decal", Decal);

// Poolable archetype for decals
ArchetypeRegistry.register("Decal", {
  defaults: Decal.getDefaultParams(),
  create(game, params) {
    const obj = new Object3D();
    obj.name = "Decal";
    obj.visible = false;
    const comp = new Decal({ game, object: obj, options: params || {}, propName: "Decal" });
    obj.__components = obj.__components || [];
    obj.__components.push(comp);
    game.addComponent(comp);
    comp.Initialize?.();
    return obj;
  },
});
