/**
 * inspector.js - Property inspector panel.
 * Shows name, transform, and component editors for the selected object.
 */
import * as THREE from 'three';
import { readComponents, writeComponents } from './userData.js';
import { buildPropertyEditor } from './propertyEditor.js';

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
      }, this.context, comp.type);

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
