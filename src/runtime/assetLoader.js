'use strict';
import {
  Group,
  Color,
  MeshBasicMaterial,
  MeshLambertMaterial,
  NearestFilter,
  Box3,
  Vector3,
  DirectionalLight,
  AmbientLight,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { fitsInTMEM} from "./engine.js";
import { BudgetTracker } from "./debug.js";
import { ComponentRegistry } from "./component.js";
import { loadJSON } from "./io.js";
import { Scene } from "./scene.js";

// -----------------------------
// GLTF asset loader
// -----------------------------

export class GLTFAssetLoader {
  constructor(budgetTracker = new BudgetTracker()) {
    this.loader = new GLTFLoader();
    this.budget = budgetTracker;
  }

  async load(url, onProgress = undefined) {
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

        const patched = this._patchMaterial(obj.material);
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
      const fits = fitsInTMEM({ width, height, bpp, paletteBytes });
      if (!fits) {
        const bytes = (width * height * bpp) / 8 + paletteBytes;
        const tiles = Math.ceil(bytes / (editorConfig.budgets.tmemBytes || 1));
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

  _patchMaterial(material) {
    const mats = Array.isArray(material) ? material : [material];
    const patched = mats.map((m) => {
      if (!m) return m;
      const params = {
        color: m.color?.clone?.() || new Color(0xffffff),
        map: m.map || null,
        fog: true,
        transparent: m.transparent === true,
      };
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
    this.loader = new GLTFAssetLoader(this.game?.budget);
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
        // Instantiate components from userData
        await this._instantiateFromUserData(root, baseUrl);
        // If GLTF root carries scene-level mappings, instantiate them
        const sceneMapping = this._extractSceneMappingFromRoot(root);
        if (sceneMapping) {
          await this._instantiateProperties({ mapping: sceneMapping, baseUrl });
        }
        if (entry.physics && this.game.physics) {
          if (entry.physics.collider === "convex") {
            this.game.physics.addConvexColliderForObject(root, {
              mergeChildren: entry.physics.mergeChildren !== false,
              visible: entry.physics.visible === true,
            });
          }
        }
        added.push(root);
      } else if (entry.type === "light") {
      const color = new Color(entry.color ?? 0xffffff);
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
        // Instantiate components from userData
        await this._instantiateFromUserData(root, baseUrl);
        // Scene-level mappings on GLTF root
        const sceneMapping = this._extractSceneMappingFromRoot(root);
        if (sceneMapping) {
          await this._instantiateProperties({ mapping: sceneMapping, baseUrl });
        }
        if (entry.physics && this.game.physics) {
          if (entry.physics.collider === "convex") {
            this.game.physics.addConvexColliderForObject(root, {
              mergeChildren: entry.physics.mergeChildren !== false,
              visible: entry.physics.visible === true,
            });
          }
        }
        added.push(root);
      } else if (entry.type === "light") {
        const color = new Color(entry.color ?? 0xffffff);
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
    this._componentPresetCache = this._componentPresetCache || new Map();
    const normalize = (s) => String(s || "").replace(/[\s\-_]/g, "").toLowerCase();
    const mergeDeep = (target, source) => {
      if (!source || typeof source !== "object") return target;
      const out = Array.isArray(target) ? target.slice() : { ...(target || {}) };
      for (const [k, v] of Object.entries(source)) {
        if (v && typeof v === "object" && !Array.isArray(v)) {
          out[k] = mergeDeep(out[k] && typeof out[k] === "object" ? out[k] : {}, v);
        } else {
          out[k] = v;
        }
      }
      return out;
    };
    const expandDotted = (flat) => {
      if (!flat || typeof flat !== "object" || Array.isArray(flat)) return flat;
      const out = {};
      const axisToIndex = { x: 0, y: 1, z: 2, w: 3 };
      const setPath = (obj, segments, value) => {
        if (!segments.length) return;
        const [headRaw, ...rest] = segments;
        const headLower = String(headRaw).toLowerCase();
        const idxFromAxis = axisToIndex.hasOwnProperty(headLower) ? axisToIndex[headLower] : null;
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
    };
    const getDefaultsForType = async (type) => {
      const key = normalize(type);
      if (this._componentPresetCache.has(key)) return this._componentPresetCache.get(key);
      let defaults = {};
      const C = ComponentRegistry.get(type);
      try {
        if (C && typeof C.getDefaultParams === "function") {
          const d = C.getDefaultParams();
          if (d && typeof d === "object") defaults = d;
        } else if (C && C.defaultParams && typeof C.defaultParams === "object") {
          defaults = C.defaultParams;
        }
      } catch {}
      // Fallback: try loading generated preset JSON
      if (!defaults || typeof defaults !== "object" || Object.keys(defaults).length === 0) {
        try {
          const urlBase = baseUrl || new URL("build/assets/", document.baseURI).href;
          const presetUrl = new URL(`component-data/${key}.json`, urlBase).toString();
          const preset = await loadJSON(presetUrl);
          const params = preset?.params;
          if (params && typeof params === "object") defaults = params;
        } catch {}
      }
      this._componentPresetCache.set(key, defaults || {});
      return defaults || {};
    };
    const queue = [];
    root.traverse((obj) => {
      const defs = this._extractComponentsFromUserData(obj.userData || {});
      if (!defs || !defs.length) return;
      for (const def of defs) queue.push({ obj, def });
    });
    for (const { obj, def } of queue) {
      const C = ComponentRegistry.get(def.type);
      if (!C) { console.warn("Unknown component:", def.type, "on", obj.name); continue; }
      const defaults = await getDefaultsForType(def.type);
      const merged = mergeDeep(defaults || {}, def.params || {});
      let instance = null;
      try {
        instance = new C({ game: this.game, object: obj, options: merged, propName: def.type });
      } catch (e) {
        try {
          instance = C?.({ game: this.game, object: obj, options: merged, propName: def.type });
        } catch (e2) {
          console.warn("Failed to create component instance:", def.type, e2);
        }
      }
      if (!instance) continue;
      try {
        if (typeof instance.Initialize === "function") instance.Initialize(this.game, obj, merged);
      } catch (e) {
        console.warn("Component Initialize() threw:", def.type, e);
      }
      instance.__typeName = def.type;
      obj.__components = obj.__components || [];
      obj.__components.push(instance);
      this.game.componentInstances.push(instance);
    }
  }

  _extractComponentsFromUserData(ud) {
    const out = [];
    if (!ud || typeof ud !== "object") return out;
    const add = (type, params) => { if (type) out.push({ type: String(type), params: params ?? undefined }); };

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
    const firstType = ud.component || ud.script;
    if (firstType) {
      let firstParams = ud.options ?? ud.params ?? ud.props;
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
            if (instance && typeof instance.Initialize === "function") {
              await Promise.resolve(instance.Initialize(this.game, obj, options));
            } else if (typeof mod?.Initialize === "function") {
              await Promise.resolve(mod.Initialize(this.game, obj, options));
            } else if (instance && typeof instance.init === "function") {
              await Promise.resolve(instance.init(this.game, obj, options));
            } else if (typeof mod?.init === "function") {
              await Promise.resolve(mod.init(this.game, obj, options));
            }
            if (instance) {
              instance.__idName = idName;
              instance.__object = obj;
              instance.__scriptUrl = scriptUrl;
              this.game.componentInstances.push(instance);
              created.push(instance);
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
