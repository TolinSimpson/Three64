import * as THREE from "https://unpkg.com/three@0.161.0/build/three.module.js";
import { OrbitControls } from "https://unpkg.com/three@0.161.0/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "https://unpkg.com/three@0.161.0/examples/jsm/controls/TransformControls.js";
import { GLTFLoader } from "https://unpkg.com/three@0.161.0/examples/jsm/loaders/GLTFLoader.js";
import { GLTFExporter } from "https://unpkg.com/three@0.161.0/examples/jsm/exporters/GLTFExporter.js";

const state = {
  renderer: null,
  scene: null,
  camera: null,
  controls: null,
  transform: null,
  raycaster: new THREE.Raycaster(),
  mouse: new THREE.Vector2(),
  loader: new GLTFLoader(),
  exporter: new GLTFExporter(),
  canvas: null,
  rootGroup: null,
  selection: null,
  selectionHelper: null,
  selectionMap: new Map(), // uuid -> Object3D
  fileHandle: null,
  fileName: null,
  needsRender: true,
};

const ui = {
  outliner: document.getElementById("outliner"),
  canvas: document.getElementById("editor-canvas"),
  btnOpen: document.getElementById("btn-open"),
  btnSave: document.getElementById("btn-save"),
  btnSaveAs: document.getElementById("btn-save-as"),
  btnExport: document.getElementById("btn-export"),
  btnTranslate: document.getElementById("btn-translate"),
  btnRotate: document.getElementById("btn-rotate"),
  btnScale: document.getElementById("btn-scale"),
  btnBack: document.getElementById("btn-back"),
  fileLabel: document.getElementById("file-label"),
  fileInput: document.getElementById("file-input"),
  inspector: document.getElementById("inspector"),
  name: document.getElementById("name"),
  posX: document.getElementById("pos-x"),
  posY: document.getElementById("pos-y"),
  posZ: document.getElementById("pos-z"),
  rotX: document.getElementById("rot-x"),
  rotY: document.getElementById("rot-y"),
  rotZ: document.getElementById("rot-z"),
  sclX: document.getElementById("scl-x"),
  sclY: document.getElementById("scl-y"),
  sclZ: document.getElementById("scl-z"),
  userData: document.getElementById("userdata"),
  btnApplyUD: document.getElementById("btn-apply-userdata"),
  assetBar: document.getElementById("asset-bar"),
  assetList: document.getElementById("asset-list"),
};

init();

