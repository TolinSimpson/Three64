/**
 * inspector.js - Property inspector panel.
 * Shows name, transform, components, and material editors for the selected object.
 */
import * as THREE from 'three';
import { readComponents, writeComponents } from './userData.js';
import { buildPropertyEditor } from './propertyEditor.js';
import { syncGeometryPreview } from './geometryBuilder.js';

export class Inspector {
  /**
   * @param {HTMLElement} containerEl  The #inspector-content element
   * @param {import('./viewport.js').Viewport} viewport
   * @param {import('./sceneContext.js').SceneContext} [context]  Scene context for hinted dropdowns
   */
  constructor(containerEl, viewport, context) {
    this.container = containerEl;
    this.viewport = viewport;
    this.context = context || null;
    this.componentDefs = [];  // loaded from /api/components
    this.actions = [];       // loaded from /api/components (actions.json)
    this._currentObject = null;

    // Listen for selection changes
    viewport.onSelect((obj) => this.inspect(obj));

    // Listen for gizmo transform changes (update number fields)
    viewport.onTransformChange((obj) => {
      if (obj === this._currentObject) this._syncTransformFields();
    });

    // Load component definitions
    this._loadComponentDefs();
  }

  async _loadComponentDefs() {
    try {
      const res = await fetch('/api/components');
      const data = await res.json();
      this.componentDefs = data.components || [];
      this.actions = data.actions || [];

      // Populate SceneContext with component type list and do initial scan
      if (this.context) {
        this.context.setComponentDefs(this.componentDefs);
        this.context.rebuild();
      }
    } catch (err) {
      console.warn('Failed to load component definitions:', err);
      this.componentDefs = [];
    }
  }

  /** Inspect an object (or null to clear) */
  inspect(obj) {
    this._currentObject = obj;
    this.container.innerHTML = '';

    if (!obj) {
      const p = document.createElement('p');
      p.className = 'placeholder-text';
      p.textContent = 'Select an object';
      this.container.appendChild(p);
      return;
    }

    // --- Name ---
    this.container.appendChild(this._buildNameSection(obj));

    // --- Transform ---
    this.container.appendChild(this._buildTransformSection(obj));

    // --- Components ---
    this.container.appendChild(this._buildComponentsSection(obj));

    // --- Materials ---
    const matSection = this._buildMaterialSection(obj);
    if (matSection) this.container.appendChild(matSection);
  }

  /** Refresh the inspector (e.g. after external changes) */
  refresh() {
    this.inspect(this._currentObject);
  }

  // ============================================================
  // Name
  // ============================================================

