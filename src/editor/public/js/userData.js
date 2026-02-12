/**
 * userData.js - Read/write component data in Three64's userData format.
 *
 * The engine's _extractComponentsFromUserData supports several formats.
 * The editor normalises everything into the `userData.components` array format:
 *
 *   userData.components = [
 *     { type: "Agent",     params: { speed: 3.2 } },
 *     { type: "Rigidbody", params: { shape: "box" } }
 *   ]
 *
 * On read we also recognise the legacy / alternative keys the engine supports
 * (component, component2, comp.*, c_*, etc.) so we can inspect models authored
 * in Blender.  On write we always use the clean `components` array.
 */

/**
 * Extract component entries from an Object3D's userData.
 * Returns an array of { type: string, params: object }.
 * This mirrors the engine's _extractComponentsFromUserData logic.
 */
export function readComponents(userData) {
  const out = [];
  if (!userData || typeof userData !== 'object') return out;

  const add = (type, params) => {
    if (!type) return;
    out.push({ type: String(type), params: params && typeof params === 'object' ? { ...params } : {} });
  };

  // --- components array (preferred format) ---
  let comps = userData.components;
  if (typeof comps === 'string') {
    try { comps = JSON.parse(comps); } catch { comps = null; }
  }
  if (Array.isArray(comps)) {
    for (const c of comps) {
      if (typeof c === 'string') add(c, {});
      else if (c && typeof c === 'object') add(c.type || c.name, c.params ?? c.options ?? c.props ?? {});
    }
    return out; // If the array format is present, treat it as authoritative
  }

  // --- Numbered components: component2, component_2, script2, script_2 ---
  const suffixRx = /(.*?)(?:_|)(\d+)$/;
  const numbered = {};
  for (const [k, v] of Object.entries(userData)) {
    const m = /^component(?:_|)(\d+)$/i.exec(k) || /^script(?:_|)(\d+)$/i.exec(k);
    if (!m) continue;
    const idx = parseInt(m[1], 10);
    if (!idx || idx < 2) continue;
    if (typeof v === 'string') numbered[idx] = { type: v, params: {} };
    else if (v && typeof v === 'object') numbered[idx] = { type: v.type || v.name, params: v.params ?? v.options ?? v.props ?? {} };
  }
  // Collect per-index overrides
  const perIdx = {};
  for (const [k, v] of Object.entries(userData)) {
    const m = suffixRx.exec(k);
    if (!m) continue;
    const base = m[1]; const idx = parseInt(m[2], 10);
    if (!idx || idx < 2) continue;
    if (!(idx in perIdx)) perIdx[idx] = {};
    perIdx[idx][base] = v;
  }
  for (const [idxStr, def] of Object.entries(numbered)) {
    const idx = parseInt(idxStr, 10);
    const merged = { ...def.params, ...(perIdx[idx] || {}) };
    add(def.type, Object.keys(merged).length ? expandDotted(merged) : {});
  }

  // --- First (un-numbered) component ---
  const firstType = caseGet(userData, 'component') || caseGet(userData, 'script');
  if (firstType) {
    let params = caseGet(userData, 'options') ?? caseGet(userData, 'params') ?? caseGet(userData, 'props');
    if (!params || typeof params !== 'object') {
      const reserved = new Set(['component', 'script', 'components']);
      const reservedPfx = ['comp.', 'c_'];
      const derived = {};
      for (const [k, v] of Object.entries(userData)) {
        if (reserved.has(k)) continue;
        if (reservedPfx.some(p => k.startsWith(p))) continue;
        if (suffixRx.test(k)) continue;
        derived[k] = v;
      }
      const exp = expandDotted(derived);
      params = exp && Object.keys(exp).length ? exp : {};
    }
    add(firstType, params);
  }

  // --- Prefixed: comp.* / c_* ---
  for (const [k, v] of Object.entries(userData)) {
    if (!k.startsWith('comp.') && !k.startsWith('c_')) continue;
    const type = k.replace(/^comp\.|^c_/, '');
    if (v === true) add(type, {});
    else if (typeof v === 'string') {
      try { add(type, JSON.parse(v)); } catch { add(type, {}); }
    } else if (v && typeof v === 'object') add(type, v);
  }

  return out;
}

/**
 * Write the components array back to an object's userData.
 * Clears legacy keys and writes the clean `components` array.
 * @param {object} userData - The Object3D.userData to mutate
 * @param {Array<{type:string, params:object}>} components
 */
export function writeComponents(userData, components) {
  if (!userData || typeof userData !== 'object') return;

  // Remove legacy keys
  const legacyKeys = [];
  for (const k of Object.keys(userData)) {
    if (/^component(?:_?\d+)?$/i.test(k)) legacyKeys.push(k);
    else if (/^script(?:_?\d+)?$/i.test(k)) legacyKeys.push(k);
    else if (k === 'components') legacyKeys.push(k);
    else if (k === 'options' || k === 'params' || k === 'props') legacyKeys.push(k);
    else if (k.startsWith('comp.') || k.startsWith('c_')) legacyKeys.push(k);
  }
  for (const k of legacyKeys) delete userData[k];

  // Write clean format
  if (components.length > 0) {
    userData.components = components.map(c => ({
      type: c.type,
      params: c.params && Object.keys(c.params).length ? { ...c.params } : {},
    }));
  }
}

// --- Helpers ---

function caseGet(obj, key) {
  if (!obj || typeof obj !== 'object') return undefined;
  if (Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];
  const lower = key.toLowerCase();
  for (const k of Object.keys(obj)) {
    if (k.toLowerCase() === lower) return obj[k];
  }
  return undefined;
}

/**
 * Expand dotted keys into nested objects.
 * "physics.rigidbody.type" -> { physics: { rigidbody: { type: ... } } }
 */
function expandDotted(flat) {
  if (!flat || typeof flat !== 'object') return flat;
  const out = {};
  for (const [key, val] of Object.entries(flat)) {
    if (!key.includes('.')) {
      out[key] = val;
      continue;
    }
    const parts = key.split('.');
    let cur = out;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      if (!(p in cur) || typeof cur[p] !== 'object') cur[p] = {};
      cur = cur[p];
    }
    cur[parts[parts.length - 1]] = val;
  }
  return out;
}