function init() {
  // Renderer & scene
  state.canvas = ui.canvas;
  state.renderer = new THREE.WebGLRenderer({ canvas: state.canvas, antialias: true, alpha: false });
  state.renderer.setPixelRatio(window.devicePixelRatio || 1);
  resize();

  state.scene = new THREE.Scene();
  state.scene.background = new THREE.Color(0x101014);

  const aspect = state.canvas.clientWidth / Math.max(1, state.canvas.clientHeight);
  state.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 2000);
  state.camera.position.set(3, 2, 6);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x333366, 0.9);
  state.scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 0.5);
  dir.position.set(5, 10, 7);
  state.scene.add(dir);

  const grid = new THREE.GridHelper(20, 20, 0x334155, 0x1f2937);
  grid.material.opacity = 0.6;
  grid.material.transparent = true;
  state.scene.add(grid);
  const axes = new THREE.AxesHelper(1.5);
  axes.position.set(0, 0.01, 0);
  state.scene.add(axes);

  state.rootGroup = new THREE.Group();
  state.rootGroup.name = "FileRoot";
  state.scene.add(state.rootGroup);

  state.controls = new OrbitControls(state.camera, state.canvas);
  state.controls.enableDamping = true;
  state.controls.dampingFactor = 0.08;
  state.controls.addEventListener("change", requestRender);

  state.transform = new TransformControls(state.camera, state.canvas);
  state.transform.addEventListener("change", () => {
    updateInspectorFromSelection();
    if (state.selectionHelper && state.selection) state.selectionHelper.setFromObject(state.selection);
    requestRender();
  });
  state.transform.addEventListener("dragging-changed", (e) => {
    state.controls.enabled = !e.value;
  });
  state.scene.add(state.transform);

  // Events
  window.addEventListener("resize", () => { resize(); requestRender(); });
  state.canvas.addEventListener("pointerdown", onPointerDown);
  ui.btnOpen.addEventListener("click", onOpen);
  ui.btnSave.addEventListener("click", onSave);
  ui.btnSaveAs.addEventListener("click", onSaveAs);
  ui.btnExport.addEventListener("click", onExport);
  ui.btnTranslate.addEventListener("click", () => { state.transform.setMode("translate"); requestRender(); });
  ui.btnRotate.addEventListener("click", () => { state.transform.setMode("rotate"); requestRender(); });
  ui.btnScale.addEventListener("click", () => { state.transform.setMode("scale"); requestRender(); });
  ui.btnBack.addEventListener("click", () => openGame());
  ui.fileInput.addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) openFile(f);
    ui.fileInput.value = "";
  });
  enableDragAndDrop();
  enableShortcuts();
  bindInspector();
  loadPrefabs();
  // Optional: open from URL param (?open=<url>)
  try {
    const openParam = new URLSearchParams(window.location.search).get("open");
    if (openParam) {
      openFromUrl(openParam);
    }
  } catch {}
  // Fallback: accept URL or GLB buffer via postMessage from opener
  window.addEventListener("message", async (e) => {
    try {
      const data = e?.data || {};
      if (data && typeof data.open === "string" && data.open) {
        openFromUrl(data.open);
        return;
      }
      if (data && data.kind === "glb" && (data.buffer instanceof ArrayBuffer || data.buffer instanceof Blob)) {
        const blob = data.buffer instanceof Blob ? data.buffer : new Blob([data.buffer], { type: "model/gltf-binary" });
        const file = new File([blob], data.name || "scene.glb", { type: "model/gltf-binary" });
        await openFile(file);
        return;
      }
    } catch {}
  });

  animate();
}

function resize() {
  const width = state.canvas.clientWidth || state.canvas.parentElement.clientWidth || window.innerWidth;
  const height = state.canvas.clientHeight || state.canvas.parentElement.clientHeight || (window.innerHeight - 46);
  if (state.renderer) {
    state.renderer.setSize(width, height, false);
  }
  if (state.camera) {
    state.camera.aspect = width / Math.max(1, height);
    state.camera.updateProjectionMatrix();
  }
}

function animate() {
  requestAnimationFrame(animate);
  state.controls?.update?.();
  if (!state.needsRender) return;
  state.needsRender = false;
  state.renderer.render(state.scene, state.camera);
}

function requestRender() { state.needsRender = true; }

// File open handlers
async function onOpen() {
  // Try File System Access API if available
  if (window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker({
        multiple: false,
        types: [{ description: "glTF/GLB", accept: { "model/gltf-binary": [".glb"], "model/gltf+json": [".gltf"] } }],
      });
      state.fileHandle = handle;
      const file = await handle.getFile();
      state.fileName = file.name;
      await openFile(file);
      return;
    } catch (e) {
      // Fallthrough to input
    }
  }
  ui.fileInput.click();
}

async function openFile(file) {
  clearScene();
  const name = file?.name || "Unnamed";
  setFileLabel(name);

  const url = URL.createObjectURL(file);
  try {
    const gltf = await loadGLTF(url);
    URL.revokeObjectURL(url);
    const root = gltf.scene || gltf.scenes?.[0] || new THREE.Group();
    state.rootGroup.add(root);
    state.sourceUrl = null;
    // Normalize transforms for easier editing
    root.updateWorldMatrix(true, true);
    frameObject(root);
    rebuildOutliner();
    requestRender();
  } catch (e) {
    URL.revokeObjectURL(url);
    console.error("Failed to load GLTF:", e);
    alert("Failed to open file");
  }
}

