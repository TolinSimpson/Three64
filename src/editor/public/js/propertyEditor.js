/**
 * propertyEditor.js - Auto-generates form controls from paramDescriptions.
 *
 * Supported types:
 *   number, string, boolean, enum, vec3, color, object, array
 *
 * Smart behaviours:
 *   - Nested objects are recursively flattened into dotted-key fields
 *   - Parent object keys covered by described children are suppressed
 *   - String descriptions containing "a | b | c" auto-detect as dropdowns
 *   - {x,y,z} objects are rendered as vec3 inputs
 *   - Arrays of primitives get add/remove list editors
 *   - Color type renders a colour picker + hex integer display
 *   - SceneContext-hinted fields render combo-box dropdowns with scene data
 */
import { resolveHint } from './sceneContext.js';

// ============================================================
// Public entry point
// ============================================================

/**
 * Build a DOM element containing property controls for a single component.
 *
 * @param {object}   params           Current param values
 * @param {Array}    paramDescriptions Array of { key, label, type, min, max, step, options, description }
 * @param {Function} onChange          Called with (key, value) when a property changes
 * @param {import('./sceneContext.js').SceneContext} [context] Scene context for hinted dropdowns
 * @param {string}   [componentType]  Component type name (e.g. "Volume") for hint resolution
 * @returns {HTMLElement}
 */
export function buildPropertyEditor(params, paramDescriptions, onChange, context, componentType) {
  const container = document.createElement('div');
  container.className = 'inspector-group-body';

  // Build described-key lookup
  const descMap = new Map();
  if (Array.isArray(paramDescriptions)) {
    for (const d of paramDescriptions) {
      if (d.key) descMap.set(d.key, d);
    }
  }

  // Flatten the params into dotted keys so nested objects become individual rows
  const flatParams = flattenKeys(params);

  // Collect ordered keys: described first, then remaining flattened params
  const orderedKeys = [];
  const seen = new Set();
  for (const d of (paramDescriptions || [])) {
    if (d.key) { orderedKeys.push(d.key); seen.add(d.key); }
  }
  for (const k of flatParams.keys()) {
    if (!seen.has(k)) { orderedKeys.push(k); seen.add(k); }
  }

  // Suppress parent object keys when their children are already listed.
  // E.g. if "target.mode" is present, don't also show "target".
  const suppressedParents = new Set();
  for (const k of orderedKeys) {
    if (k.includes('.')) {
      // Mark every ancestor prefix as suppressed
      const parts = k.split('.');
      for (let i = 1; i < parts.length; i++) {
        suppressedParents.add(parts.slice(0, i).join('.'));
      }
    }
  }

  for (const key of orderedKeys) {
    if (suppressedParents.has(key)) continue;
    const desc = descMap.get(key);
    const value = flatParams.has(key) ? flatParams.get(key) : getNestedValue(params, key);

    // Resolve context hints for this param
    let hintOptions = null;
    if (context) {
      const hintList = resolveHint(componentType, key, desc);
      if (hintList && context[hintList] && context[hintList].length > 0) {
        hintOptions = context[hintList];
      }
    }

    const row = createPropertyRow(key, value, desc, (newVal) => {
      onChange(key, newVal);
    }, hintOptions);
    container.appendChild(row);
  }

  // If no keys at all, show a JSON fallback for the entire params
  if (orderedKeys.length === 0 || (orderedKeys.length === suppressedParents.size)) {
    const row = createJsonFallback('params', params, (newVal) => {
      onChange('__replace_all__', newVal);
    });
    container.appendChild(row);
  }

  return container;
}

// ============================================================
// Type dispatch
// ============================================================

