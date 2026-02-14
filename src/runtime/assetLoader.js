'use strict';
import {
  Group,
  Color,
  MeshBasicMaterial,
  MeshLambertMaterial,
  NearestFilter,
  Box3,
  Vector3,
  Quaternion,
  DirectionalLight,
  AmbientLight,
  DoubleSide,
  Matrix4,
  InstancedMesh,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { fitsInTextureMemory, config } from "./engine.js";
import { BudgetTracker } from "./debug.js";
import { ArchetypeRegistry, ComponentRegistry } from "./component.js";
import { loadJSON } from "./io.js";
import { Scene } from "./scene.js";

// -----------------------------
// Helpers
// -----------------------------
// Expand dotted/object-path keys into nested objects, supporting axis indices (x,y,z,w) and numeric indices.
function expandDotted(flat) {
  if (!flat || typeof flat !== "object" || Array.isArray(flat)) return flat;
  const out = {};
  const axisToIndex = { x: 0, y: 1, z: 2, w: 3 };
  const setPath = (obj, segments, value) => {
    if (!segments.length) return;
    const [headRaw, ...rest] = segments;
    const headLower = String(headRaw).toLowerCase();
    const idxFromAxis = Object.prototype.hasOwnProperty.call(axisToIndex, headLower) ? axisToIndex[headLower] : null;
    const isNumericIndex = /^\d+$/.test(headRaw);
    if (rest.length === 0) {
      if (isNumericIndex || idxFromAxis !== null) {
        const idx = isNumericIndex ? parseInt(headRaw, 10) : idxFromAxis;
        const arr = Array.isArray(obj) ? obj : [];
        while (arr.length <= idx) arr.push(undefined);
        arr[idx] = value;
        return arr;
      }
      if (Array.isArray(obj)) {
        // Cannot set named key on array; convert to object wrapper
        const o = {};
        for (let i = 0; i < obj.length; i++) o[i] = obj[i];
        o[headRaw] = value;
        return o;
      }
      obj[headRaw] = value;
      return obj;
    }
    // Need to descend
    let nextContainer;
    if (isNumericIndex || idxFromAxis !== null) {
      const idx = isNumericIndex ? parseInt(headRaw, 10) : idxFromAxis;
      nextContainer = Array.isArray(obj) ? obj : [];
      while (nextContainer.length <= idx) nextContainer.push(undefined);
      const child = nextContainer[idx];
      const updated = setPath(child && typeof child === "object" ? child : {}, rest, value);
      nextContainer[idx] = updated;
      return nextContainer;
    } else {
      nextContainer = (obj && typeof obj === "object" && !Array.isArray(obj)) ? obj : {};
      const child = nextContainer[headRaw];
      nextContainer[headRaw] = setPath(child && typeof child === "object" ? child : {}, rest, value);
      return nextContainer;
    }
  };
  for (const [k, v] of Object.entries(flat)) {
    const segs = String(k).split(".");
    const updated = setPath(out, segs, v);
    // setPath returns updated container when the root becomes array
    if (Array.isArray(updated)) {
      // If root became an array, merge back into object by numeric keys
      for (let i = 0; i < updated.length; i++) {
        if (updated[i] !== undefined) out[i] = updated[i];
      }
    }
  }
  return out;
}

// -----------------------------
// GLTF asset loader
// -----------------------------

export class GLTFAssetLoader {
  constructor(budgetTracker = new BudgetTracker()) {
    this.loader = new GLTFLoader();
    this.budget = budgetTracker;
  }

  async load(url, onProgress = undefined, options = undefined) {
    const gltf = await this._loadAsync(url, onProgress);

    const root = gltf.scene || gltf.scenes?.[0];
    if (!root) return { scene: new Group(), stats: { tris: 0, meshes: 0 } };

    const stats = { tris: 0, meshes: 0, bonesMax: 0, materials: 0, textures: 0, tiles: 0 };

    root.traverse((obj) => {
      if (obj.isMesh) {
        stats.meshes += 1;
        const geo = obj.geometry;
        const index = geo.getIndex();
        const triCount = index ? index.count / 3 : geo.attributes.position.count / 3;
        stats.tris += triCount;
        this.budget.addTriangles(triCount);

        if (obj.isSkinnedMesh) {
          const boneCount = obj.skeleton?.bones?.length || 0;
          stats.bonesMax = Math.max(stats.bonesMax, boneCount);
        }

        // Per-object override via Blender-exported custom property (extras -> userData)
        // Accept 'doubleSided', 'DoubleSided', or 'three64DoubleSided' as truthy flags.
        let perObjectOpts = options;
        try {
          const ud = obj.userData || {};
          const ds = (typeof ud.doubleSided === "boolean" ? ud.doubleSided
                    : typeof ud.DoubleSided === "boolean" ? ud.DoubleSided
                    : ud.three64DoubleSided === true);
          if (ds === true) {
            perObjectOpts = { ...(options || {}), doubleSided: true };
          }
        } catch {}

        const patched = this._patchMaterial(obj.material, perObjectOpts);
        obj.material = patched;
        stats.materials += Array.isArray(patched) ? patched.length : 1;

        const { tilesUsed, texturesCount } = this._applyTextureConstraints(patched);
        stats.textures += texturesCount;
        stats.tiles += tilesUsed;
        if (tilesUsed) this.budget.addTiles(tilesUsed);
      }
    });

    return { scene: root, stats };
  }

  _applyTextureConstraints(material) {
    const mats = Array.isArray(material) ? material : [material];
    let tilesUsed = 0;
    let texturesCount = 0;
    for (const m of mats) {
      if (!m || !m.map) continue;
      texturesCount += 1;
      const tex = m.map;
      const img = tex.image;
      const width = img?.width || tex.source?.data?.width || 0;
      const height = img?.height || tex.source?.data?.height || 0;
      const bpp = 8; // PNG-8 assumption post-quantization
      const paletteBytes = 256 * 4; // 256 colors RGBA palette worst-case
      const fits = fitsInTextureMemory({ width, height, bpp, paletteBytes });
      if (!fits) {
        const bytes = (width * height * bpp) / 8 + paletteBytes;
        const tiles = Math.ceil(bytes / Math.max(1, (config?.budgets?.textureMemoryBytes || 1)));
        tilesUsed += tiles;
      } else {
        tilesUsed += 1;
      }
      tex.minFilter = NearestFilter;
      tex.magFilter = NearestFilter;
      tex.generateMipmaps = false;
      tex.needsUpdate = true;
    }
    return { tilesUsed, texturesCount };
  }

  _patchMaterial(material, options) {
    const mats = Array.isArray(material) ? material : [material];
    const patched = mats.map((m) => {
      if (!m) return m;
      // Determine desired side:
      // - Respect explicit caller override if provided (true => DoubleSide; false => default/front)
      // - Otherwise, preserve original material side if it was DoubleSide
      // - Otherwise, use renderer default from config if enabled
      let makeDoubleSided = undefined;
      if (options && Object.prototype.hasOwnProperty.call(options, "doubleSided")) {
        makeDoubleSided = options.doubleSided === true;
      } else if (m.side === DoubleSide) {
        makeDoubleSided = true;
      } else if (config?.renderer?.defaultDoubleSided) {
        makeDoubleSided = true;
      }
      const params = {
        color: m.color?.clone?.() || new Color(0xffffff),
        map: m.map || null,
        fog: true,
        transparent: m.transparent === true,
      };
      if (makeDoubleSided === true) params.side = DoubleSide;
      const newMat = m.map ? new MeshBasicMaterial(params) : new MeshLambertMaterial(params);
      return newMat;
    });
    return Array.isArray(material) ? patched : patched[0];
  }

  _loadAsync(url, onProgress) {
    return new Promise((resolve, reject) => {
      this.loader.load(url, resolve, onProgress, reject);
    });
  }
}

// -----------------------------
// Scene loader (manifest)
// -----------------------------

export class SceneLoader {
  constructor(game) {
    this.game = new Scene(game);
    try { this.game.Initialize?.(); } catch {}
    this.loader = new GLTFAssetLoader(this.game?.budget);
    this._missingCtorWarned = new Set();
    this._playerDetectedLogged = false;
  }
 
  async _resolveComponentCtor(name) {
    try {
      const ctor = ComponentRegistry.get(name);
      if (ctor) return ctor;
    } catch {}
    return undefined;
  }

  async loadFromDefinition(definition, baseUrl) {
    const added = [];
    const resolveUrl = (u) => (u.startsWith("http") ? u : `${baseUrl.replace(/\/$/, "")}/${u}`);

    // Support class-based scenes that extend Scene as well as plain definition objects
    let sceneInstance = null;
    try {
      if (definition && typeof definition === "function" && definition.prototype instanceof Scene) {
        sceneInstance = new definition(this.game);
      } else if (definition && definition instanceof Scene) {
        sceneInstance = definition;
      }
    } catch {}

    const assets = (sceneInstance?.assets) || (definition?.assets) || [];

    // Load assets declared by the scene module
    const gltfEntries = assets.filter(a => a.type === "gltf");
    let fileIdx = 0;
    const totalFiles = Math.max(1, gltfEntries.length);
    for (const entry of assets) {
      if (entry.type === "gltf") {
        const absUrl = resolveUrl(entry.url);
        const { scene: root } = await this.loader.load(absUrl, (ev) => {
          if (ev && ev.total) {
            const frac = Math.max(0, Math.min(1, ev.loaded / ev.total));
            this._reportProgress(fileIdx, frac, totalFiles, entry.url);
          }
        }, {
          doubleSided: (entry.doubleSided ?? entry.materials?.doubleSided ?? config?.renderer?.defaultDoubleSided) === true
        });
        this._reportProgress(fileIdx, 1, totalFiles, entry.url);
        fileIdx += 1;
        this._applyTransform(root, entry.transform || {});
        this.game.rendererCore.scene.add(root);
        try { root.userData = root.userData || {}; root.userData.__sourceUrl = absUrl; } catch {}
        try {
          this.game.loadedGLTFs = this.game.loadedGLTFs || [];
          this.game.loadedGLTFs.push({ url: absUrl, object: root });
        } catch {}
        // Naming convention processing (LOD, COL_, etc.)
        this._processNamingConventions(root);
        // Physics via userData/extras or naming conventions
        this._applyPhysicsFromUserData(root);
        // Instantiate components from userData
        await this._instantiateFromUserData(root, baseUrl);
        // Instancing pass (optional)
        try { this._buildInstancedMeshes(root); } catch {}
        // If GLTF root carries scene-level mappings, instantiate them
        const sceneMapping = this._extractSceneMappingFromRoot(root);
        if (sceneMapping) {
          await this._instantiateProperties({ mapping: sceneMapping, baseUrl });
        }
        if (entry.physics && this.game.physics) {
          const kind = String(entry.physics.collider || "convex").toLowerCase();
          if (kind === "convex") {
            this.game.physics.addConvexColliderForObject(root, {
              mergeChildren: entry.physics.mergeChildren !== false,
              visible: entry.physics.visible === true,
            });
          } else if (kind === "mesh") {
            this.game.physics.addMeshColliderForObject(root, {
              mergeChildren: entry.physics.mergeChildren !== false,
              visible: entry.physics.visible === true,
            });
          } else if (kind === "box") {
            this.game.physics.addBoxColliderForObject(root, { visible: entry.physics.visible === true });
          } else if (kind === "sphere") {
            this.game.physics.addSphereColliderForObject(root, { visible: entry.physics.visible === true });
          } else if (kind === "capsule") {
            this.game.physics.addCapsuleColliderForObject(root, { visible: entry.physics.visible === true });
          }
        }
        added.push(root);
      } else if (entry.type === "light") {
      const color = new Color(normalizeHexColor(entry.color ?? 0xffffff));
        const intensity = entry.intensity ?? 1.0;
        let light;
        if (entry.kind === "directional") {
          light = new DirectionalLight(color, intensity);
          if (entry.position) light.position.fromArray(entry.position);
        } else if (entry.kind === "ambient") {
          light = new AmbientLight(color, intensity);
        }
        if (light) {
          this.game.rendererCore.scene.add(light);
          added.push(light);
        }
      }
    }

    // Run scene init hook if provided
    if (sceneInstance && typeof sceneInstance.init === "function") {
      await Promise.resolve(sceneInstance.init());
    } else if (typeof definition?.init === "function") {
      await Promise.resolve(definition.init(this.game));
    }

    // Instantiate properties mapped by IDs (if any)
    await this._instantiateProperties({
      mapping: sceneInstance?.properties || definition?.properties || definition?.components || definition?.idScripts || definition?.idComponents,
      baseUrl
    });

    return { objects: added, manifest: definition };
  }

  async loadFromUrl(manifestUrl) {
    const baseUrl = manifestUrl.replace(/\/[^\/]*$/, "");
    const manifest = await loadJSON(manifestUrl);
    const added = [];

    const resolveUrl = (u) => (u.startsWith("http") ? u : `${baseUrl}/${u}`);

    // Optional scene scripts
    const loadedScripts = [];
    if (Array.isArray(manifest.scripts)) {
      for (const s of manifest.scripts) {
        try {
          const mod = await import(resolveUrl(s));
          loadedScripts.push(mod);
          if (typeof mod?.default === "function") {
            await Promise.resolve(mod.default(this.game));
          } else if (typeof mod?.init === "function") {
            await Promise.resolve(mod.init(this.game));
          }
        } catch (e) {
          console.warn("Failed to load scene script:", s, e);
        }
      }
    }

    const assetsArr = manifest.assets || [];
    const gltfEntries = assetsArr.filter(a => a.type === "gltf");
    let fileIdx = 0;
    const totalFiles = Math.max(1, gltfEntries.length);
    for (const entry of assetsArr) {
      if (entry.type === "gltf") {
        const absUrl = resolveUrl(entry.url);
        const { scene: root } = await this.loader.load(absUrl, (ev) => {
          if (ev && ev.total) {
            const frac = Math.max(0, Math.min(1, ev.loaded / ev.total));
            this._reportProgress(fileIdx, frac, totalFiles, entry.url);
          }
        }, {
          doubleSided: (entry.doubleSided ?? entry.materials?.doubleSided ?? config?.renderer?.defaultDoubleSided) === true
        });
        this._reportProgress(fileIdx, 1, totalFiles, entry.url);
        fileIdx += 1;
        this._applyTransform(root, entry.transform || {});
        this.game.rendererCore.scene.add(root);
        try { root.userData = root.userData || {}; root.userData.__sourceUrl = absUrl; } catch {}
        try {
          this.game.loadedGLTFs = this.game.loadedGLTFs || [];
          this.game.loadedGLTFs.push({ url: absUrl, object: root });
        } catch {}
        this._processNamingConventions(root);
        // Physics via userData/extras or naming conventions
        this._applyPhysicsFromUserData(root);
        // Instantiate components from userData
        await this._instantiateFromUserData(root, baseUrl);
        // Instancing pass (optional)
        try { this._buildInstancedMeshes(root); } catch {}
        // Scene-level mappings on GLTF root
        const sceneMapping = this._extractSceneMappingFromRoot(root);
        if (sceneMapping) {
          await this._instantiateProperties({ mapping: sceneMapping, baseUrl });
        }
        if (entry.physics && this.game.physics) {
          const kind = String(entry.physics.collider || "convex").toLowerCase();
          if (kind === "convex") {
            this.game.physics.addConvexColliderForObject(root, {
              mergeChildren: entry.physics.mergeChildren !== false,
              visible: entry.physics.visible === true,
            });
          } else if (kind === "mesh") {
            this.game.physics.addMeshColliderForObject(root, {
              mergeChildren: entry.physics.mergeChildren !== false,
              visible: entry.physics.visible === true,
            });
          } else if (kind === "box") {
            this.game.physics.addBoxColliderForObject(root, { visible: entry.physics.visible === true });
          } else if (kind === "sphere") {
            this.game.physics.addSphereColliderForObject(root, { visible: entry.physics.visible === true });
          } else if (kind === "capsule") {
            this.game.physics.addCapsuleColliderForObject(root, { visible: entry.physics.visible === true });
          }
        }
        added.push(root);
      } else if (entry.type === "light") {
        const color = new Color(normalizeHexColor(entry.color ?? 0xffffff));
        const intensity = entry.intensity ?? 1.0;
        let light;
        if (entry.kind === "directional") {
          light = new DirectionalLight(color, intensity);
          if (entry.position) light.position.fromArray(entry.position);
        } else if (entry.kind === "ambient") {
          light = new AmbientLight(color, intensity);
        }
        if (light) {
          this.game.rendererCore.scene.add(light);
          added.push(light);
        }
      }
    }

    // Instantiate properties mapped by IDs (if any)
    await this._instantiateProperties({
      mapping: manifest?.properties || manifest?.components || manifest?.idScripts || manifest?.idComponents,
      baseUrl
    });

    return { objects: added, manifest, scripts: loadedScripts };
  }

  async _instantiateFromUserData(root, baseUrl) {
    if (!root) return;
    const normalize = (s) => String(s || "").replace(/[\s\-_]/g, "").toLowerCase();
    const expandDotted = (flat) => {
      if (!flat || typeof flat !== "object" || Array.isArray(flat)) return flat;
      const out = {};
      const axisToIndex = { x: 0, y: 1, z: 2, w: 3 };
      const setPath = (obj, segments, value) => {
        if (!segments.length) return;
        const [headRaw, ...rest] = segments;
        const headLower = String(headRaw).toLowerCase();
        const idxFromAxis = Object.prototype.hasOwnProperty.call(axisToIndex, headLower) ? axisToIndex[headLower] : null;
        const isNumericIndex = /^\d+$/.test(headRaw);
        if (rest.length === 0) {
          if (isNumericIndex || idxFromAxis !== null) {
            const idx = isNumericIndex ? parseInt(headRaw, 10) : idxFromAxis;
            const arr = Array.isArray(obj) ? obj : [];
            while (arr.length <= idx) arr.push(undefined);
            arr[idx] = value;
            return arr;
          }
          if (Array.isArray(obj)) {
            const o = {};
            for (let i = 0; i < obj.length; i++) o[i] = obj[i];
            o[headRaw] = value;
            return o;
          }
          obj[headRaw] = value;
          return obj;
        }
        let nextContainer;
        if (isNumericIndex || idxFromAxis !== null) {
          const idx = isNumericIndex ? parseInt(headRaw, 10) : idxFromAxis;
          nextContainer = Array.isArray(obj) ? obj : [];
          while (nextContainer.length <= idx) nextContainer.push(undefined);
          const child = nextContainer[idx];
          const updated = setPath(child && typeof child === "object" ? child : {}, rest, value);
          nextContainer[idx] = updated;
          return nextContainer;
        } else {
          nextContainer = (obj && typeof obj === "object" && !Array.isArray(obj)) ? obj : {};
          const child = nextContainer[headRaw];
          nextContainer[headRaw] = setPath(child && typeof child === "object" ? child : {}, rest, value);
          return nextContainer;
        }
      };
      for (const [k, v] of Object.entries(flat)) {
        const segs = String(k).split(".");
        const updated = setPath(out, segs, v);
        if (Array.isArray(updated)) {
          for (let i = 0; i < updated.length; i++) {
            if (updated[i] !== undefined) out[i] = updated[i];
          }
        }
      }
      return out;
    };
    // Collect spawn requests
    const spawnRequests = [];
    const nameInstRegex = /\[inst\s*=\s*([^\]\s]+)\]/i;
    root.updateWorldMatrix(true, true);
    root.traverse((obj) => {
      const ud = obj.userData || {};
      const name = obj.name || "";
      const archetype = ud.archetype || ud.Archetype || null;
      // overrides under a.*
      const overrideFlat = {};
      for (const [k, v] of Object.entries(ud)) {
        if (k.startsWith("a.")) {
          overrideFlat[k.substring(2)] = v;
        }
      }
      const overrides = expandDotted(overrideFlat);
      // traits under t.*
      const traits = {};
      for (const [k, v] of Object.entries(ud)) {
        if (k.startsWith("t.")) {
          const tk = k.substring(2);
          traits[tk] = v === true || v === "true" || v === 1 || v === "1" ? true : v;
        }
      }
      // instancing key
      const instKey = ud.instKey || (() => {
        const m = name.match(nameInstRegex);
        return m && m[1] ? m[1] : null;
      })();
      if (archetype) {
        spawnRequests.push({ obj, archetype, overrides, traits });
        // Use placeholder purely as a marker
        try { obj.visible = false; } catch {}
      } else if (instKey) {
        // Flag for instancing pass by tagging userData
        try { obj.userData.__instKey = String(instKey); } catch {}
      }
    });
    // Spawn archetypes and instantiate components attached via userData
    const tmpPos = new Vector3();
    const tmpQuat = new Quaternion();
    const tmpScale = new Vector3();
    const tmpMat = new Matrix4();
    for (const req of spawnRequests) {
      const inst = this.game.pool.obtain(req.archetype, { overrides: req.overrides, traits: req.traits });
      if (!inst) { console.warn("Archetype not found:", req.archetype); continue; }
      // Place at placeholder world transform
      try {
        req.obj.updateWorldMatrix(true, true);
        tmpMat.copy(req.obj.matrixWorld);
        tmpMat.decompose(tmpPos, tmpQuat, tmpScale);
        inst.position.copy(tmpPos);
        inst.quaternion.copy(tmpQuat);
        inst.scale.copy(tmpScale);
        inst.updateMatrix();
        inst.matrixAutoUpdate = false;
      } catch {}
      try { this.game.rendererCore.scene.add(inst); } catch {}
    }
    // Ensure any components on objects get instantiated (NavMesh/NavLink etc)
    const created = [];
    root.traverse(async (o) => {
      const ud = o.userData || {};
      const comps = this._extractComponentsFromUserData(ud);
      for (const c of comps) {
        try {
          try {
            const t = (c?.type || "").toString().toLowerCase();
            if (t === "player" && !this._playerDetectedLogged) {
              this._playerDetectedLogged = true;
              console.warn("[SceneLoader] Player component detected via userData", { objectName: o?.name || "(unnamed)" });
            }
          } catch {}
          const ctor = (c.type && (await this._resolveComponentCtor(c.type))) || null;
          if (!ctor) {
            const t = (c?.type || "").toString();
            if (!this._missingCtorWarned.has(t)) {
              this._missingCtorWarned.add(t);
              try { console.warn("[SceneLoader] Component ctor not found", { type: t }); } catch {}
            }
            continue;
          }
          const instance = new ctor({ game: this.game, object: o, options: c.params, propName: c.type });
          if (instance) {
            try { o.__components = o.__components || []; o.__components.push(instance); } catch {}
            this.game.addComponent(instance);
            created.push(instance);
          }
          if (instance && typeof instance.Initialize === "function") {
            await Promise.resolve(instance.Initialize());
          }
        } catch {}
      }
    });
  }

  _buildInstancedMeshes(root) {
    if (!root) return;
    const groups = new Map(); // key -> { geo, mat, items: [] }
    const tmpMatrix = new Matrix4();
    const isColliderName = (n) => /^(COL_|UCX_|UBX_)/i.test(String(n || ""));
    root.updateWorldMatrix(true, true);
    root.traverse((o) => {
      if (!o || !o.isMesh) return;
      const ud = o.userData || {};
      const instKey = ud.__instKey || null;
      if (!instKey) return;
      // Skip if looks like a collider or has physics config
      if (isColliderName(o.name)) return;
      if (ud.physics || ud["physics.collider"] || ud["physics.rigidbody"]) return;
      const geo = o.geometry;
      const mat = o.material;
      if (!geo || !mat) return;
      const key = `${instKey}|${geo.uuid}|${Array.isArray(mat) ? mat.map(m => m.uuid).join(",") : mat.uuid}`;
      if (!groups.has(key)) groups.set(key, { geo, mat, items: [] });
      groups.get(key).items.push(o);
    });
    for (const [key, g] of groups.entries()) {
      const items = g.items || [];
      if (items.length <= 1) continue;
      // Create instanced mesh at scene root; bake world matrices per instance
      const count = items.length;
      const instanced = new InstancedMesh(g.geo, g.mat, count);
      for (let i = 0; i < count; i++) {
        const mesh = items[i];
        mesh.updateWorldMatrix(true, false);
        tmpMatrix.copy(mesh.matrixWorld);
        instanced.setMatrixAt(i, tmpMatrix);
      }
      try { instanced.instanceMatrix.needsUpdate = true; } catch {}
      try { this.game.rendererCore.scene.add(instanced); } catch {}
      // Hide/remove originals
      for (const mesh of items) {
        try {
          if (mesh.parent) mesh.parent.remove(mesh);
          else mesh.visible = false;
        } catch {}
      }
    }
  }

  _extractComponentsFromUserData(ud) {
    const out = [];
    if (!ud || typeof ud !== "object") return out;
    const add = (type, params) => { if (type) out.push({ type: String(type), params: params ?? undefined }); };
    const getCI = (obj, key) => {
      // case-insensitive lookup for a direct key
      if (!obj || typeof obj !== "object") return undefined;
      if (Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];
      const lower = String(key).toLowerCase();
      for (const k of Object.keys(obj)) {
        if (String(k).toLowerCase() === lower) return obj[k];
      }
      return undefined;
    };

    // Numbered components: component2, component_2, script2, script_2
    const numbered = {};
    for (const [k, v] of Object.entries(ud)) {
      const m = /^component(?:_|)(\d+)$/i.exec(k) || /^script(?:_|)(\d+)$/i.exec(k);
      if (!m) continue;
      const idx = parseInt(m[1], 10);
      if (!idx || idx < 2) continue; // reserve #1 for plain 'component'
      if (typeof v === "string") {
        numbered[idx] = { type: v, params: undefined };
      } else if (v && typeof v === "object") {
        numbered[idx] = { type: v.type || v.name, params: v.params ?? v.options ?? v.props };
      }
    }
    // Collect per-index parameter overrides from suffixed keys: speed2 / speed_2
    const perIndexParams = {};
    const suffixRx = /(.*?)(?:_|)(\d+)$/;
    for (const [k, v] of Object.entries(ud)) {
      const m = suffixRx.exec(k);
      if (!m) continue;
      const base = m[1];
      const idx = parseInt(m[2], 10);
      if (!idx || idx < 2) continue;
      if (!(idx in perIndexParams)) perIndexParams[idx] = {};
      perIndexParams[idx][base] = v;
    }
    // Emit numbered components with collected params
    for (const [idxStr, def] of Object.entries(numbered)) {
      const idx = parseInt(idxStr, 10);
      const overrides = perIndexParams[idx] || {};
      const expanded = expandDotted(overrides);
      add(def.type, expanded && Object.keys(expanded).length ? expanded : def.params);
    }

    // First (un-numbered) component: support plain keys as params if not provided via options/params/props
    const firstType = getCI(ud, "component") || getCI(ud, "script");
    if (firstType) {
      let firstParams = getCI(ud, "options") ?? getCI(ud, "params") ?? getCI(ud, "props");
      if (!firstParams || typeof firstParams !== "object") {
        const reservedExact = new Set(["component", "script", "components"]);
        const reservedPrefix = ["comp.", "c_"];
        // derive from unsuffixed keys that aren't reserved or numbered
        const derived = {};
        for (const [k, v] of Object.entries(ud)) {
          if (reservedExact.has(k)) continue;
          if (reservedPrefix.some(p => k.startsWith(p))) continue;
          if (suffixRx.test(k)) continue; // has numeric suffix -> belongs to numbered component
          derived[k] = v;
        }
        const expanded = expandDotted(derived);
        firstParams = expanded && Object.keys(expanded).length ? expanded : undefined;
      }
      add(firstType, firstParams);
    }

    // Multiple components: array or JSON string
    let comps = ud.components;
    if (typeof comps === "string") {
      try { comps = JSON.parse(comps); } catch { /* ignore */ }
    }
    if (Array.isArray(comps)) {
      for (const c of comps) {
        if (typeof c === "string") add(c);
        else if (c && typeof c === "object") add(c.type || c.name, c.params ?? c.options ?? c.props);
      }
    }

    // Prefixed keys: comp.* or c_*
    for (const [k, v] of Object.entries(ud)) {
      if (!k.startsWith("comp.") && !k.startsWith("c_")) continue;
      const type = k.replace(/^comp\.|^c_/, "");
      if (v === true) add(type);
      else if (typeof v === "string") {
        try { add(type, JSON.parse(v)); } catch { add(type); }
      } else if (v && typeof v === "object") add(type, v);
    }

    return out;
  }

  _reportProgress(fileIdx, fileFrac, totalFiles, url) {
    const frac = Math.max(0, Math.min(1, (fileIdx + fileFrac) / Math.max(1, totalFiles)));
    if (this.game?.loading) {
      this.game.loading.setMessage(`Loading ${url} (${Math.round(frac * 100)}%)`);
      this.game.loading.setProgress(frac);
    }
  }

  _applyTransform(object3D, t) {
    if (Array.isArray(t.position)) object3D.position.fromArray(t.position);
    if (Array.isArray(t.rotationEuler)) {
      const [rx, ry, rz] = t.rotationEuler;
      object3D.rotation.set((rx * Math.PI) / 180, (ry * Math.PI) / 180, (rz * Math.PI) / 180);
    }
    if (typeof t.scale === "number") object3D.scale.setScalar(t.scale);
    else if (Array.isArray(t.scale)) object3D.scale.fromArray(t.scale);

    if (typeof t.fitHeight === "number" && t.fitHeight > 0) {
      const bounds = new Box3().setFromObject(object3D);
      const size = new Vector3();
      bounds.getSize(size);
      const current = size.y || 1;
      const s = t.fitHeight / current;
      object3D.scale.multiplyScalar(s);
      if (t.anchorToGround) {
        const min = bounds.min.clone();
        object3D.position.y += -min.y * s;
      }
    } else if (t.anchorToGround) {
      const bounds = new Box3().setFromObject(object3D);
      const min = bounds.min.clone();
      object3D.position.y += -min.y;
    }
  }

  _processNamingConventions(root) {
    // Ensure world matrices are current
    root.updateWorldMatrix(true, true);
    // Initialize property maps
    this.game.sceneVolumes = this.game.sceneVolumes || [];
    this.game.sceneProperties = this.game.sceneProperties || {}; // key: propName, value: Object3D[]
    this.game.sceneIds = this.game.sceneIds || {}; // legacy/back-compat map

    // Properties via name-based tag (prop:Name or prop=Name)
    root.traverse((o) => {
      const name = o.name || "";
      // Name tag, e.g., "some empty prop:feature-showcase" or "[prop=fpsController]"
      const mName = name && name.match(/(?:^|[\\s\\[\\(])prop\\s*[:=]\\s*([A-Za-z0-9_\\-]+)/i);
      if (mName && mName[1]) {
        const propFromName = mName[1];
        if (!this.game.sceneProperties[propFromName]) this.game.sceneProperties[propFromName] = [];
        this.game.sceneProperties[propFromName].push(o);
        // back-compat population
        if (!this.game.sceneIds[propFromName]) this.game.sceneIds[propFromName] = [];
        this.game.sceneIds[propFromName].push(o);
      }
    });
  }

  async _instantiateProperties({ mapping, baseUrl }) {
    if (!mapping || typeof mapping !== "object") mapping = {};
    const resolveUrl = (u) => (u && u.startsWith("http") ? u : `${baseUrl.replace(/\/$/, "")}/${u}`);
    const created = [];
    const idsMap = this.game.sceneProperties || this.game.sceneIds || {};

    for (const [idName, defs] of Object.entries(mapping)) {
      const targets = Array.isArray(idsMap[idName]) ? idsMap[idName] : [];
      if (!targets.length) continue;

      const defArray = Array.isArray(defs) ? defs : [defs];
      for (const def of defArray) {
        let scriptUrl = null;
        let options = undefined;
        if (typeof def === "string") {
          scriptUrl = def;
        } else if (def && typeof def === "object") {
          scriptUrl = def.script || def.url || def.path || null;
          options = def.options ?? def.params ?? def.props;
        }
        if (!scriptUrl) continue;

        let mod = null;
        try {
          mod = await import(resolveUrl(scriptUrl));
        } catch (e) {
          console.warn("Failed to import property script for ID:", idName, scriptUrl, e);
          continue;
        }

        for (const obj of targets) {
          try {
            let instance = null;
            // Support several authoring styles
            const DefaultExport = mod?.default;
            const CreateFn = mod?.create;
            const ComponentCtor = mod?.Component;
            try {
              const isPlayerLike =
                (typeof DefaultExport === "function" && (DefaultExport.name || "").toLowerCase() === "player") ||
                (typeof ComponentCtor === "function" && (ComponentCtor.name || "").toLowerCase() === "player");
              if (isPlayerLike) {
                console.info("[SceneLoader] Player component detected via properties mapping", { idName, objectName: obj?.name || "(unnamed)" });
              }
            } catch {}
            if (typeof DefaultExport === "function") {
              // Try as a class first, then as factory
              try {
                instance = new DefaultExport({ game: this.game, object: obj, options, idName });
              } catch {
                instance = DefaultExport(this.game, obj, options, idName);
              }
            } else if (typeof ComponentCtor === "function") {
              instance = new ComponentCtor({ game: this.game, object: obj, options, idName });
            } else if (typeof CreateFn === "function") {
              instance = CreateFn(this.game, obj, options, idName);
            }
            // Optional lifecycle hooks: prefer Initialize, then init
            if (instance) {
              instance.__idName = idName;
              instance.__object = obj;
              instance.__scriptUrl = scriptUrl;
              try { obj.__components = obj.__components || []; obj.__components.push(instance); } catch {}
              if (this.game.addComponent) this.game.addComponent(instance);
              else this.game.componentInstances.push(instance);
              created.push(instance);
            }
            if (instance && typeof instance.Initialize === "function") {
              await Promise.resolve(instance.Initialize(this.game, obj, options));
            } else if (typeof mod?.Initialize === "function") {
              await Promise.resolve(mod.Initialize(this.game, obj, options));
            } else if (instance && typeof instance.init === "function") {
              await Promise.resolve(instance.init(this.game, obj, options));
            } else if (typeof mod?.init === "function") {
              await Promise.resolve(mod.init(this.game, obj, options));
            }
          } catch (e) {
            console.warn("Failed to instantiate property for ID:", idName, scriptUrl, e);
          }
        }
      }
    }

    return created;
  }

  _extractSceneMappingFromRoot(root) {
    if (!root || !root.userData || typeof root.userData !== "object") return null;
    const ud = root.userData || {};
    // Preferred nested: scene: { properties | components | idScripts | idComponents }
    const nested = ud.scene;
    if (nested && typeof nested === "object") {
      return nested.properties || nested.components || nested.idScripts || nested.idComponents || null;
    }
    // Fallback: allow top-level keys on root userData
    return ud.properties || ud.components || ud.idScripts || ud.idComponents || null;
  }

  // -----------------------------
  // Physics authoring via userData/naming
  // -----------------------------
  _applyPhysicsFromUserData(root) {
    const physics = this.game?.physics;
    if (!physics || !root) return;
    const get = (ud, keys) => {
      for (const k of keys) {
        if (ud && Object.prototype.hasOwnProperty.call(ud, k)) return ud[k];
      }
      return undefined;
    };
    const truthy = (v) => v === true || v === "true" || v === 1 || v === "1";
    const hasPrefix = (obj, prefix) => {
      try {
        const keys = Object.keys(obj || {});
        for (let i = 0; i < keys.length; i++) if (String(keys[i]).startsWith(prefix)) return true;
      } catch {}
      return false;
    };
    const gatherWithPrefix = (obj, prefix) => {
      const out = {};
      try {
        for (const [k, v] of Object.entries(obj || {})) {
          if (!String(k).startsWith(prefix)) continue;
          const tail = String(k).substring(prefix.length);
          const key = tail.replace(/^\./, "");
          if (key) out[key] = v;
        }
      } catch {}
      return out;
    };
    const toNumberArray = (v) => {
      if (Array.isArray(v)) return v.map(Number);
      if (typeof v === "string") {
        try { const a = JSON.parse(v); if (Array.isArray(a)) return a.map(Number); } catch {}
      }
      return undefined;
    };

    // Collect joints to create after bodies
    const jointDefs = [];

    root.updateWorldMatrix(true, true);

    root.traverse((o) => {
      const name = o.name || "";
      const ud = o.userData || {};

      // ----- RigidBody via extras -----
      // Accept:
      // - ud.physics.rigidbody = { type, mass, shape, friction, restitution, linearDamping, angularDamping }
      // - dotted: physics.rigidbody.type, physics.rigidbody.mass, ...
      // - fallback: physics.type/shape, or top-level rigidbody object
      let rbObj = (ud.physics && typeof ud.physics.rigidbody === "object") ? ud.physics.rigidbody : undefined;
      if (!rbObj && hasPrefix(ud, "physics.rigidbody")) {
        rbObj = gatherWithPrefix(ud, "physics.rigidbody");
      }
      if (!rbObj && ud.rigidbody && typeof ud.rigidbody === "object") {
        rbObj = ud.rigidbody;
      }
      // Also allow type/shape placed under physics.* directly
      const rbType =
        (rbObj && rbObj.type) ||
        get(ud, ["physics.type", "physicsType", "RigidBodyType"]);
      const rbShape =
        (rbObj && (rbObj.shape || rbObj.collider)) ||
        get(ud, ["physics.shape", "physics.collider", "physics.collision"]);

      if (rbObj || rbType || rbShape) {
        const typeStr = String((rbObj && rbObj.type) || rbType || "dynamic").toLowerCase();
        const shapeStr = String((rbObj && (rbObj.shape || rbObj.collider)) || rbShape || ud.collider || "box").toLowerCase();
        const mass = (rbObj && typeof rbObj.mass === "number") ? rbObj.mass : undefined;
        const friction = (rbObj && typeof rbObj.friction === "number") ? rbObj.friction : get(ud, ["physics.friction"]);
        const restitution = (rbObj && typeof rbObj.restitution === "number") ? rbObj.restitution : get(ud, ["physics.restitution"]);
        const linearDamping = (rbObj && typeof rbObj.linearDamping === "number") ? rbObj.linearDamping : get(ud, ["physics.linearDamping"]);
        const angularDamping = (rbObj && typeof rbObj.angularDamping === "number") ? rbObj.angularDamping : get(ud, ["physics.angularDamping"]);
        const mergeChildren = get(ud, ["mergeChildren"]) ?? ud?.physics?.mergeChildren ?? ud["physics.mergeChildren"];
        // Collision filters
        const layer = (rbObj && typeof rbObj.layer === "number") ? rbObj.layer : get(ud, ["physics.layer"]);
        let mask = (rbObj && rbObj.mask != null) ? rbObj.mask : get(ud, ["physics.mask"]);
        if (typeof mask === "string") {
          // allow "1|2|4" or "[1,2,4]"
          if (mask.includes("|")) {
            mask = mask.split("|").map(s => Number(s.trim())).reduce((a, b) => (a | b), 0);
          } else {
            try { mask = JSON.parse(mask); } catch {}
          }
        }
        const size = rbObj?.size ?? get(ud, ["physics.size"]);
        const radius = (typeof rbObj?.radius === "number") ? rbObj.radius : get(ud, ["physics.radius"]);
        const height = (typeof rbObj?.height === "number") ? rbObj.height : get(ud, ["physics.height"]);
        const center = rbObj?.center ?? get(ud, ["physics.center"]);

        try {
          physics.addRigidBodyForObject(o, {
            shape: shapeStr,
            type: typeStr,
            mass,
            friction,
            restitution,
            linearDamping,
            angularDamping,
            mergeChildren: mergeChildren !== false,
            layer: (typeof layer === "number") ? layer : undefined,
            mask: (Array.isArray(mask) || typeof mask === "number") ? mask : undefined,
            size: Array.isArray(size) ? toNumberArray(size) : undefined,
            radius: (typeof radius === "number") ? radius : undefined,
            height: (typeof height === "number") ? height : undefined,
            center: Array.isArray(center) ? toNumberArray(center) : undefined,
          });
          // If this object is a helper collider by name, hide it unless explicitly visible
          if (/^(COL_|UCX_|UBX_)/i.test(name) && o.visible) {
            const vis = truthy(get(ud, ["colliderVisible", "collisionVisible"])) || truthy(ud?.physics?.visible) || truthy(ud["physics.visible"]);
            o.visible = !!vis;
          }
        } catch (e) {
          console.warn("Failed to create rigidbody for", o.name, e);
        }
        // Do not also create a static collider when rigidbody present
        // continue to allow joint authoring on same object
      }

      // Name-based collider conventions: COL_* or UCX_/UBX_ like Unreal
      const nameSaysCollider = /^(COL_|UCX_|UBX_)/i.test(name);

      // Extras-based collider specification
      const colliderType =
        get(ud, ["collider", "Collider", "collision", "Collision"]) ||
        (ud.physics && (ud.physics.collider || ud.physics.collision)) ||
        ud["physics.collider"] || ud["physics.collision"];

      const colliderEnabled =
        nameSaysCollider ||
        truthy(get(ud, ["isCollider", "IsCollider"])) ||
        truthy(get(ud, ["collision", "Collision"])) ||
        (typeof colliderType === "string") ||
        truthy(get(ud, ["collider", "Collider"])) ||
        truthy(ud?.physics?.collider) ||
        truthy(ud?.physics?.collision) ||
        truthy(ud["physics.collider"]) ||
        truthy(ud["physics.collision"]);

      if (!colliderEnabled) return;

      // Normalize collider type; support convex, mesh, box, sphere, capsule for static colliders
      let typeStr = typeof colliderType === "string" ? String(colliderType).toLowerCase() : "convex";
      const typeAlias = {
        convex: "convex",
        collider: "convex",
        collision: "convex",
        mesh: "mesh",
        box: "box",
        sphere: "sphere",
        capsule: "capsule",
      };
      const normalized = typeAlias[typeStr] || "convex";
      const visible =
        truthy(get(ud, ["colliderVisible", "collisionVisible"])) ||
        truthy(ud?.physics?.visible) ||
        truthy(ud["physics.visible"]) ||
        false;
      const mergeChildren =
        get(ud, ["mergeChildren"]) ?? ud?.physics?.mergeChildren ?? ud["physics.mergeChildren"];

      // Warn only for unknown/unsupported types; known aliases silently map
      if (!(typeStr in typeAlias)) {
        if (!(typeStr in typeAlias)) {
          try { console.warn(`Collider type '${typeStr}' not recognized; using convex for`, o.name); } catch {}
        }
      }

      if (normalized === "mesh") {
        physics.addMeshColliderForObject(o, {
          mergeChildren: mergeChildren !== false && !nameSaysCollider ? true : false,
          visible,
        });
      } else if (normalized === "box") {
        physics.addBoxColliderForObject(o, {
          visible,
        });
      } else if (normalized === "sphere") {
        physics.addSphereColliderForObject(o, {
          visible,
        });
      } else if (normalized === "capsule") {
        physics.addCapsuleColliderForObject(o, {
          visible,
        });
      } else {
        physics.addConvexColliderForObject(o, {
          mergeChildren: mergeChildren !== false && !nameSaysCollider ? true : false,
          visible,
        });
      }

      // Optionally hide explicit collider helper meshes by name
      if (nameSaysCollider && o.visible) {
        try { o.visible = !!visible; } catch {}
      }

      // --------- Joint collection (deferred) ----------
      // Accept nested array at ud.physics.joint(s) or dotted physics.joint.N
      let jointsNested = undefined;
      if (ud.physics && (Array.isArray(ud.physics.joints) || Array.isArray(ud.physics.joint))) {
        jointsNested = Array.isArray(ud.physics.joints) ? ud.physics.joints : ud.physics.joint;
      }
      const jointsFromDots = [];
      if (hasPrefix(ud, "physics.joint")) {
        const flat = gatherWithPrefix(ud, "physics.joint");
        // Expect keys like "0", "1.type", "1.anchorA", etc.
        const buckets = {};
        for (const [k, v] of Object.entries(flat)) {
          const m = /^(\d+)(?:\.|$)(.*)$/.exec(String(k));
          if (!m) continue;
          const idx = m[1];
          const key = m[2] || "";
          if (!buckets[idx]) buckets[idx] = {};
          if (key) buckets[idx][key] = v;
        }
        for (const idx of Object.keys(buckets)) jointsFromDots.push(buckets[idx]);
      }
      const combined = [
        ...(Array.isArray(jointsNested) ? jointsNested : []),
        ...jointsFromDots
      ];
      for (const jd of combined) {
        if (!jd || typeof jd !== "object") continue;
        const type = String(jd.type || jd.kind || "").toLowerCase();
        if (!type) continue;
        const aName = jd.a || jd.objectA || jd.bodyA || null;
        const bName = jd.b || jd.objectB || jd.bodyB || null;
        jointDefs.push({
          source: o,
          type,
          aName,
          bName,
          def: jd
        });
      }
    });

    // Resolve and add joints
    const byName = new Map();
    try {
      root.traverse((obj) => { if (obj && obj.name) byName.set(obj.name, obj); });
    } catch {}
    for (const j of jointDefs) {
      const a = (typeof j.aName === "string" && byName.get(j.aName)) || j.source;
      const b = (typeof j.bName === "string" && byName.get(j.bName)) || j.source.parent || null;
      if (!a || !b) continue;
      try {
        const d = j.def || {};
        switch (j.type) {
          case "p2p":
          case "point":
          case "ball":
            physics.addPointToPointJoint(a, b, {
              anchorA: toNumberArray(d.anchorA) || [0, 0, 0],
              anchorB: toNumberArray(d.anchorB) || [0, 0, 0],
            });
            break;
          case "hinge":
            physics.addHingeJoint(a, b, {
              anchorA: toNumberArray(d.anchorA) || [0, 0, 0],
              anchorB: toNumberArray(d.anchorB) || [0, 0, 0],
              axisA: toNumberArray(d.axisA) || [0, 1, 0],
              axisB: toNumberArray(d.axisB) || [0, 1, 0],
              limits: Array.isArray(d.limits) ? d.limits : undefined,
            });
            break;
          case "slider":
            physics.addSliderJoint(a, b, {
              frameA: d.frameA || {},
              frameB: d.frameB || {},
              linearLimits: Array.isArray(d.linearLimits) ? d.linearLimits : undefined,
              angularLimits: Array.isArray(d.angularLimits) ? d.angularLimits : undefined,
            });
            break;
          case "fixed":
            physics.addFixedJoint(a, b);
            break;
          case "cone":
          case "conetwist":
            physics.addConeTwistJoint(a, b, {
              frameA: d.frameA || {},
              frameB: d.frameB || {},
              limits: d.limits || undefined,
            });
            break;
        }
      } catch (e) {
        console.warn("Failed to create joint:", j.type, e);
      }
    }
  }
}

// -----------------------------
// Texture quantization helpers
// -----------------------------

export function estimatePaletteBytes(numColors) {
  const clamped = Math.max(1, Math.min(256, numColors | 0));
  return clamped * 4; // RGBA palette entries
}

export function chooseBppForColors(numColors) {
  if (numColors <= 16) return 4; // 4bpp
  return 8; // 8bpp
}

export function quantizationPlan({ width, height, numColors }) {
  const bpp = chooseBppForColors(numColors);
  const paletteBytes = estimatePaletteBytes(numColors);
  const pixelsBytes = (width * height * bpp) / 8;
  return { bpp, paletteBytes, pixelsBytes, totalBytes: pixelsBytes + paletteBytes };
}

// -----------------------------
// Color helpers
// -----------------------------
export function normalizeHexColor(input) {
  try {
    if (input == null) return 0xffffff;
    if (typeof input === "number") return input;
    let s = String(input).trim();
    if (!s) return 0xffffff;
    if (s.startsWith("#")) s = s.slice(1);
    if (s.toLowerCase().startsWith("0x")) s = s.slice(2);
    s = s.replace(/[^0-9a-f]/gi, "").slice(0, 6);
    if (s.length === 3) {
      // expand #abc -> #aabbcc
      s = s.split("").map(ch => ch + ch).join("");
    }
    if (s.length < 6) s = s.padStart(6, "0");
    return parseInt(s, 16);
  } catch {
    return 0xffffff;
  }
}
