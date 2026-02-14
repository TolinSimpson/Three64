/**
 * hierarchy.js - Scene hierarchy tree panel.
 * Shows a recursive tree of objects under sceneRoot with:
 * - Click to select (syncs viewport + inspector)
 * - Collapse/expand children
 * - Visibility toggle
 * - Drag-to-reparent
 * - Right-click context menu
 */
import * as THREE from 'three';

export class Hierarchy {
  /**
   * @param {HTMLElement} treeEl       The #hierarchy-tree element
   * @param {HTMLElement} contextEl    The #context-menu element
   * @param {import('./viewport.js').Viewport} viewport
   */
  constructor(treeEl, contextEl, viewport) {
    this.treeEl = treeEl;
    this.contextEl = contextEl;
    this.viewport = viewport;

    this._collapsed = new Set(); // object uuids that are collapsed
    this._contextTarget = null;
    this._onChanged = [];        // callbacks when hierarchy changes

    // Listen for viewport selection changes
    viewport.onSelect(() => this.rebuild());

    // Context menu click handler
    contextEl.addEventListener('click', (e) => this._onContextAction(e));

    // Hide context menu on outside click
    document.addEventListener('pointerdown', (e) => {
      if (!contextEl.contains(e.target)) {
        contextEl.style.display = 'none';
      }
    });

    // Periodic light rebuild (catches transforms, adds/removes)
    this._rebuildInterval = setInterval(() => this.rebuild(), 500);
  }

  /** Register callback for hierarchy structural changes */
  onChanged(cb) { this._onChanged.push(cb); }

  /** Rebuild the tree UI from the current sceneRoot */
  rebuild() {
    const root = this.viewport.sceneRoot;
    this.treeEl.innerHTML = '';
    for (const child of root.children) {
      this.treeEl.appendChild(this._buildNode(child, 0));
    }
  }

  _buildNode(obj, depth) {
    const div = document.createElement('div');
    div.className = 'tree-node';
    div.dataset.uuid = obj.uuid;

    const row = document.createElement('div');
    row.className = 'tree-node-row';
    if (obj === this.viewport.selectedObject) row.classList.add('selected');

    // Indent
    row.style.paddingLeft = `${depth * 14 + 4}px`;

    // Expand button
    const expandBtn = document.createElement('span');
    expandBtn.className = 'expand-btn';
    const hasChildren = obj.children && obj.children.length > 0;
    const isCollapsed = this._collapsed.has(obj.uuid);
    if (hasChildren) {
      expandBtn.textContent = isCollapsed ? '\u25B6' : '\u25BC';
      expandBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this._collapsed.has(obj.uuid)) this._collapsed.delete(obj.uuid);
        else this._collapsed.add(obj.uuid);
        this.rebuild();
      });
    }
    row.appendChild(expandBtn);

    // Name
    const nameSpan = document.createElement('span');
    nameSpan.className = 'node-name';
    nameSpan.textContent = obj.name || `<${obj.type}>`;
    row.appendChild(nameSpan);

    // Visibility toggle
    const visBtn = document.createElement('span');
    visBtn.className = 'visibility-btn';
    visBtn.textContent = obj.visible ? '\u{1F441}' : '\u25CB';
    if (!obj.visible) visBtn.classList.add('hidden-obj');
    visBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      obj.visible = !obj.visible;
      this.rebuild();
    });
    row.appendChild(visBtn);

    // Click to select
    row.addEventListener('click', () => {
      this.viewport.select(obj);
    });

    // Right-click context menu
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this._contextTarget = obj;
      this.contextEl.style.display = 'block';
      this.contextEl.style.left = `${e.clientX}px`;
      this.contextEl.style.top = `${e.clientY}px`;
    });

    // Drag start (for reparenting)
    row.draggable = true;
    row.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', obj.uuid);
      e.dataTransfer.effectAllowed = 'move';
    });

    // Drop target
    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      row.style.borderBottom = '2px solid var(--accent)';
    });
    row.addEventListener('dragleave', () => {
      row.style.borderBottom = '';
    });
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      row.style.borderBottom = '';
      const dragUuid = e.dataTransfer.getData('text/plain');
      if (dragUuid === obj.uuid) return; // Can't drop on self
      this._reparent(dragUuid, obj);
    });

    div.appendChild(row);

    // Children
    if (hasChildren && !isCollapsed) {
      const childContainer = document.createElement('div');
      childContainer.className = 'tree-children';
      for (const child of obj.children) {
        childContainer.appendChild(this._buildNode(child, depth + 1));
      }
      div.appendChild(childContainer);
    }

    return div;
  }

  _reparent(dragUuid, newParent) {
    const root = this.viewport.sceneRoot;
    let dragObj = null;

    // Find the dragged object
    root.traverse((o) => {
      if (o.uuid === dragUuid) dragObj = o;
    });

    if (!dragObj || dragObj === newParent) return;

    // Prevent parenting to own descendant
    let check = newParent;
    while (check) {
      if (check === dragObj) return;
      check = check.parent;
    }

    // Reparent (preserve world transform)
    const worldPos = dragObj.getWorldPosition(new THREE.Vector3());
    dragObj.parent?.remove(dragObj);
    newParent.add(dragObj);
    // Attempt to preserve world position
    newParent.worldToLocal(worldPos);
    dragObj.position.copy(worldPos);

    this.rebuild();
    for (const cb of this._onChanged) cb();
  }

  _onContextAction(e) {
    const action = e.target.dataset?.action;
    if (!action || !this._contextTarget) return;

    this.contextEl.style.display = 'none';
    const obj = this._contextTarget;
    this._contextTarget = null;

    switch (action) {
      case 'duplicate':
        this.viewport.select(obj);
        this.viewport.duplicateSelected();
        this.rebuild();
        for (const cb of this._onChanged) cb();
        break;

      case 'delete':
        if (obj === this.viewport.selectedObject) this.viewport.select(null);
        if (obj.parent) obj.parent.remove(obj);
        this.rebuild();
        for (const cb of this._onChanged) cb();
        break;

      case 'rename': {
        const newName = prompt('Rename object:', obj.name);
        if (newName !== null) {
          obj.name = newName;
          this.rebuild();
        }
        break;
      }

      case 'add-empty-child': {
        const empty = new THREE.Object3D();
        empty.name = 'Empty';
        empty.userData = {};

        // Add a small wireframe indicator for viewport selection
        const geo = new THREE.OctahedronGeometry(0.15, 0);
        const mat = new THREE.MeshBasicMaterial({
          color: 0xf9e2af, wireframe: true, transparent: true, opacity: 0.5,
        });
        const helper = new THREE.Mesh(geo, mat);
        helper.name = '__emptyHelper';
        empty.add(helper);

        obj.add(empty);
        this.viewport.select(empty);
        this.rebuild();
        for (const cb of this._onChanged) cb();
        break;
      }
    }
  }
}