function createPropertyRow(key, value, desc, onChange, hintOptions) {
  const type = resolveType(value, desc);
  const label = desc?.label || key;

  // Context-provided hints: render as combo-box for string-like fields
  if (hintOptions && hintOptions.length > 0) {
    if (type === 'string' || type === 'hinted-enum') {
      return createHintedEnumRow(key, label, value, desc, onChange, hintOptions);
    }
    if (type === 'array') {
      return createArrayRow(key, label, value, desc, onChange, hintOptions);
    }
  }

  switch (type) {
    case 'number':   return createNumberRow(key, label, value, desc, onChange);
    case 'boolean':  return createBooleanRow(key, label, value, desc, onChange);
    case 'enum':     return createEnumRow(key, label, value, desc, onChange);
    case 'string':   return createStringRow(key, label, value, desc, onChange);
    case 'hinted-enum': return createHintedEnumRow(key, label, value, desc, onChange);
    case 'vec3':     return createVec3Row(key, label, value, desc, onChange);
    case 'color':    return createColorRow(key, label, value, desc, onChange);
    case 'array':    return createArrayRow(key, label, value, desc, onChange);
    case 'object':   return createJsonFallback(label, value, onChange);
    default:         return createJsonFallback(label, value, onChange);
  }
}

/**
 * Determine the best control type for a value + description pair.
 */
function resolveType(value, desc) {
  // Explicit type from description takes priority
  if (desc?.type) {
    const t = desc.type.toLowerCase();
    // Explicit enum or has options array
    if (t === 'enum' || (desc.options && Array.isArray(desc.options))) return 'enum';
    if (t === 'color') return 'color';
    if (t === 'vec3') return 'vec3';
    if (t === 'array') return 'array';
    if (t === 'object') return 'object';
    if (t === 'boolean') return 'boolean';
    if (t === 'number') return 'number';
    if (t === 'string') {
      // Auto-detect pipe-separated options hint in description text
      if (desc.description && detectPipeOptions(desc.description)) return 'hinted-enum';
      return 'string';
    }
    return t;
  }
  // Guess from value
  return guessType(value);
}

function guessType(value) {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'string') return 'string';
  if (Array.isArray(value)) {
    if (value.length === 3 && value.every(v => typeof v === 'number')) return 'vec3';
    return 'array';
  }
  if (value && typeof value === 'object') {
    if (isVec3Object(value)) return 'vec3';
    return 'object';
  }
  return 'string';
}

/** Detect "opt1 | opt2 | opt3" patterns in description text */
function detectPipeOptions(description) {
  if (!description || typeof description !== 'string') return null;
  // Match patterns like "seek | ranged" or "idle | seekPlayer | seekObject | seekPosition"
  const match = description.match(/^([\w]+(?:\s*\|\s*[\w]+)+)$/);
  if (match) return match[1];
  // Also match if embedded in text, but only if it looks like a clear list
  const embedded = description.match(/([\w]+(?:\s*\|\s*[\w]+){1,})/);
  if (embedded) return embedded[1];
  return null;
}

function parsePipeOptions(description) {
  const raw = detectPipeOptions(description);
  if (!raw) return [];
  return raw.split('|').map(s => s.trim()).filter(Boolean);
}

/** Check if an object looks like {x, y, z} vec3 */
function isVec3Object(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  const keys = Object.keys(obj);
  if (keys.length < 2 || keys.length > 4) return false;
  return keys.every(k => ['x', 'y', 'z', 'w'].includes(k)) &&
    Object.values(obj).every(v => typeof v === 'number');
}

// ============================================================
// Row builders
// ============================================================

function createNumberRow(key, label, value, desc, onChange) {
  const row = makeRow(label, desc?.description);
  const valDiv = row.querySelector('.prop-value');
  const hasRange = desc && (desc.min != null || desc.max != null);

  if (hasRange) {
    const sliderDiv = document.createElement('div');
    sliderDiv.className = 'slider-row';

    const range = document.createElement('input');
    range.type = 'range';
    range.min = desc.min ?? 0;
    range.max = desc.max ?? 100;
    range.step = desc.step ?? 0.1;
    range.value = value ?? desc.min ?? 0;

    const num = document.createElement('input');
    num.type = 'number';
    num.min = desc.min ?? '';
    num.max = desc.max ?? '';
    num.step = desc.step ?? 'any';
    num.value = value ?? desc.min ?? 0;

    range.addEventListener('input', () => {
      num.value = range.value;
      onChange(parseFloat(range.value));
    });
    num.addEventListener('change', () => {
      range.value = num.value;
      onChange(parseFloat(num.value));
    });

    sliderDiv.appendChild(range);
    sliderDiv.appendChild(num);
    valDiv.appendChild(sliderDiv);
  } else {
    const num = document.createElement('input');
    num.type = 'number';
    num.step = desc?.step ?? 'any';
    num.value = value ?? 0;
    num.addEventListener('change', () => onChange(parseFloat(num.value)));
    valDiv.appendChild(num);
  }

  return row;
}

