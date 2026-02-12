/**
 * assetLibrary.js - Asset browser panel.
 * Fetches available GLTF/GLB models from the server and lets the user
 * click-to-place them in the viewport with a ghost preview.
 */
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export class AssetLibrary {
  /**
   * @param {HTMLElement} containerEl  The #asset-list element
   * @param {import('./viewport.js').Viewport} viewport
   * @param {Function} onPlaced  Called with (gltfScene, position) when object is placed
   */
  constructor(containerEl, viewport, onPlaced) {
    this.container = containerEl;
    this.viewport = viewport;
    this.onPlaced = onPlaced;
    this.loader = new GLTFLoader();
    this.models = [];       // { name, url }
    this._cache = new Map(); // url -> gltf.scene (cloneable)
    this._activeItem = null;

    this.refresh();
  }

  /** Fetch model list from the server */
  async refresh() {
    try {
      const res = await fetch('/api/models');
      const data = await res.json();
      this.models = (data.models || []).map(name => ({
        name,
        url: `/models/${name}`,
      }));
    } catch (err) {
      console.warn('Failed to fetch models:', err);
      this.models = [];
    }
    this._render();
  }

  /** Re-render the asset list UI */
  _render() {
    this.container.innerHTML = '';

    if (this.models.length === 0) {
      const p = document.createElement('p');
      p.className = 'placeholder-text';
      p.textContent = 'No models found in src/assets/models/';
      this.container.appendChild(p);
      return;
    }

    for (const model of this.models) {
      const div = document.createElement('div');
      div.className = 'asset-item';
      div.innerHTML = `<span class="asset-icon">&#9649;</span>${model.name}`;
      div.addEventListener('click', () => this._onAssetClick(model, div));
      this.container.appendChild(div);
    }
  }

  async _onAssetClick(model, el) {
    // Toggle off if already selected
    if (this._activeItem === el) {
      this.viewport.exitPlacementMode();
      el.classList.remove('active');
      this._activeItem = null;
      return;
    }

    // Deselect previous
    if (this._activeItem) {
      this._activeItem.classList.remove('active');
      this.viewport.exitPlacementMode();
    }

    el.classList.add('active');
    this._activeItem = el;

    try {
      const scene = await this._loadModel(model.url);
      const ghost = scene.clone(true);
      ghost.name = model.name.replace(/\.(glb|gltf)$/i, '');

      this.viewport.enterPlacementMode(ghost, (position) => {
        // Create a real copy and place it
        const placed = scene.clone(true);
        placed.name = model.name.replace(/\.(glb|gltf)$/i, '');
        placed.position.copy(position);

        // Deep-copy userData
        placed.traverse((node) => {
          node.userData = JSON.parse(JSON.stringify(node.userData || {}));
        });

        this.viewport.sceneRoot.add(placed);
        this.viewport.exitPlacementMode();
        this.viewport.select(placed);

        el.classList.remove('active');
        this._activeItem = null;

        if (this.onPlaced) this.onPlaced(placed, position);
      });
    } catch (err) {
      console.error('Failed to load model:', model.url, err);
      el.classList.remove('active');
      this._activeItem = null;
    }
  }

  async _loadModel(url) {
    if (this._cache.has(url)) return this._cache.get(url);
    const gltf = await this.loader.loadAsync(url);
    this._cache.set(url, gltf.scene);
    return gltf.scene;
  }
}
