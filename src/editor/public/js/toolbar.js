/**
 * toolbar.js - Top toolbar wiring.
 * Connects buttons and inputs to viewport, GLTF I/O, and keyboard shortcuts.
 */
import * as THREE from 'three';
import { openFromFilePicker, saveToServer, exportDownload } from './gltfIO.js';

export class Toolbar {
  /**
   * @param {import('./viewport.js').Viewport} viewport
   * @param {import('./hierarchy.js').Hierarchy} hierarchy
   * @param {import('./inspector.js').Inspector} inspector
   * @param {import('./assetLibrary.js').AssetLibrary} assetLibrary
   */
  constructor(viewport, hierarchy, inspector, assetLibrary) {
    this.viewport = viewport;
    this.hierarchy = hierarchy;
    this.inspector = inspector;
    this.assetLibrary = assetLibrary;
    this._space = 'world';
    this._mode = 'translate';

    // --- DOM references ---
    this.btnNew = document.getElementById('btn-new');
    this.btnOpen = document.getElementById('btn-open');
    this.btnSave = document.getElementById('btn-save');
    this.btnExport = document.getElementById('btn-export');
    this.btnTranslate = document.getElementById('btn-translate');
    this.btnRotate = document.getElementById('btn-rotate');
    this.btnScale = document.getElementById('btn-scale');
    this.btnSpace = document.getElementById('btn-space');
    this.chkSnap = document.getElementById('chk-snap');
    this.snapTranslate = document.getElementById('snap-translate');
    this.snapRotate = document.getElementById('snap-rotate');
    this.snapScale = document.getElementById('snap-scale');
    this.statusText = document.getElementById('status-text');

    // Save dialog
    this.saveDialog = document.getElementById('save-dialog');
    this.saveFilename = document.getElementById('save-filename');
    this.saveConfirm = document.getElementById('save-confirm');
    this.saveCancel = document.getElementById('save-cancel');

    // Add menu
    this.btnAdd = document.getElementById('btn-add');
    this.addMenu = document.getElementById('add-menu');

    this._bindButtons();
    this._bindKeyboard();
    this._bindSnap();
    this._bindAddMenu();
  }

  setStatus(msg) {
    if (this.statusText) this.statusText.textContent = msg;
    // Auto-clear after a few seconds
    clearTimeout(this._statusTimer);
    this._statusTimer = setTimeout(() => {
      if (this.statusText) this.statusText.textContent = 'Three64 Editor';
    }, 4000);
  }

  _bindButtons() {
    // File operations
    this.btnNew.addEventListener('click', () => this._newScene());
    this.btnOpen.addEventListener('click', () => this._openScene());
    this.btnSave.addEventListener('click', () => this._showSaveDialog());
    this.btnExport.addEventListener('click', () => this._exportScene());

    // Transform mode
    this.btnTranslate.addEventListener('click', () => this._setMode('translate'));
    this.btnRotate.addEventListener('click', () => this._setMode('rotate'));
    this.btnScale.addEventListener('click', () => this._setMode('scale'));

    // Space
    this.btnSpace.addEventListener('click', () => this._toggleSpace());

    // Save dialog
    this.saveConfirm.addEventListener('click', () => this._doSave());
    this.saveCancel.addEventListener('click', () => {
      this.saveDialog.style.display = 'none';
    });
  }

  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      // Skip if typing in an input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

