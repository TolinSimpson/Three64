import * as THREE from "https://unpkg.com/three@0.161.0/build/three.module.js";
import { GLTFLoader } from "https://unpkg.com/three@0.161.0/examples/jsm/loaders/GLTFLoader.js";
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

  async load(url) {
    const gltf = await this._loadAsync(url);

    const root = gltf.scene || gltf.scenes?.[0];
    if (!root) return { scene: new THREE.Group(), stats: { tris: 0, meshes: 0 } };

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
      tex.minFilter = THREE.NearestFilter;
      tex.magFilter = THREE.NearestFilter;
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
        color: m.color?.clone?.() || new THREE.Color(0xffffff),
        map: m.map || null,
        fog: true,
        transparent: m.transparent === true,
      };
      const newMat = m.map ? new THREE.MeshBasicMaterial(params) : new THREE.MeshLambertMaterial(params);
      return newMat;
    });
    return Array.isArray(material) ? patched : patched[0];
  }

  _loadAsync(url) {
    return new Promise((resolve, reject) => {
      this.loader.load(url, resolve, undefined, reject);
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
    for (const entry of assets) {
      if (entry.type === "gltf") {
        const { scene: root } = await this.loader.load(resolveUrl(entry.url));
        this._applyTransform(root, entry.transform || {});
        this.game.rendererCore.scene.add(root);
        // Naming convention processing (LOD, COL_, etc.)
        this._processNamingConventions(root);
        // Instantiate components from userData
        this._instantiateFromUserData(root);
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
        const color = new THREE.Color(entry.color ?? 0xffffff);
        const intensity = entry.intensity ?? 1.0;
        let light;
        if (entry.kind === "directional") {
          light = new THREE.DirectionalLight(color, intensity);
          if (entry.position) light.position.fromArray(entry.position);
        } else if (entry.kind === "ambient") {
          light = new THREE.AmbientLight(color, intensity);
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

    for (const entry of manifest.assets || []) {
      if (entry.type === "gltf") {
        const { scene: root } = await this.loader.load(resolveUrl(entry.url));
        this._applyTransform(root, entry.transform || {});
        this.game.rendererCore.scene.add(root);
        this._processNamingConventions(root);
        // Instantiate components from userData
        this._instantiateFromUserData(root);
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
        const color = new THREE.Color(entry.color ?? 0xffffff);
        const intensity = entry.intensity ?? 1.0;
        let light;
        if (entry.kind === "directional") {
          light = new THREE.DirectionalLight(color, intensity);
          if (entry.position) light.position.fromArray(entry.position);
        } else if (entry.kind === "ambient") {
          light = new THREE.AmbientLight(color, intensity);
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

  _instantiateFromUserData(root) {
    if (!root) return;
    root.traverse((obj) => {
      const defs = this._extractComponentsFromUserData(obj.userData || {});
      if (!defs || !defs.length) return;
      for (const def of defs) {
        const C = ComponentRegistry.get(def.type);
        if (!C) { console.warn("Unknown component:", def.type, "on", obj.name); continue; }
        let instance = null;
        try {
          instance = new C({ game: this.game, object: obj, options: def.params, propName: def.type });
        } catch (e) {
          try {
            instance = C?.({ game: this.game, object: obj, options: def.params, propName: def.type });
          } catch (e2) {
            console.warn("Failed to create component instance:", def.type, e2);
          }
        }
        if (!instance) continue;
        try {
          if (typeof instance.Initialize === "function") instance.Initialize(this.game, obj, def.params);
        } catch (e) {
          console.warn("Component Initialize() threw:", def.type, e);
        }
        instance.__typeName = def.type;
        obj.__components = obj.__components || [];
        obj.__components.push(instance);
        this.game.componentInstances.push(instance);
      }
    });
  }

  _extractComponentsFromUserData(ud) {
    const out = [];
    if (!ud || typeof ud !== "object") return out;
    const add = (type, params) => { if (type) out.push({ type: String(type), params: params ?? undefined }); };

    // Single component convenience
    if (ud.component || ud.script) {
      add(ud.component || ud.script, ud.options ?? ud.params ?? ud.props);
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

  _applyTransform(object3D, t) {
    if (Array.isArray(t.position)) object3D.position.fromArray(t.position);
    if (Array.isArray(t.rotationEuler)) {
      const [rx, ry, rz] = t.rotationEuler;
      object3D.rotation.set(THREE.MathUtils.degToRad(rx), THREE.MathUtils.degToRad(ry), THREE.MathUtils.degToRad(rz));
    }
    if (typeof t.scale === "number") object3D.scale.setScalar(t.scale);
    else if (Array.isArray(t.scale)) object3D.scale.fromArray(t.scale);

    if (typeof t.fitHeight === "number" && t.fitHeight > 0) {
      const bounds = new THREE.Box3().setFromObject(object3D);
      const size = new THREE.Vector3();
      bounds.getSize(size);
      const current = size.y || 1;
      const s = t.fitHeight / current;
      object3D.scale.multiplyScalar(s);
      if (t.anchorToGround) {
        const min = bounds.min.clone();
        object3D.position.y += -min.y * s;
      }
    } else if (t.anchorToGround) {
      const bounds = new THREE.Box3().setFromObject(object3D);
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