function createBooleanRow(key, label, value, desc, onChange) {
  const row = makeRow(label, desc?.description);
  const valDiv = row.querySelector('.prop-value');
  const chk = document.createElement('input');
  chk.type = 'checkbox';
  chk.checked = !!value;
  chk.addEventListener('change', () => onChange(chk.checked));
  valDiv.appendChild(chk);
  return row;
}

function createEnumRow(key, label, value, desc, onChange) {
  const row = makeRow(label, desc?.description);
  const valDiv = row.querySelector('.prop-value');
  const sel = document.createElement('select');
  const options = desc?.options || [];
  for (const opt of options) {
    const o = document.createElement('option');
    o.value = opt;
    o.textContent = opt;
    if (String(opt) === String(value)) o.selected = true;
    sel.appendChild(o);
  }
  sel.addEventListener('change', () => onChange(sel.value));
  valDiv.appendChild(sel);
  return row;
}

/**
 * A combo-box: dropdown of suggestions plus a free-text fallback.
 * Options come from an explicit array (scene context hints) or from
 * pipe-separated description text ("opt1 | opt2").
 */
function createHintedEnumRow(key, label, value, desc, onChange, hintOptions) {
  const row = makeRow(label, desc?.description);
  const valDiv = row.querySelector('.prop-value');

  const options = hintOptions || parsePipeOptions(desc?.description);

  const wrapper = document.createElement('div');
  wrapper.className = 'hinted-enum-row';

  const sel = document.createElement('select');
  // Add a custom option at the top
  const customOpt = document.createElement('option');
  customOpt.value = '__custom__';
  customOpt.textContent = '(custom)';
  sel.appendChild(customOpt);

  let matchFound = false;
  for (const opt of options) {
    const o = document.createElement('option');
    o.value = opt;
    o.textContent = opt;
    if (opt === value) { o.selected = true; matchFound = true; }
    sel.appendChild(o);
  }

  // Free-text input (shown when custom is selected or value isn't in the list)
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.value = value ?? '';
  inp.style.display = matchFound ? 'none' : 'block';
  if (!matchFound) customOpt.selected = true;

  sel.addEventListener('change', () => {
    if (sel.value === '__custom__') {
      inp.style.display = 'block';
      inp.focus();
    } else {
      inp.style.display = 'none';
      inp.value = sel.value;
      onChange(sel.value);
    }
  });
  inp.addEventListener('change', () => onChange(inp.value));

  wrapper.appendChild(sel);
  wrapper.appendChild(inp);
  valDiv.appendChild(wrapper);
  return row;
}

function createStringRow(key, label, value, desc, onChange) {
  const row = makeRow(label, desc?.description);
  const valDiv = row.querySelector('.prop-value');
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.value = value ?? '';
  inp.addEventListener('change', () => onChange(inp.value));
  valDiv.appendChild(inp);
  return row;
}

function createVec3Row(key, label, value, desc, onChange) {
  const row = makeRow(label, desc?.description);
  const valDiv = row.querySelector('.prop-value');
  const div = document.createElement('div');
  div.className = 'vec3-inputs';

  // Support both array [x,y,z] and object {x,y,z} formats
  const isObj = value && typeof value === 'object' && !Array.isArray(value);
  const arr = isObj ? [value.x ?? 0, value.y ?? 0, value.z ?? 0]
    : Array.isArray(value) ? [...value] : [0, 0, 0];
  const labels = ['X', 'Y', 'Z'];

  const emit = () => {
    // Preserve the original format
    if (isObj) onChange({ x: arr[0], y: arr[1], z: arr[2] });
    else onChange([...arr]);
  };

  for (let i = 0; i < 3; i++) {
    const lbl = document.createElement('span');
    lbl.className = 'vec-label';
    lbl.textContent = labels[i];
    div.appendChild(lbl);

    const inp = document.createElement('input');
    inp.type = 'number';
    inp.step = 'any';
    inp.value = arr[i];
    inp.addEventListener('change', () => {
      arr[i] = parseFloat(inp.value) || 0;
      emit();
    });
    div.appendChild(inp);
  }

  valDiv.appendChild(div);
  return row;
}

