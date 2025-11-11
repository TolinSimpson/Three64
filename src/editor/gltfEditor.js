'use strict';
// GLTF/GLB editing utilities focused on writing userData (glTF `extras`).
// - Works in browser (TextEncoder/TextDecoder) and modern runtimes.
// - Avoids engine dependencies; pure data-level manipulation.

const GLB_MAGIC = 0x46546c67; // "glTF"
const GLB_VERSION_SUPPORTED = 2;
const JSON_CHUNK_TYPE = 0x4e4f534a; // "JSON"
const BIN_CHUNK_TYPE = 0x004e4942; // "BIN\0"

function getTextEncoder() {
  if (typeof TextEncoder !== "undefined") return new TextEncoder();
  throw new Error("TextEncoder not available in this environment");
}

function getTextDecoder() {
  if (typeof TextDecoder !== "undefined") return new TextDecoder();
  throw new Error("TextDecoder not available in this environment");
}

function isArrayBufferLike(value) {
  return value instanceof ArrayBuffer || ArrayBuffer.isView(value);
}

function padTo4Bytes(byteLength) {
  const r = byteLength % 4;
  return r === 0 ? 0 : 4 - r;
}

function ensureExtras(target) {
  if (!target || typeof target !== "object") return;
  if (target.extras == null || typeof target.extras !== "object") target.extras = {};
}

function shallowMergeExtras(target, extras) {
  ensureExtras(target);
  Object.assign(target.extras, extras || {});
}

// -----------------------------
// GLB parsing / building
// -----------------------------

export function parseGLB(input) {
  const buffer = input instanceof ArrayBuffer ? input : input.buffer;
  const dv = new DataView(buffer, input.byteOffset || 0, input.byteLength || buffer.byteLength);
  const magic = dv.getUint32(0, true);
  const version = dv.getUint32(4, true);
  const length = dv.getUint32(8, true);
  if (magic !== GLB_MAGIC) throw new Error("Not a GLB file (bad magic)");
  if (version !== GLB_VERSION_SUPPORTED) throw new Error("Unsupported GLB version");
  if (length !== dv.byteLength) {
    // Some environments pass larger buffers; trust header if smaller
  }

  let offset = 12;
  let json = null;
  const chunks = [];
  const decoder = getTextDecoder();

  while (offset + 8 <= dv.byteLength) {
    const chunkLength = dv.getUint32(offset + 0, true);
    const chunkType = dv.getUint32(offset + 4, true);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkLength;
    if (chunkEnd > dv.byteLength) break;
    const u8 = new Uint8Array(dv.buffer, dv.byteOffset + chunkStart, chunkLength);

    if (chunkType === JSON_CHUNK_TYPE) {
      const jsonText = decoder.decode(u8);
      json = JSON.parse(jsonText);
      chunks.push({ type: JSON_CHUNK_TYPE, data: u8 });
    } else {
      chunks.push({ type: chunkType, data: u8 });
    }
    offset = chunkEnd + padTo4Bytes(chunkLength);
  }

  if (!json) throw new Error("GLB missing JSON chunk");
  return { json, chunks, version, originalByteLength: dv.byteLength };
}

export function buildGLB(json, originalChunks = []) {
  const encoder = getTextEncoder();
  const jsonBytes = encoder.encode(JSON.stringify(json));
  const jsonPadding = padTo4Bytes(jsonBytes.byteLength);
  const jsonPaddedLength = jsonBytes.byteLength + jsonPadding;

  // Start with header + JSON chunk header + payload
  let totalLength = 12 + 8 + jsonPaddedLength;

  // Include all non-JSON chunks unchanged
  for (const ch of originalChunks) {
    if (ch.type === JSON_CHUNK_TYPE) continue;
    const chunkLen = ch.data.byteLength;
    totalLength += 8 + chunkLen + padTo4Bytes(chunkLen);
  }

  const out = new ArrayBuffer(totalLength);
  const dv = new DataView(out);
  const u8 = new Uint8Array(out);

  // Header
  dv.setUint32(0, GLB_MAGIC, true);
  dv.setUint32(4, GLB_VERSION_SUPPORTED, true);
  dv.setUint32(8, totalLength, true);

  // JSON chunk
  let offset = 12;
  dv.setUint32(offset + 0, jsonBytes.byteLength, true);
  dv.setUint32(offset + 4, JSON_CHUNK_TYPE, true);
  u8.set(jsonBytes, offset + 8);
  offset += 8 + jsonBytes.byteLength;
  if (jsonPadding) offset += jsonPadding; // zero-initialized already

  // Other chunks
  for (const ch of originalChunks) {
    if (ch.type === JSON_CHUNK_TYPE) continue;
    const len = ch.data.byteLength;
    dv.setUint32(offset + 0, len, true);
    dv.setUint32(offset + 4, ch.type, true);
    u8.set(ch.data, offset + 8);
    offset += 8 + len;
    const pad = padTo4Bytes(len);
    if (pad) offset += pad; // zeroes are fine
  }

  return out;
}

// -----------------------------
// GLTF helpers
// -----------------------------