      switch (e.key.toLowerCase()) {
        case 'w': this._setMode('translate'); break;
        case 'e': this._setMode('rotate'); break;
        case 'r': this._setMode('scale'); break;
        case 'delete':
        case 'backspace':
          this.viewport.deleteSelected();
          this.hierarchy.rebuild();
          break;
        case 'd':
          if (e.ctrlKey) {
            e.preventDefault();
            this.viewport.duplicateSelected();
            this.hierarchy.rebuild();
          }
          break;
        case 'escape':
          this.viewport.exitPlacementMode();
          this.viewport.select(null);
          break;
        case 'f':
          this._focusSelected();
          break;
        case 's':
          if (e.ctrlKey) {
            e.preventDefault();
            this._showSaveDialog();
          }
          break;
        case 'a':
          if (e.shiftKey) {
            e.preventDefault();
            if (this.addMenu) {
              this.addMenu.style.display = this.addMenu.style.display === 'block' ? 'none' : 'block';
            }
          }
          break;
      }
    });
  }

  _bindAddMenu() {
    if (!this.btnAdd || !this.addMenu) return;

    // Toggle dropdown on button click
    this.btnAdd.addEventListener('click', (e) => {
      e.stopPropagation();
      const visible = this.addMenu.style.display === 'block';
      this.addMenu.style.display = visible ? 'none' : 'block';
    });

    // Handle item clicks
    this.addMenu.addEventListener('click', (e) => {
      const item = e.target.closest('[data-add]');
      if (!item) return;
      const type = item.dataset.add;
      this._addObject(type);
      this.addMenu.style.display = 'none';
    });

    // Close on outside click
    document.addEventListener('pointerdown', (e) => {
      if (!this.btnAdd.contains(e.target) && !this.addMenu.contains(e.target)) {
        this.addMenu.style.display = 'none';
      }
    });
  }

  _addObject(type) {
    let obj;
    if (type === 'empty') {
      obj = this.viewport.addEmpty();
      this.setStatus('Added Empty');
    } else {
      obj = this.viewport.addPrimitive(type);
      this.setStatus(`Added ${type.charAt(0).toUpperCase() + type.slice(1)}`);
    }
    this.hierarchy.rebuild();
    this.inspector.inspect(obj);
  }

  _bindSnap() {
    const update = () => {
      const enabled = this.chkSnap.checked;
      this.viewport.setSnap(
        enabled,
        parseFloat(this.snapTranslate.value) || 1,
        parseFloat(this.snapRotate.value) || 15,
        parseFloat(this.snapScale.value) || 0.1,
      );
    };
    this.chkSnap.addEventListener('change', update);
    this.snapTranslate.addEventListener('change', update);
    this.snapRotate.addEventListener('change', update);
    this.snapScale.addEventListener('change', update);
  }

  _setMode(mode) {
    this._mode = mode;
    this.viewport.setMode(mode);

    // Update button state
    this.btnTranslate.classList.toggle('active', mode === 'translate');
    this.btnRotate.classList.toggle('active', mode === 'rotate');
    this.btnScale.classList.toggle('active', mode === 'scale');
  }

  _toggleSpace() {
    this._space = this._space === 'world' ? 'local' : 'world';
    this.viewport.setSpace(this._space);
    this.btnSpace.textContent = this._space === 'world' ? 'World' : 'Local';
  }

  _newScene() {
    if (this.viewport.sceneRoot.children.length > 0) {
      if (!confirm('Clear the current scene? Unsaved changes will be lost.')) return;
    }
    this.viewport.clearScene();
    this.hierarchy.rebuild();
    this.inspector.inspect(null);
    this.setStatus('New scene');
  }

  async _openScene() {
    try {
      this.setStatus('Opening...');
      const scene = await openFromFilePicker();
      if (!scene) {
        this.setStatus('Open cancelled');
        return;
      }

      // Add to sceneRoot (preserving existing objects)
      // Deep-copy userData so it's editable
      scene.traverse((node) => {
        node.userData = JSON.parse(JSON.stringify(node.userData || {}));
      });

      this.viewport.sceneRoot.add(scene);
      this.hierarchy.rebuild();
      this.setStatus(`Opened ${scene.userData.__sourceFile || 'scene'}`);
    } catch (err) {
      console.error('Open failed:', err);
      this.setStatus(`Open failed: ${err.message}`);
    }
  }

  _showSaveDialog() {
    // Try to get a filename from the scene
    let defaultName = 'scene.glb';
    this.viewport.sceneRoot.traverse((node) => {
      if (node.userData?.__sourceFile) {
        defaultName = node.userData.__sourceFile;
      }
    });
    this.saveFilename.value = defaultName;
    this.saveDialog.style.display = 'flex';
    this.saveFilename.focus();
    this.saveFilename.select();
  }

  async _doSave() {
    const filename = this.saveFilename.value.trim() || 'scene.glb';
    this.saveDialog.style.display = 'none';
    await saveToServer(this.viewport.sceneRoot, filename, (msg) => this.setStatus(msg));
    // Refresh asset library in case a new file was created
    this.assetLibrary.refresh();
  }

  async _exportScene() {
    this.setStatus('Exporting...');
    try {
      let filename = 'scene.glb';
      this.viewport.sceneRoot.traverse((node) => {
        if (node.userData?.__sourceFile) filename = node.userData.__sourceFile;
      });
      await exportDownload(this.viewport.sceneRoot, filename);
      this.setStatus(`Exported ${filename}`);
    } catch (err) {
      console.error('Export failed:', err);
      this.setStatus(`Export error: ${err.message}`);
    }
  }

  _focusSelected() {
    const obj = this.viewport.selectedObject;
    if (!obj) return;
    const worldPos = new THREE.Vector3();
    obj.getWorldPosition(worldPos);
    this.viewport.orbitControls.target.copy(worldPos);
    this.viewport.orbitControls.update();
  }
}
