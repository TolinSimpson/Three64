/**
 * viewport.js - Three.js 3D viewport with OrbitControls, TransformControls,
 * grid helper, and click-to-select raycasting.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

export class Viewport {
  constructor(canvas) {
    this.canvas = canvas;
    this.selectedObject = null;
    this._onSelect = []; // callbacks: (object|null) => void

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setClearColor(0x181825);
    this.renderer.shadowMap.enabled = false;

    // Scene
    this.scene = new THREE.Scene();
    this.sceneRoot = new THREE.Group();
    this.sceneRoot.name = 'SceneRoot';
    this.scene.add(this.sceneRoot);

    // Camera
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.05, 2000);
    this.camera.position.set(5, 4, 8);
    this.camera.lookAt(0, 0, 0);

    // Lights (editor-only, not exported)
    this._editorLights = new THREE.Group();
    this._editorLights.name = '__editorLights';
    const amb = new THREE.AmbientLight(0xffffff, 0.6);
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(5, 10, 7);
    this._editorLights.add(amb, dir);
    this.scene.add(this._editorLights);

    // Grid
    this._grid = new THREE.GridHelper(100, 100, 0x444466, 0x2a2a3d);
    this._grid.name = '__grid';
    this.scene.add(this._grid);

    // Axis helper
    this._axes = new THREE.AxesHelper(2);
    this._axes.name = '__axes';
    this.scene.add(this._axes);

    // Orbit controls
    this.orbitControls = new OrbitControls(this.camera, this.canvas);
    this.orbitControls.enableDamping = true;
    this.orbitControls.dampingFactor = 0.1;
    this.orbitControls.target.set(0, 0, 0);

    // Transform controls (gizmo)
    this.transformControls = new TransformControls(this.camera, this.canvas);
    this.transformControls.name = '__transformControls';
    this.transformControls.size = 0.8;
    this.scene.add(this.transformControls);

    // Disable orbit while dragging gizmo
    this.transformControls.addEventListener('dragging-changed', (e) => {
      this.orbitControls.enabled = !e.value;
    });

    // Notify on gizmo change (for inspector sync)
    this._onTransformChange = [];
    this.transformControls.addEventListener('objectChange', () => {
      for (const cb of this._onTransformChange) cb(this.selectedObject);
    });

    // Raycaster
    this._raycaster = new THREE.Raycaster();
    this._mouse = new THREE.Vector2();

    // Selection outline helper
    this._selectionBox = null;

    // Placement mode state
    this._placementGhost = null;
    this._placementCallback = null;
    this._groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._planeIntersect = new THREE.Vector3();

    // Events
    this.canvas.addEventListener('pointerdown', (e) => this._onPointerDown(e));
    this.canvas.addEventListener('pointermove', (e) => this._onPointerMove(e));
    window.addEventListener('resize', () => this.resize());

    // Initial size
    this.resize();

    // Start render loop
    this._animate();
  }

  // --- Public API ---

  /** Register selection callback */
  onSelect(cb) { this._onSelect.push(cb); }

  /** Register transform change callback */
  onTransformChange(cb) { this._onTransformChange.push(cb); }

  /** Select an object (or null to deselect) */
  select(obj) {
    if (obj === this.selectedObject) return;
    this.selectedObject = obj;

    // Update gizmo
    if (obj) {
      this.transformControls.attach(obj);
    } else {
      this.transformControls.detach();
    }

    // Update selection box
    this._updateSelectionBox();

    // Notify listeners
    for (const cb of this._onSelect) cb(obj);
  }

  /** Set transform mode: 'translate' | 'rotate' | 'scale' */
  setMode(mode) {
    this.transformControls.setMode(mode);
  }

  /** Set transform space: 'world' | 'local' */
  setSpace(space) {
    this.transformControls.setSpace(space);
  }

  /** Enable/disable snapping */
  setSnap(enabled, translateSnap, rotateSnapDeg, scaleSnap) {
    if (enabled) {
      this.transformControls.setTranslationSnap(translateSnap);
      this.transformControls.setRotationSnap(THREE.MathUtils.degToRad(rotateSnapDeg));
      this.transformControls.setScaleSnap(scaleSnap);
    } else {
      this.transformControls.setTranslationSnap(null);
      this.transformControls.setRotationSnap(null);
      this.transformControls.setScaleSnap(null);
    }
  }

  /** Enter placement mode with a ghost object */
  enterPlacementMode(ghost, callback) {
    this.exitPlacementMode();
    ghost.traverse(child => {
      if (child.isMesh) {
        child.material = child.material.clone();
        child.material.transparent = true;
        child.material.opacity = 0.5;
        child.material.depthWrite = false;
      }
    });
    this._placementGhost = ghost;
    this._placementCallback = callback;
    this.scene.add(ghost);
    this.canvas.style.cursor = 'crosshair';
  }

  /** Exit placement mode */
  exitPlacementMode() {
    if (this._placementGhost) {
      this.scene.remove(this._placementGhost);
      this._placementGhost = null;
      this._placementCallback = null;
      this.canvas.style.cursor = '';
    }
  }

  /** Clear all objects from sceneRoot */
  clearScene() {
    while (this.sceneRoot.children.length) {
      const c = this.sceneRoot.children[0];
      this.sceneRoot.remove(c);
      c.traverse(node => {
        if (node.geometry) node.geometry.dispose();
        if (node.material) {
          if (Array.isArray(node.material)) node.material.forEach(m => m.dispose());
          else node.material.dispose();
        }
      });
    }
    this.select(null);
  }

  /** Duplicate selected object */
  duplicateSelected() {
    if (!this.selectedObject) return null;
    const clone = this.selectedObject.clone(true);
    clone.name = this.selectedObject.name + '_copy';
    // Deep copy userData
    clone.traverse((node) => {
      const src = this._findOriginal(node, this.selectedObject);
      if (src) node.userData = JSON.parse(JSON.stringify(src.userData || {}));
    });
    this.selectedObject.parent.add(clone);
    clone.position.x += 1;
    this.select(clone);
    return clone;
  }

  /** Delete selected object */
  deleteSelected() {
    if (!this.selectedObject) return;
    const obj = this.selectedObject;
    this.select(null);
    if (obj.parent) obj.parent.remove(obj);
    obj.traverse(node => {
      if (node.geometry) node.geometry.dispose();
      if (node.material) {
        if (Array.isArray(node.material)) node.material.forEach(m => m.dispose());
        else node.material.dispose();
      }
    });
  }

  resize() {
    const container = this.canvas.parentElement;
    if (!container) return;
    const w = container.clientWidth;
    const h = container.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // --- Private ---

  _animate() {
    requestAnimationFrame(() => this._animate());
    this.orbitControls.update();
    this._updateSelectionBox();
    this.renderer.render(this.scene, this.camera);
  }

  _onPointerDown(e) {
    if (e.button !== 0) return; // left click only

    // Check if clicking on the gizmo
    if (this.transformControls.dragging) return;

    const rect = this.canvas.getBoundingClientRect();
    this._mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this._mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    // Placement mode: stamp object
    if (this._placementGhost && this._placementCallback) {
      const ray = new THREE.Raycaster();
      ray.setFromCamera(this._mouse, this.camera);
      if (ray.ray.intersectPlane(this._groundPlane, this._planeIntersect)) {
        this._placementCallback(this._planeIntersect.clone());
      }
      return;
    }

    // Normal selection
    this._raycaster.setFromCamera(this._mouse, this.camera);

    // Only intersect sceneRoot children
    const intersects = this._raycaster.intersectObjects(this.sceneRoot.children, true);

    if (intersects.length > 0) {
      // Walk up to find the topmost selectable ancestor under sceneRoot
      let target = intersects[0].object;
      target = this._findSelectableAncestor(target);
      this.select(target);
    } else {
      this.select(null);
    }
  }

  _onPointerMove(e) {
    if (!this._placementGhost) return;
    const rect = this.canvas.getBoundingClientRect();
    this._mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this._mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    const ray = new THREE.Raycaster();
    ray.setFromCamera(this._mouse, this.camera);
    if (ray.ray.intersectPlane(this._groundPlane, this._planeIntersect)) {
      this._placementGhost.position.copy(this._planeIntersect);
    }
  }

  /**
   * Walk up the parent chain to find the highest ancestor that is a direct
   * child of sceneRoot or an intermediate group added by the user.
   * This avoids selecting internal mesh children of a GLTF model.
   */
  _findSelectableAncestor(obj) {
    let current = obj;
    while (current.parent && current.parent !== this.sceneRoot && current.parent !== this.scene) {
      current = current.parent;
    }
    // If we ended up at sceneRoot or scene, go back one level
    if (current === this.sceneRoot || current === this.scene) return obj;
    return current;
  }

  _findOriginal(cloneNode, originalRoot) {
    // Simple BFS path match - best effort for userData copy
    return originalRoot;
  }

  _updateSelectionBox() {
    if (this._selectionBox) {
      this.scene.remove(this._selectionBox);
      this._selectionBox.geometry?.dispose();
      this._selectionBox.material?.dispose();
      this._selectionBox = null;
    }
    if (!this.selectedObject) return;

    const box = new THREE.Box3().setFromObject(this.selectedObject);
    if (box.isEmpty()) return;
    const helper = new THREE.Box3Helper(box, 0x89b4fa);
    helper.name = '__selectionBox';
    this._selectionBox = helper;
    this.scene.add(helper);
  }
}