  _buildNameSection(obj) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'name-input';
    input.value = obj.name || '';
    input.placeholder = '<unnamed>';
    input.addEventListener('change', () => {
      obj.name = input.value;
    });
    const wrapper = document.createElement('div');
    wrapper.style.padding = '6px 4px';
    wrapper.appendChild(input);
    return wrapper;
  }

  // ============================================================
  // Transform
  // ============================================================

  _buildTransformSection(obj) {
    const group = this._makeGroup('Transform');
    const body = group.querySelector('.inspector-group-body');

    // Position
    this._posFields = this._buildVec3Row('Position', obj.position, (axis, val) => {
      obj.position[axis] = val;
    });
    body.appendChild(this._posFields.row);

    // Rotation (display as degrees)
    this._rotFields = this._buildVec3Row('Rotation',
      {
        x: THREE.MathUtils.radToDeg(obj.rotation.x),
        y: THREE.MathUtils.radToDeg(obj.rotation.y),
        z: THREE.MathUtils.radToDeg(obj.rotation.z),
      },
      (axis, val) => {
        obj.rotation[axis] = THREE.MathUtils.degToRad(val);
      }
    );
    body.appendChild(this._rotFields.row);

    // Scale
    this._scaleFields = this._buildVec3Row('Scale', obj.scale, (axis, val) => {
      obj.scale[axis] = val;
    });
    body.appendChild(this._scaleFields.row);

    return group;
  }

  _buildVec3Row(label, vec, onChange) {
    const row = document.createElement('div');
    row.className = 'prop-row';

    const lbl = document.createElement('span');
    lbl.className = 'prop-label';
    lbl.textContent = label;
    row.appendChild(lbl);

    const valDiv = document.createElement('div');
    valDiv.className = 'prop-value';

    const div = document.createElement('div');
    div.className = 'vec3-inputs';

    const inputs = {};
    for (const axis of ['x', 'y', 'z']) {
      const axisLabel = document.createElement('span');
      axisLabel.className = 'vec-label';
      axisLabel.textContent = axis.toUpperCase();
      div.appendChild(axisLabel);

      const inp = document.createElement('input');
      inp.type = 'number';
      inp.step = 'any';
      inp.value = parseFloat((vec[axis] ?? 0).toFixed(4));
      inp.addEventListener('change', () => {
        onChange(axis, parseFloat(inp.value) || 0);
      });
      div.appendChild(inp);
      inputs[axis] = inp;
    }

    valDiv.appendChild(div);
    row.appendChild(valDiv);
    return { row, inputs };
  }

  /** Sync transform number fields to current object values (after gizmo drag) */
  _syncTransformFields() {
    const obj = this._currentObject;
    if (!obj) return;

    if (this._posFields) {
      for (const a of ['x', 'y', 'z']) {
        this._posFields.inputs[a].value = parseFloat(obj.position[a].toFixed(4));
      }
    }
    if (this._rotFields) {
      for (const a of ['x', 'y', 'z']) {
        this._rotFields.inputs[a].value = parseFloat(THREE.MathUtils.radToDeg(obj.rotation[a]).toFixed(2));
      }
    }
    if (this._scaleFields) {
      for (const a of ['x', 'y', 'z']) {
        this._scaleFields.inputs[a].value = parseFloat(obj.scale[a].toFixed(4));
      }
    }
  }

  // ============================================================
  // Components
  // ============================================================

  _buildComponentsSection(obj) {
    const wrapper = document.createElement('div');

    // Read current components from userData
    const components = readComponents(obj.userData);

    // Render each component
    for (let i = 0; i < components.length; i++) {
      const comp = components[i];
      const def = this.componentDefs.find(d => d.type.toLowerCase() === comp.type.toLowerCase());

      const group = this._makeGroup(comp.type, () => {
        // Remove component
        components.splice(i, 1);
        writeComponents(obj.userData, components);
        if (this.context) this.context.rebuild();
        this.inspect(obj); // rebuild
      });
      const body = group.querySelector('.inspector-group-body');

      // Deep-merge defaults from definition with component params
      const defaultParams = def ? JSON.parse(JSON.stringify(def.params)) : {};
      const mergedParams = deepMerge(defaultParams, comp.params || {});
      const descriptions = def?.paramDescriptions || [];

      const editor = buildPropertyEditor(mergedParams, descriptions, (key, value) => {
        if (key === '__replace_all__') {
          comp.params = value;
        } else {
          setNestedValue(comp.params, key, value);
        }
        writeComponents(obj.userData, components);
        if (this.context) this.context.rebuild();

        // Live geometry preview sync
        if (comp.type === 'Geometry') {
          syncGeometryPreview(obj, comp.params);
        }
      }, this.context, comp.type, { actions: this.actions });

      body.appendChild(editor);
      wrapper.appendChild(group);
    }

    // Add Component dropdown
    wrapper.appendChild(this._buildAddComponentRow(obj, components));

    return wrapper;
  }

  _buildAddComponentRow(obj, components) {
    const row = document.createElement('div');
    row.className = 'add-component-row';

    const sel = document.createElement('select');
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '+ Add Component...';
    placeholder.disabled = true;
    placeholder.selected = true;
    sel.appendChild(placeholder);

    for (const def of this.componentDefs) {
      const opt = document.createElement('option');
      opt.value = def.type;
      opt.textContent = def.type;
      sel.appendChild(opt);
    }

    // Also allow typing a custom component name
    const customInput = document.createElement('input');
    customInput.type = 'text';
    customInput.placeholder = 'Custom...';
    customInput.style.width = '80px';

    const addBtn = document.createElement('button');
    addBtn.textContent = 'Add';
    addBtn.addEventListener('click', () => {
      const typeName = sel.value || customInput.value.trim();
      if (!typeName) return;

      // Get default params from definition
      const def = this.componentDefs.find(d => d.type === typeName);
      const params = def ? JSON.parse(JSON.stringify(def.params)) : {};

      components.push({ type: typeName, params });
      writeComponents(obj.userData, components);
      if (this.context) this.context.rebuild();
      this.inspect(obj); // rebuild
    });

    row.appendChild(sel);
    row.appendChild(customInput);
    row.appendChild(addBtn);
    return row;
  }

  // ============================================================
  // Materials
  // ============================================================

  _buildMaterialSection(obj) {
    // Collect all unique materials from the object and its descendants
    const materialEntries = new Map(); // uuid -> { material, meshNames[] }
    obj.traverse((node) => {
      if (!node.isMesh || !node.material) return;
      if (node.name.startsWith('__')) return; // skip editor helpers
      const mats = Array.isArray(node.material) ? node.material : [node.material];
      for (const mat of mats) {
        if (!materialEntries.has(mat.uuid)) {
          materialEntries.set(mat.uuid, { material: mat, meshNames: [node.name || '<mesh>'] });
        } else {
          materialEntries.get(mat.uuid).meshNames.push(node.name || '<mesh>');
        }
      }
    });

    if (materialEntries.size === 0) return null;

    const wrapper = document.createElement('div');

    // Section label
    const label = document.createElement('div');
    label.className = 'section-label';
    label.textContent = 'Materials';
    wrapper.appendChild(label);

    for (const [, { material, meshNames }] of materialEntries) {
      const title = material.name || `Material (${meshNames[0]})`;
      const group = this._makeMaterialGroup(title);
      const body = group.querySelector('.inspector-group-body');

      // Material type (read-only)
      body.appendChild(this._makeReadOnlyRow('Type', material.type));

      // --- Color ---
      if (material.color) {
        body.appendChild(this._makeMaterialColorRow('Color', material.color, () => {
          material.needsUpdate = true;
        }));
      }

      // --- Opacity ---
      body.appendChild(this._makeMaterialSliderRow('Opacity', material.opacity ?? 1, 0, 1, 0.01, (v) => {
        material.opacity = v;
        material.transparent = v < 1;
        material.needsUpdate = true;
      }));

      // --- Side ---
      const sideVal = material.side === THREE.FrontSide ? 'FrontSide'
        : material.side === THREE.BackSide ? 'BackSide' : 'DoubleSide';
      body.appendChild(this._makeMaterialEnumRow('Side', sideVal,
        ['FrontSide', 'BackSide', 'DoubleSide'], (v) => {
          material.side = v === 'FrontSide' ? THREE.FrontSide
            : v === 'BackSide' ? THREE.BackSide : THREE.DoubleSide;
          material.needsUpdate = true;
        }));

      // --- Wireframe ---
      body.appendChild(this._makeMaterialBoolRow('Wireframe', material.wireframe ?? false, (v) => {
        material.wireframe = v;
        material.needsUpdate = true;
      }));

      // --- MeshStandardMaterial / MeshPhysicalMaterial specific ---
      if ('metalness' in material) {
        body.appendChild(this._makeMaterialSliderRow('Metalness', material.metalness ?? 0, 0, 1, 0.01, (v) => {
          material.metalness = v;
          material.needsUpdate = true;
        }));
      }

      if ('roughness' in material) {
        body.appendChild(this._makeMaterialSliderRow('Roughness', material.roughness ?? 1, 0, 1, 0.01, (v) => {
          material.roughness = v;
          material.needsUpdate = true;
        }));
      }

      if (material.emissive) {
        body.appendChild(this._makeMaterialColorRow('Emissive', material.emissive, () => {
          material.needsUpdate = true;
        }));
      }

      if ('emissiveIntensity' in material) {
        body.appendChild(this._makeMaterialSliderRow('Emissive Intensity', material.emissiveIntensity ?? 1, 0, 10, 0.01, (v) => {
          material.emissiveIntensity = v;
          material.needsUpdate = true;
        }));
      }

      if ('flatShading' in material) {
        body.appendChild(this._makeMaterialBoolRow('Flat Shading', material.flatShading ?? false, (v) => {
          material.flatShading = v;
          material.needsUpdate = true;
        }));
      }

      // --- Visible ---
      body.appendChild(this._makeMaterialBoolRow('Visible', material.visible ?? true, (v) => {
        material.visible = v;
      }));

      // --- Texture maps (read-only info) ---
      const maps = [];
      if (material.map) maps.push('Diffuse');
      if (material.normalMap) maps.push('Normal');
      if (material.roughnessMap) maps.push('Roughness');
      if (material.metalnessMap) maps.push('Metalness');
      if (material.emissiveMap) maps.push('Emissive');
      if (material.aoMap) maps.push('AO');
      if (material.alphaMap) maps.push('Alpha');
      if (material.bumpMap) maps.push('Bump');
      if (material.displacementMap) maps.push('Displacement');
      if (material.envMap) maps.push('Environment');

      if (maps.length > 0) {
        body.appendChild(this._makeMapInfoRow('Texture Maps', maps));
      }

      wrapper.appendChild(group);
    }

    return wrapper;
  }

  // --- Material row helpers ---

  _makeMaterialGroup(title) {
    const group = document.createElement('div');
    group.className = 'inspector-group material-group';

    const header = document.createElement('div');
    header.className = 'inspector-group-header';

    const arrow = document.createElement('span');
    arrow.className = 'collapse-arrow';
    arrow.textContent = '\u25BC';
    header.appendChild(arrow);

    const badge = document.createElement('span');
    badge.className = 'material-badge';
    badge.textContent = 'MAT';
    header.appendChild(badge);

    const titleEl = document.createElement('span');
    titleEl.className = 'group-title';
    titleEl.textContent = title;
    header.appendChild(titleEl);

    const body = document.createElement('div');
    body.className = 'inspector-group-body';

    header.addEventListener('click', () => {
      const collapsed = body.classList.toggle('collapsed');
      arrow.classList.toggle('collapsed', collapsed);
    });

    group.appendChild(header);
    group.appendChild(body);
    return group;
  }

  _makeMaterialColorRow(label, threeColor, onChange) {
    const row = document.createElement('div');
    row.className = 'prop-row';

    const lbl = document.createElement('span');
    lbl.className = 'prop-label';
    lbl.textContent = label;
    row.appendChild(lbl);

    const valDiv = document.createElement('div');
    valDiv.className = 'prop-value';

    const wrapper = document.createElement('div');
    wrapper.className = 'color-row';

    const hexStr = '#' + threeColor.getHexString();

    const picker = document.createElement('input');
    picker.type = 'color';
    picker.value = hexStr;

    const hexInput = document.createElement('input');
    hexInput.type = 'text';
    hexInput.value = hexStr;
    hexInput.style.width = '80px';
    hexInput.style.fontFamily = 'var(--font-mono)';
    hexInput.style.fontSize = '11px';

    picker.addEventListener('input', () => {
      const hex = parseInt(picker.value.slice(1), 16);
      hexInput.value = picker.value;
      threeColor.setHex(hex);
      onChange();
    });

    hexInput.addEventListener('change', () => {
      let val = hexInput.value.trim();
      if (!val.startsWith('#')) val = '#' + val;
      const hex = parseInt(val.replace('#', ''), 16);
      if (!isNaN(hex)) {
        picker.value = '#' + hex.toString(16).padStart(6, '0');
        threeColor.setHex(hex);
        onChange();
      }
    });

    wrapper.appendChild(picker);
    wrapper.appendChild(hexInput);
    valDiv.appendChild(wrapper);
    row.appendChild(valDiv);
    return row;
  }

  _makeMaterialSliderRow(label, value, min, max, step, onChange) {
    const row = document.createElement('div');
    row.className = 'prop-row';

    const lbl = document.createElement('span');
    lbl.className = 'prop-label';
    lbl.textContent = label;
    row.appendChild(lbl);

    const valDiv = document.createElement('div');
    valDiv.className = 'prop-value';

    const sliderDiv = document.createElement('div');
    sliderDiv.className = 'slider-row';

    const range = document.createElement('input');
    range.type = 'range';
    range.min = min;
    range.max = max;
    range.step = step;
    range.value = value;

    const num = document.createElement('input');
    num.type = 'number';
    num.min = min;
    num.max = max;
    num.step = step;
    num.value = parseFloat(Number(value).toFixed(3));

    range.addEventListener('input', () => {
      num.value = parseFloat(Number(range.value).toFixed(3));
      onChange(parseFloat(range.value));
    });
    num.addEventListener('change', () => {
      range.value = num.value;
      onChange(parseFloat(num.value));
    });

    sliderDiv.appendChild(range);
    sliderDiv.appendChild(num);
    valDiv.appendChild(sliderDiv);
    row.appendChild(valDiv);
    return row;
  }

  _makeMaterialBoolRow(label, value, onChange) {
    const row = document.createElement('div');
    row.className = 'prop-row';

    const lbl = document.createElement('span');
    lbl.className = 'prop-label';
    lbl.textContent = label;
    row.appendChild(lbl);

    const valDiv = document.createElement('div');
    valDiv.className = 'prop-value';

    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.checked = !!value;
    chk.addEventListener('change', () => onChange(chk.checked));

    valDiv.appendChild(chk);
    row.appendChild(valDiv);
    return row;
  }

  _makeMaterialEnumRow(label, value, options, onChange) {
    const row = document.createElement('div');
    row.className = 'prop-row';

    const lbl = document.createElement('span');
    lbl.className = 'prop-label';
    lbl.textContent = label;
    row.appendChild(lbl);

    const valDiv = document.createElement('div');
    valDiv.className = 'prop-value';

    const sel = document.createElement('select');
    for (const opt of options) {
      const o = document.createElement('option');
      o.value = opt;
      o.textContent = opt;
      if (opt === value) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener('change', () => onChange(sel.value));

    valDiv.appendChild(sel);
    row.appendChild(valDiv);
    return row;
  }

  _makeReadOnlyRow(label, value) {
    const row = document.createElement('div');
    row.className = 'prop-row';

    const lbl = document.createElement('span');
    lbl.className = 'prop-label';
    lbl.textContent = label;
    row.appendChild(lbl);

    const valDiv = document.createElement('div');
    valDiv.className = 'prop-value';

    const span = document.createElement('span');
    span.className = 'prop-readonly';
    span.textContent = value;

    valDiv.appendChild(span);
    row.appendChild(valDiv);
    return row;
  }

  _makeMapInfoRow(label, mapNames) {
    const row = document.createElement('div');
    row.className = 'prop-row';
    row.style.alignItems = 'flex-start';

    const lbl = document.createElement('span');
    lbl.className = 'prop-label';
    lbl.textContent = label;
    row.appendChild(lbl);

    const valDiv = document.createElement('div');
    valDiv.className = 'prop-value';

    const list = document.createElement('div');
    list.className = 'map-list';
    for (const name of mapNames) {
      const tag = document.createElement('span');
      tag.className = 'map-tag';
      tag.textContent = name;
      list.appendChild(tag);
    }

    valDiv.appendChild(list);
    row.appendChild(valDiv);
    return row;
  }

  // ============================================================
  // Helpers
  // ============================================================

  _makeGroup(title, onRemove) {
    const group = document.createElement('div');
    group.className = 'inspector-group';

    const header = document.createElement('div');
    header.className = 'inspector-group-header';

    const arrow = document.createElement('span');
    arrow.className = 'collapse-arrow';
    arrow.textContent = '\u25BC';
    header.appendChild(arrow);

    const titleEl = document.createElement('span');
    titleEl.className = 'group-title';
    titleEl.textContent = title;
    header.appendChild(titleEl);

    if (onRemove) {
      const removeBtn = document.createElement('span');
      removeBtn.className = 'group-action';
      removeBtn.textContent = '\u2715';
      removeBtn.title = 'Remove component';
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        onRemove();
      });
      header.appendChild(removeBtn);
    }

    const body = document.createElement('div');
    body.className = 'inspector-group-body';

    // Toggle collapse
    header.addEventListener('click', () => {
      const collapsed = body.classList.toggle('collapsed');
      arrow.classList.toggle('collapsed', collapsed);
    });

    group.appendChild(header);
    group.appendChild(body);
    return group;
  }
}

/**
 * Set a nested value using a dotted key path.
 * E.g. setNestedValue(obj, "target.mode", "scene")
 */
function setNestedValue(obj, key, value) {
  if (!key.includes('.')) {
    obj[key] = value;
    return;
  }
  const parts = key.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (!(p in cur) || typeof cur[p] !== 'object' || cur[p] === null) cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
}

/**
 * Deep-merge source into target. Arrays and primitives are overwritten.
 * Nested plain objects are recursively merged.
 */
function deepMerge(target, source) {
  if (!source || typeof source !== 'object') return target;
  const out = { ...target };
  for (const [k, v] of Object.entries(source)) {
    if (v && typeof v === 'object' && !Array.isArray(v) &&
        out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) {
      out[k] = deepMerge(out[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}