/**
 * Color picker for integer hex colours (e.g. 16777215 = 0xFFFFFF).
 */
function createColorRow(key, label, value, desc, onChange) {
  const row = makeRow(label, desc?.description);
  const valDiv = row.querySelector('.prop-value');

  const wrapper = document.createElement('div');
  wrapper.className = 'color-row';

  // Convert integer to #rrggbb
  const intVal = typeof value === 'number' ? value : 0;
  const hexStr = '#' + intVal.toString(16).padStart(6, '0');

  const picker = document.createElement('input');
  picker.type = 'color';
  picker.value = hexStr;

  const num = document.createElement('input');
  num.type = 'number';
  num.value = intVal;
  num.min = 0;
  num.max = 16777215;
  num.step = 1;
  num.title = '0x' + intVal.toString(16).toUpperCase().padStart(6, '0');

  picker.addEventListener('input', () => {
    const intColor = parseInt(picker.value.slice(1), 16);
    num.value = intColor;
    num.title = '0x' + intColor.toString(16).toUpperCase().padStart(6, '0');
    onChange(intColor);
  });
  num.addEventListener('change', () => {
    const intColor = Math.max(0, Math.min(16777215, parseInt(num.value) || 0));
    picker.value = '#' + intColor.toString(16).padStart(6, '0');
    num.title = '0x' + intColor.toString(16).toUpperCase().padStart(6, '0');
    onChange(intColor);
  });

  wrapper.appendChild(picker);
  wrapper.appendChild(num);
  valDiv.appendChild(wrapper);
  return row;
}

/**
 * Array editor - displays each element with an input + remove button,
 * plus an add button at the bottom.
 */
function createArrayRow(key, label, value, desc, onChange, hintOptions) {
  const row = makeRow(label, desc?.description);
  const valDiv = row.querySelector('.prop-value');

  const arr = Array.isArray(value) ? [...value] : [];
  const listEl = document.createElement('div');
  listEl.className = 'array-editor';

  const rebuild = () => {
    listEl.innerHTML = '';
    for (let i = 0; i < arr.length; i++) {
      const itemRow = document.createElement('div');
      itemRow.className = 'array-item-row';

      const itemType = typeof arr[i];
      if (itemType === 'number') {
        const inp = document.createElement('input');
        inp.type = 'number';
        inp.step = 'any';
        inp.value = arr[i];
        inp.addEventListener('change', () => {
          arr[i] = parseFloat(inp.value) || 0;
          onChange([...arr]);
        });
        itemRow.appendChild(inp);
      } else if (itemType === 'boolean') {
        const chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.checked = !!arr[i];
        chk.addEventListener('change', () => {
          arr[i] = chk.checked;
          onChange([...arr]);
        });
        itemRow.appendChild(chk);
      } else if (itemType === 'object' && arr[i] !== null) {
        const ta = document.createElement('textarea');
        ta.value = JSON.stringify(arr[i], null, 2);
        ta.addEventListener('change', () => {
          try { arr[i] = JSON.parse(ta.value); } catch { /* keep old */ }
          onChange([...arr]);
        });
        itemRow.appendChild(ta);
      } else if (hintOptions && hintOptions.length > 0) {
        // String item with scene-context hints: render combo-box
        const combo = buildArrayItemCombo(arr[i], hintOptions, (newVal) => {
          arr[i] = newVal;
          onChange([...arr]);
        });
        itemRow.appendChild(combo);
      } else {
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.value = arr[i] ?? '';
        inp.addEventListener('change', () => {
          arr[i] = inp.value;
          onChange([...arr]);
        });
        itemRow.appendChild(inp);
      }

      const removeBtn = document.createElement('button');
      removeBtn.className = 'array-remove-btn';
      removeBtn.textContent = '\u2715';
      removeBtn.title = 'Remove';
      removeBtn.addEventListener('click', () => {
        arr.splice(i, 1);
        onChange([...arr]);
        rebuild();
      });
      itemRow.appendChild(removeBtn);
      listEl.appendChild(itemRow);
    }

    // Add button
    const addBtn = document.createElement('button');
    addBtn.className = 'array-add-btn';
    addBtn.textContent = '+ Add';
    addBtn.addEventListener('click', () => {
      // Guess type from existing elements or default to string
      const sample = arr.length > 0 ? arr[0] : '';
      if (typeof sample === 'number') arr.push(0);
      else if (typeof sample === 'boolean') arr.push(false);
      else if (typeof sample === 'object' && sample !== null) arr.push({});
      else arr.push('');
      onChange([...arr]);
      rebuild();
    });
    listEl.appendChild(addBtn);
  };

  rebuild();
  valDiv.appendChild(listEl);
  return row;
}