async function openFromUrl(url) {
  clearScene();
  try {
    const gltf = await loadGLTF(url);
    const root = gltf.scene || gltf.scenes?.[0] || new THREE.Group();
    state.rootGroup.add(root);
    try {
      const u = new URL(url, window.location.href);
      state.fileName = (u.pathname.split('/').pop()) || url;
    } catch {
      state.fileName = url;
    }
    setFileLabel(state.fileName || url);
    state.sourceUrl = url;
    root.updateWorldMatrix(true, true);
    frameObject(root);
    rebuildOutliner();
    requestRender();
  } catch (e) {
    console.error("Failed to load GLTF URL:", url, e);
    alert("Failed to open URL");
  }
}

function clearScene() {
  // Detach selection
  selectObject(null);
  // Remove previous file roots
  while (state.rootGroup.children.length) {
    const c = state.rootGroup.children.pop();
    c.traverse?.((o) => {
      if (o.geometry) o.geometry.dispose?.();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => {
          if (m.map) m.map.dispose?.();
          m.dispose?.();
        });
      }
    });
    state.rootGroup.remove(c);
  }
  state.selectionMap.clear();
  setFileLabel("No file");
}

function loadGLTF(url) {
  return new Promise((resolve, reject) => {
    state.loader.load(url, resolve, undefined, reject);
  });
}

// Outliner
function rebuildOutliner() {
  state.selectionMap.clear();
  ui.outliner.innerHTML = "";
  const tree = document.createElement("div");
  const header = document.createElement("div");
  header.className = "item";
  header.textContent = "Scene";
  header.style.fontWeight = "600";
  tree.appendChild(header);
  for (const child of state.rootGroup.children) {
    renderNode(child, tree, 1);
  }
  ui.outliner.appendChild(tree);
}

function renderNode(obj, container, depth) {
  state.selectionMap.set(obj.uuid, obj);
  const item = document.createElement("div");
  item.className = "item" + (state.selection === obj ? " selected" : "");
  item.textContent = `${obj.name || obj.type} (${obj.type})`;
  item.dataset.uuid = obj.uuid;
  item.style.paddingLeft = `${depth * 8}px`;
  item.addEventListener("click", (e) => {
    e.stopPropagation();
    selectObject(obj);
  });
  container.appendChild(item);
  if (obj.children && obj.children.length) {
    for (const child of obj.children) {
      renderNode(child, container, depth + 1);
    }
  }
}

function refreshOutlinerSelection() {
  const items = ui.outliner.querySelectorAll(".item");
  items.forEach((el) => {
    el.classList.toggle("selected", state.selection && el.dataset.uuid === state.selection.uuid);
  });
}

// Selection & raycast
function onPointerDown(event) {
  // If interacting with transform gizmo, do not re-select scene objects
  if (state.transform && (state.transform.dragging || state.transform.axis)) {
    return;
  }
  const rect = state.canvas.getBoundingClientRect();
  state.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  state.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  state.raycaster.setFromCamera(state.mouse, state.camera);
  if (!state.rootGroup.children.length) return;
  const hits = state.raycaster.intersectObjects(state.rootGroup.children, true);
  if (hits.length) {
    let hit = hits[0].object;
    // Climb to meaningful parent (Mesh or Group is fine)
    while (hit && hit.parent) {
      if (hit.isMesh || hit.isGroup) break;
      hit = hit.parent;
    }
    selectObject(hit || hits[0].object);
  }
}

