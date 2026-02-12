/**
 * gltfIO.js - GLTF/GLB loading, saving, and exporting.
 *
 * - Open: load via GLTFLoader (from file picker or asset library)
 * - Save: export via GLTFExporter, POST to server
 * - Export: export via GLTFExporter, browser download
 */
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

const loader = new GLTFLoader();
const exporter = new GLTFExporter();

/**
 * Open a GLB/GLTF file from a browser file picker.
 * Returns the parsed gltf.scene (THREE.Group).
 */
export async function openFromFilePicker() {
  const file = await pickFile('.glb,.gltf');
  if (!file) return null;
  const arrayBuffer = await file.arrayBuffer();
  const url = URL.createObjectURL(new Blob([arrayBuffer]));
  try {
    const gltf = await loader.loadAsync(url);
    // Preserve the filename for later saving
    gltf.scene.userData.__sourceFile = file.name;
    return gltf.scene;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Open a GLB/GLTF file from a URL (e.g. /models/scene.glb).
 * Returns the parsed gltf.scene (THREE.Group).
 */
export async function openFromURL(url) {
  const gltf = await loader.loadAsync(url);
  const filename = url.split('/').pop();
  gltf.scene.userData.__sourceFile = filename;
  return gltf.scene;
}

/**
 * Export sceneRoot as GLB and save to the project via the editor server.
 * @param {THREE.Object3D} sceneRoot
 * @param {string} filename
 * @param {Function} setStatus  Status callback
 */
export async function saveToServer(sceneRoot, filename, setStatus) {
  setStatus?.('Exporting...');
  try {
    const glb = await exportGLB(sceneRoot);
    setStatus?.('Uploading...');
    const res = await fetch(`/api/save-gltf?filename=${encodeURIComponent(filename)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: glb,
    });
    const result = await res.json();
    if (result.ok) {
      setStatus?.(`Saved ${filename}`);
    } else {
      setStatus?.(`Save failed: ${result.error}`);
    }
  } catch (err) {
    console.error('Save failed:', err);
    setStatus?.(`Save error: ${err.message}`);
  }
}

/**
 * Export sceneRoot as GLB and trigger a browser download.
 * @param {THREE.Object3D} sceneRoot
 * @param {string} filename
 */
export async function exportDownload(sceneRoot, filename) {
  const glb = await exportGLB(sceneRoot);
  const blob = new Blob([glb], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'scene.glb';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Export a Three.js object as GLB ArrayBuffer.
 * Strips editor-only objects (names starting with __).
 */
async function exportGLB(sceneRoot) {
  // Clone to strip editor-only helpers
  const exportScene = sceneRoot.clone(true);
  // Remove any __-prefixed children added by the editor
  const toRemove = [];
  exportScene.traverse((obj) => {
    if (obj.name && obj.name.startsWith('__')) toRemove.push(obj);
  });
  for (const obj of toRemove) {
    obj.parent?.remove(obj);
  }

  return new Promise((resolve, reject) => {
    exporter.parse(
      exportScene,
      (result) => resolve(result),
      (error) => reject(error),
      { binary: true }
    );
  });
}

// --- Helpers ---

function pickFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.addEventListener('change', () => {
      resolve(input.files?.[0] || null);
    });
    input.click();
  });
}