/**
 * Build a small combo-box (select + free-text input) for a single array item.
 * Used inside createArrayRow when hint options are available.
 */
function buildArrayItemCombo(value, options, onChange) {
  const wrapper = document.createElement('div');
  wrapper.className = 'hinted-enum-row';

  const sel = document.createElement('select');
  const customOpt = document.createElement('option');
  customOpt.value = '__custom__';
  customOpt.textContent = '(custom)';
  sel.appendChild(customOpt);

  let matchFound = false;
  for (const opt of options) {
    const o = document.createElement('option');
    o.value = opt;
    o.textContent = opt;
    if (opt === value) { o.selected = true; matchFound = true; }
    sel.appendChild(o);
  }

  const inp = document.createElement('input');
  inp.type = 'text';
  inp.value = value ?? '';
  inp.style.display = matchFound ? 'none' : 'block';
  if (!matchFound) customOpt.selected = true;

  sel.addEventListener('change', () => {
    if (sel.value === '__custom__') {
      inp.style.display = 'block';
      inp.focus();
    } else {
      inp.style.display = 'none';
      inp.value = sel.value;
      onChange(sel.value);
    }
  });
  inp.addEventListener('change', () => onChange(inp.value));

  wrapper.appendChild(sel);
  wrapper.appendChild(inp);
  return wrapper;
}

function createJsonFallback(label, value, onChange) {
  const row = makeRow(label);
  const valDiv = row.querySelector('.prop-value');
  const ta = document.createElement('textarea');
  ta.value = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  ta.addEventListener('change', () => {
    try {
      onChange(JSON.parse(ta.value));
    } catch {
      onChange(ta.value);
    }
  });
  valDiv.appendChild(ta);
  return row;
}

// ============================================================
// Helpers
// ============================================================

function makeRow(label, tooltip) {
  const row = document.createElement('div');
  row.className = 'prop-row';

  const lbl = document.createElement('span');
  lbl.className = 'prop-label';
  lbl.textContent = label;
  if (tooltip) lbl.title = tooltip;
  row.appendChild(lbl);

  const val = document.createElement('div');
  val.className = 'prop-value';
  row.appendChild(val);

  return row;
}

/**
 * Recursively flatten an object into a Map of dotted-key -> leaf-value pairs.
 * Leaf values are primitives, arrays, or objects that look like vec3 / colour.
 * Nested plain objects are expanded; arrays and vec3-like objects are kept whole.
 */
function flattenKeys(obj, prefix = '') {
  const out = new Map();
  if (!obj || typeof obj !== 'object') return out;

  for (const [k, v] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${k}` : k;
    if (v === null || v === undefined) {
      out.set(fullKey, v ?? '');
    } else if (Array.isArray(v)) {
      // Keep arrays as leaf values (vec3 or generic array)
      out.set(fullKey, v);
    } else if (typeof v === 'object') {
      if (isVec3Object(v)) {
        // Keep vec3-shaped objects as leaf
        out.set(fullKey, v);
      } else {
        // Recurse into nested object
        // Also add the parent key so it can be suppressed if children exist
        out.set(fullKey, v);
        const children = flattenKeys(v, fullKey);
        for (const [ck, cv] of children) out.set(ck, cv);
      }
    } else {
      out.set(fullKey, v);
    }
  }
  return out;
}

/**
 * Get a potentially nested value using a dotted key path.
 */
function getNestedValue(obj, key) {
  if (!obj || !key) return undefined;
  if (!key.includes('.')) return obj[key];
  const parts = key.split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[p];
  }
  return cur;
}