function selectObject(obj) {
  state.selection = obj || null;
  state.transform.detach();
  if (state.selection) {
    state.transform.attach(state.selection);
    if (state.selectionHelper) {
      state.selectionHelper.setFromObject(state.selection);
    } else if (THREE.BoxHelper) {
      state.selectionHelper = new THREE.BoxHelper(state.selection, 0x4ade80);
      state.scene.add(state.selectionHelper);
    }
  } else if (state.selectionHelper) {
    state.scene.remove(state.selectionHelper);
    state.selectionHelper = null;
  }
  updateInspectorFromSelection();
  refreshOutlinerSelection();
  requestRender();
}

// Inspector bindings
function bindInspector() {
  ui.name.addEventListener("change", () => {
    if (!state.selection) return;
    state.selection.name = ui.name.value || "";
    rebuildOutliner();
    refreshOutlinerSelection();
    requestRender();
  });

  const applyTransform = () => {
    if (!state.selection) return;
    const px = parseFloat(ui.posX.value); const py = parseFloat(ui.posY.value); const pz = parseFloat(ui.posZ.value);
    const rx = degToRad(parseFloat(ui.rotX.value)); const ry = degToRad(parseFloat(ui.rotY.value)); const rz = degToRad(parseFloat(ui.rotZ.value));
    const sx = parseFloat(ui.sclX.value); const sy = parseFloat(ui.sclY.value); const sz = parseFloat(ui.sclZ.value);
    if (Number.isFinite(px)) state.selection.position.x = px;
    if (Number.isFinite(py)) state.selection.position.y = py;
    if (Number.isFinite(pz)) state.selection.position.z = pz;
    if (Number.isFinite(rx)) state.selection.rotation.x = rx;
    if (Number.isFinite(ry)) state.selection.rotation.y = ry;
    if (Number.isFinite(rz)) state.selection.rotation.z = rz;
    if (Number.isFinite(sx)) state.selection.scale.x = sx;
    if (Number.isFinite(sy)) state.selection.scale.y = sy;
    if (Number.isFinite(sz)) state.selection.scale.z = sz;
    if (state.selectionHelper) state.selectionHelper.setFromObject(state.selection);
    requestRender();
  };
  [ui.posX, ui.posY, ui.posZ, ui.rotX, ui.rotY, ui.rotZ, ui.sclX, ui.sclY, ui.sclZ].forEach((el) => {
    el.addEventListener("input", applyTransform);
    el.addEventListener("change", applyTransform);
  });

  ui.btnApplyUD.addEventListener("click", () => {
    if (!state.selection) return;
    try {
      const parsed = ui.userData.value.trim() ? JSON.parse(ui.userData.value) : {};
      state.selection.userData = parsed;
      requestRender();
    } catch (e) {
      alert("Invalid JSON in User Data");
    }
  });
}

function updateInspectorFromSelection() {
  const o = state.selection;
  ui.name.value = o?.name || "";
  if (o) {
    ui.posX.value = toFixed(o.position.x);
    ui.posY.value = toFixed(o.position.y);
    ui.posZ.value = toFixed(o.position.z);
    ui.rotX.value = toFixed(radToDeg(o.rotation.x));
    ui.rotY.value = toFixed(radToDeg(o.rotation.y));
    ui.rotZ.value = toFixed(radToDeg(o.rotation.z));
    ui.sclX.value = toFixed(o.scale.x);
    ui.sclY.value = toFixed(o.scale.y);
    ui.sclZ.value = toFixed(o.scale.z);
    ui.userData.value = JSON.stringify(o.userData || {}, null, 2);
  } else {
    [ui.posX, ui.posY, ui.posZ, ui.rotX, ui.rotY, ui.rotZ, ui.sclX, ui.sclY, ui.sclZ, ui.name].forEach((el) => el.value = "");
    ui.userData.value = "";
  }
}

// Save / Export
async function onSave() {
  const buffer = await exportGLB();
  if (!buffer) return;
  if (state.fileHandle) {
    try {
      const writable = await state.fileHandle.createWritable();
      await writable.write(buffer);
      await writable.close();
      setFileLabel(state.fileHandle.name || state.fileName || "Untitled.glb", true);
      return;
    } catch (e) {
      console.warn("FS Access save failed, falling back to download", e);
    }
  }
  downloadBlob(new Blob([buffer], { type: "model/gltf-binary" }), state.fileName || "scene.glb");
}