export function isGLB(input) {
  if (!isArrayBufferLike(input)) return false;
  try {
    const view = input instanceof ArrayBuffer ? new DataView(input) : new DataView(input.buffer, input.byteOffset, Math.min(12, input.byteLength));
    return view.getUint32(0, true) === GLB_MAGIC && view.getUint32(4, true) === GLB_VERSION_SUPPORTED;
  } catch {
    return false;
  }
}

export function readAsJSON(input) {
  if (typeof input === "string") {
    return { kind: "gltf", json: JSON.parse(input) };
  }
  if (typeof input === "object" && !isArrayBufferLike(input)) {
    return { kind: "gltf", json: input };
  }
  if (isArrayBufferLike(input)) {
    const { json, chunks } = parseGLB(input);
    return { kind: "glb", json, chunks };
  }
  throw new Error("Unsupported input to readAsJSON");
}

export function writeFromJSON(meta, json) {
  if (meta.kind === "glb") {
    return { kind: "glb", arrayBuffer: buildGLB(json, meta.chunks || []) };
  }
  if (meta.kind === "gltf") {
    return { kind: "gltf", jsonText: JSON.stringify(json, null, 2) };
  }
  throw new Error("Unsupported output kind in writeFromJSON");
}

// -----------------------------
// userData writers (glTF `extras`)
// -----------------------------

export function setNodeUserDataByName(json, nameToExtras, { merge = true, exact = true } = {}) {
  if (!json || typeof json !== "object") throw new Error("json required");
  if (!json.nodes || !Array.isArray(json.nodes)) return 0;
  let count = 0;
  for (const node of json.nodes) {
    const nodeName = node?.name || "";
    for (const [name, extras] of Object.entries(nameToExtras || {})) {
      const match = exact ? nodeName === name : (nodeName && nodeName.includes(name));
      if (!match) continue;
      if (merge) shallowMergeExtras(node, extras);
      else node.extras = { ...(extras || {}) };
      count += 1;
    }
  }
  return count;
}

export function setNodeUserDataByIndex(json, indexToExtras, { merge = true } = {}) {
  if (!json || typeof json !== "object") throw new Error("json required");
  if (!json.nodes || !Array.isArray(json.nodes)) return 0;
  let count = 0;
  for (const [idxStr, extras] of Object.entries(indexToExtras || {})) {
    const idx = Number(idxStr);
    if (!Number.isFinite(idx) || idx < 0 || idx >= json.nodes.length) continue;
    const node = json.nodes[idx];
    if (merge) shallowMergeExtras(node, extras);
    else node.extras = { ...(extras || {}) };
    count += 1;
  }
  return count;
}

export function setMeshUserDataByName(json, nameToExtras, { merge = true, exact = true } = {}) {
  if (!json || typeof json !== "object") throw new Error("json required");
  if (!json.meshes || !Array.isArray(json.meshes)) return 0;
  let count = 0;
  for (const mesh of json.meshes) {
    const meshName = mesh?.name || "";
    for (const [name, extras] of Object.entries(nameToExtras || {})) {
      const match = exact ? meshName === name : (meshName && meshName.includes(name));
      if (!match) continue;
      if (merge) shallowMergeExtras(mesh, extras);
      else mesh.extras = { ...(extras || {}) };
      count += 1;
    }
  }
  return count;
}

export function setMaterialUserDataByName(json, nameToExtras, { merge = true, exact = true } = {}) {
  if (!json || typeof json !== "object") throw new Error("json required");
  if (!json.materials || !Array.isArray(json.materials)) return 0;
  let count = 0;
  for (const mat of json.materials) {
    const matName = mat?.name || "";
    for (const [name, extras] of Object.entries(nameToExtras || {})) {
      const match = exact ? matName === name : (matName && matName.includes(name));
      if (!match) continue;
      if (merge) shallowMergeExtras(mat, extras);
      else mat.extras = { ...(extras || {}) };
      count += 1;
    }
  }
  return count;
}

// High-level convenience: accept GLTF JSON string/object or GLB buffer, return same-kind output
export function writeUserData(input, { nodesByName, nodesByIndex, meshesByName, materialsByName } = {}, options = {}) {
  const meta = readAsJSON(input);
  const json = meta.json;

  let edits = 0;
  if (nodesByName) edits += setNodeUserDataByName(json, nodesByName, options);
  if (nodesByIndex) edits += setNodeUserDataByIndex(json, nodesByIndex, options);
  if (meshesByName) edits += setMeshUserDataByName(json, meshesByName, options);
  if (materialsByName) edits += setMaterialUserDataByName(json, materialsByName, options);

  const out = writeFromJSON(meta, json);
  return { ...out, edits };
}

// Helpers to set a single node's userData by exact name
export function writeNodeUserData(input, nodeName, extras, options = {}) {
  return writeUserData(input, { nodesByName: { [nodeName]: extras } }, options);
}

// Helpers to set multiple nodes by partial name match
export function writeNodeUserDataContains(input, nameFragment, extras, options = {}) {
  const meta = readAsJSON(input);
  const json = meta.json;
  const map = {};
  for (const node of json.nodes || []) {
    if ((node?.name || "").includes(nameFragment)) map[node.name] = extras;
  }
  const out = writeUserData(meta, { nodesByName: map }, { ...options, exact: true });
  return out;
}

// Export types: this file uses named exports only


