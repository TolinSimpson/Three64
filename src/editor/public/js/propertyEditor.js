/**
 * propertyEditor.js - Auto-generates form controls from paramDescriptions.
 *
 * Supports types: number, string, boolean, enum, vec3, object.
 * Falls back to a JSON textarea for unknown types or params without descriptions.
 */

/**
 * Build a DOM element containing property controls for a single component.
 *
 * @param {object}   params           Current param values
 * @param {Array}    paramDescriptions Array of { key, label, type, min, max, step, options, description }
 * @param {Function} onChange          Called with (key, value) when a property changes
 * @returns {HTMLElement}
 */
export function buildPropertyEditor(params, paramDescriptions, onChange) {
  const container = document.createElement('div');
  container.className = 'inspector-group-body';

  // Build a lookup from key -> description
  const descMap = new Map();
  if (Array.isArray(paramDescriptions)) {
    for (const d of paramDescriptions) {
      if (d.key) descMap.set(d.key, d);
    }
  }

  // Collect all keys: described ones first, then remaining params
  const allKeys = new Set();
  for (const d of (paramDescriptions || [])) {
    if (d.key) allKeys.add(d.key);
  }
  for (const k of Object.keys(params || {})) {
    allKeys.add(k);
  }

  for (const key of allKeys) {
    const desc = descMap.get(key);
    const value = getNestedValue(params, key);
    const row = createPropertyRow(key, value, desc, (newVal) => {
      onChange(key, newVal);
    });
    container.appendChild(row);
  }

  // If no keys at all, show a JSON fallback for the entire params
  if (allKeys.size === 0) {
    const row = createJsonFallback('params', params, (newVal) => {
      onChange('__replace_all__', newVal);
    });
    container.appendChild(row);
  }

  return container;
}

/**
 * Create a single property row based on the description type.
 */
function createPropertyRow(key, value, desc, onChange) {
  const type = desc?.type || guessType(value);
  const label = desc?.label || key;

  switch (type) {
    case 'number':   return createNumberRow(key, label, value, desc, onChange);
    case 'boolean':  return createBooleanRow(key, label, value, desc, onChange);
    case 'enum':     return createEnumRow(key, label, value, desc, onChange);
    case 'string':   return createStringRow(key, label, value, desc, onChange);
    case 'vec3':     return createVec3Row(key, label, value, desc, onChange);
    case 'object':   return createJsonFallback(label, value, onChange);
    default:         return createJsonFallback(label, value, onChange);
  }
}

function guessType(value) {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'string') return 'string';
  if (Array.isArray(value) && value.length === 3 && value.every(v => typeof v === 'number')) return 'vec3';
  if (value && typeof value === 'object') return 'object';
  return 'string';
}

// --- Row builders ---

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
    if (opt === value) o.selected = true;
    sel.appendChild(o);
  }
  sel.addEventListener('change', () => onChange(sel.value));
  valDiv.appendChild(sel);
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

  const arr = Array.isArray(value) ? [...value] : [0, 0, 0];
  const labels = ['X', 'Y', 'Z'];

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
      onChange([...arr]);
    });
    div.appendChild(inp);
  }

  valDiv.appendChild(div);
  return row;
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
      // If not valid JSON, pass as string
      onChange(ta.value);
    }
  });
  valDiv.appendChild(ta);
  return row;
}

// --- Helpers ---

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
 * Get a potentially nested value using a dotted key path.
 * E.g. "target.mode" gets obj.target.mode
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