async function onSaveAs() {
  const buffer = await exportGLB();
  if (!buffer) return;
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: (state.fileName || "scene") + ".glb",
        types: [{ description: "GLB", accept: { "model/gltf-binary": [".glb"] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(buffer);
      await writable.close();
      state.fileHandle = handle;
      state.fileName = handle.name;
      setFileLabel(handle.name, true);
      return;
    } catch (e) {
      // fall back
    }
  }
  downloadBlob(new Blob([buffer], { type: "model/gltf-binary" }), (state.fileName || "scene") + ".glb");
}

async function onExport() { await onSaveAs(); }

function exportGLB() {
  return new Promise((resolve) => {
    const root = state.rootGroup;
    if (!root || !root.children.length) { resolve(null); return; }
    state.exporter.parse(root, (glb) => {
      resolve(glb);
    }, { binary: true, trs: true, onlyVisible: true });
  });
}

function openGame(gltfUrl) {
  try {
    const gameUrl = new URL("index.html", document.baseURI || window.location.href);
    if (gltfUrl) gameUrl.searchParams.set("gltf", gltfUrl);
    window.location.assign(gameUrl.toString());
  } catch {}
}

// Utilities
function enableDragAndDrop() {
  const root = document.getElementById("editor-root");
  const overlay = document.createElement("div");
  overlay.className = "drop-overlay";
  overlay.textContent = "Drop .glb or .gltf here";
  root.appendChild(overlay);
  const show = () => overlay.classList.add("visible");
  const hide = () => overlay.classList.remove("visible");
  ["dragenter", "dragover"].forEach((t) => root.addEventListener(t, (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; show(); }));
  ["dragleave", "drop"].forEach((t) => root.addEventListener(t, (e) => { e.preventDefault(); hide(); }));
  root.addEventListener("drop", async (e) => {
    // Prefab drop?
    const prefabJson = e.dataTransfer?.getData("application/x-prefab");
    if (prefabJson) {
      try {
        const prefab = JSON.parse(prefabJson);
        const p = getDropPosition(e.clientX, e.clientY) || new THREE.Vector3();
        await spawnPrefab(prefab, p);
        return;
      } catch {}
    }
    const f = e.dataTransfer?.files?.[0];
    if (f) { state.fileHandle = null; state.fileName = f.name; await openFile(f); }
  });
  // Canvas-level DnD needed for coordinates
  state.canvas.addEventListener("dragover", (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; });
  state.canvas.addEventListener("drop", async (e) => {
    const prefabJson = e.dataTransfer?.getData("application/x-prefab");
    if (prefabJson) {
      e.preventDefault();
      try {
        const prefab = JSON.parse(prefabJson);
        const p = getDropPosition(e.clientX, e.clientY) || new THREE.Vector3();
        await spawnPrefab(prefab, p);
      } catch {}
    }
  });
}

function enableShortcuts() {
  window.addEventListener("keydown", (e) => {
    if (e.key === "w" || e.key === "W") { state.transform.setMode("translate"); e.preventDefault(); }
    if (e.key === "e" || e.key === "E") { state.transform.setMode("rotate"); e.preventDefault(); }
    if (e.key === "r" || e.key === "R") { state.transform.setMode("scale"); e.preventDefault(); }
    if ((e.key === "s" || e.key === "S") && (e.ctrlKey || e.metaKey) && e.shiftKey) { onSaveAs(); e.preventDefault(); }
    else if ((e.key === "s" || e.key === "S") && (e.ctrlKey || e.metaKey)) { onSave(); e.preventDefault(); }
    if (e.key === "f" || e.key === "F") { if (state.selection) frameObject(state.selection); else if (state.rootGroup.children[0]) frameObject(state.rootGroup.children[0]); requestRender(); }
    if ((e.key === "o" || e.key === "O") && (e.ctrlKey || e.metaKey)) { onOpen(); e.preventDefault(); }
  });
}

function frameObject(obj) {
  const box = new THREE.Box3().setFromObject(obj);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  const maxDim = Math.max(size.x, size.y, size.z);
  const fov = state.camera.fov * (Math.PI / 180);
  const distance = maxDim / (2 * Math.tan(fov / 2)) + 0.5 * maxDim;
  const dir = new THREE.Vector3(0, 0, 1);
  const pos = center.clone().add(dir.multiplyScalar(distance));
  state.camera.position.copy(pos);
  state.controls.target.copy(center);
  state.camera.updateProjectionMatrix();
}

function setFileLabel(text, saved = false) {
  ui.fileLabel.textContent = saved ? `${text} (saved)` : text;
  setTimeout(() => { if (ui.fileLabel.textContent.endsWith("(saved)")) ui.fileLabel.textContent = text; }, 1200);
}

function toFixed(n) { return Number.isFinite(n) ? (Math.abs(n) < 1e-6 ? "0" : n.toFixed(4)) : ""; }
function radToDeg(r) { return r * 180 / Math.PI; }
function degToRad(d) { return d * Math.PI / 180; }

function downloadBlob(blob, filename) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}



// Prefabs
async function loadPrefabs() {
  try {
    const res = await fetch("assets/prefabs.json", { cache: "no-cache" });
    if (!res.ok) return;
    const list = await res.json();
    ui.assetList.innerHTML = "";
    (Array.isArray(list) ? list : []).forEach((p) => addPrefabTile(p));
  } catch {}
}

function addPrefabTile(prefab) {
  const tile = document.createElement("div");
  tile.className = "asset-tile";
  tile.draggable = true;
  const thumb = document.createElement("div");
  thumb.className = "asset-thumb";
  if (prefab.thumb) thumb.style.backgroundImage = `url(${prefab.thumb})`;
  const name = document.createElement("div");
  name.className = "asset-name";
  name.textContent = prefab.name || "Prefab";
  tile.appendChild(thumb);
  tile.appendChild(name);
  tile.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("application/x-prefab", JSON.stringify(prefab));
    e.dataTransfer.effectAllowed = "copy";
  });
  tile.addEventListener("click", async () => {
    const p = getDropPosition(window.innerWidth / 2, window.innerHeight / 2) || state.controls?.target?.clone?.() || new THREE.Vector3();
    await spawnPrefab(prefab, p);
  });
  ui.assetList.appendChild(tile);
}

async function spawnPrefab(prefab, position) {
  const url = prefab?.url;
  if (!url) return;
  try {
    const base = new URL(document.baseURI || window.location.href);
    const abs = url.startsWith("http") ? url : new URL(url, base).toString();
    const gltf = await loadGLTF(abs);
    const root = (gltf.scene || gltf.scenes?.[0] || new THREE.Group()).clone(true);
    root.position.copy(position);
    // Apply userData preset on root
    if (prefab.userData && typeof prefab.userData === "object") {
      root.userData = { ...(root.userData || {}), ...prefab.userData };
    }
    state.rootGroup.add(root);
    rebuildOutliner();
    selectObject(root);
    requestRender();
  } catch (e) {
    console.warn("Failed to spawn prefab:", e);
  }
}

function getDropPosition(clientX, clientY) {
  const rect = state.canvas.getBoundingClientRect();
  const x = ((clientX - rect.left) / rect.width) * 2 - 1;
  const y = -((clientY - rect.top) / rect.height) * 2 + 1;
  state.raycaster.setFromCamera({ x, y }, state.camera);
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();
  state.raycaster.ray.intersectPlane(plane, hit);
  return hit;
}


