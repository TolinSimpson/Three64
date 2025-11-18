'use strict';
import { loadJSON } from './io.js';
import { SceneLoader } from './assetLoader.js';
import { NetworkSystem } from './network.js';
import { MultisynqNetworkSystem } from './multisynq.js';

export class MainMenu {
  constructor(game, settingsMenu) {
    this.game = game;
    this.settingsMenu = settingsMenu;
    this._initialized = false;
    this._unsubs = [];
  }

  async init() {
    if (this._initialized) return;
    await this.game.ui.loadStylesheet('main-menu.css');
    await this.game.ui.loadPageIntoLayer('menu', 'main-menu.html');
    this._wireEvents();
    this.hide(); // hidden by default until explicitly shown
    this._initialized = true;
  }

  _wireEvents() {
    this._unsubs.push(this.game.ui.on('menu:start', async () => {
      await this.startDefaultScene();
    }));
    this._unsubs.push(this.game.ui.on('menu:settings', () => {
      this.hide();
      this.settingsMenu?.show();
    }));
    this._unsubs.push(this.game.ui.on('menu:show', () => {
      this.show();
    }));

    // Multiplayer UI toggles
    this._unsubs.push(this.game.ui.on('menu:multiplayer', () => {
      this._toggleNetPanel(true);
    }));
    this._unsubs.push(this.game.ui.on('menu:net-back', () => {
      this._toggleNetPanel(false);
    }));

    // Network connect actions
    this._unsubs.push(this.game.ui.on('net:connect-lan', () => {
      const urlInput = document.getElementById('net-lan-url');
      const url = urlInput ? urlInput.value : undefined;
      // Ensure we are using the standard NetworkSystem
      if (!(this.game.network instanceof NetworkSystem)) {
        this.game.network = new NetworkSystem(this.game);
      }
      this.game.network.connect(url);
      this.startDefaultScene();
    }));

    this._unsubs.push(this.game.ui.on('net:connect-multisynq', () => {
      // Reload to force multisynq mode via URL params if not already
      // Or swap instance if we support it
      if (!(this.game.network instanceof MultisynqNetworkSystem)) {
        // Ideally we reload with ?multisynq=true, but let's try swapping dynamically
        this.game.network = new MultisynqNetworkSystem(this.game);
      }
      this.game.network.connect(); // will grab params or default
      this.startDefaultScene();
    }));
  }

  _toggleNetPanel(showNet) {
    const main = document.getElementById('menu-main-panel');
    const net = document.getElementById('menu-net-panel');
    if (main && net) {
      main.style.display = showNet ? 'none' : 'block';
      net.style.display = showNet ? 'block' : 'none';
    }
  }

  async startDefaultScene() {
    try {
      this.hide();
      this.game.loading.show('Loading scene...');
      // Prefer scene-manifest.json first entry if available; else fallback to default-scene.glb
      let def = null;
      try {
        const manifest = await loadJSON('build/assets/config/scene-manifest.json');
        const first = (manifest?.scenes || [])[0];
        if (first?.assets) {
          def = first;
        }
      } catch {}

      const baseUrl = new URL('build/assets/', document.baseURI).href;
      const loader = new SceneLoader(this.game);
      if (def) {
        await loader.loadFromDefinition(def, baseUrl);
      } else {
        const mod = await import('../assets/models/default-scene.glb');
        const url = (mod && mod.default) || mod;
        await loader.loadFromDefinition(
          { assets: [{ type: 'gltf', url, physics: { collider: 'convex', mergeChildren: true, visible: false } }] },
          new URL('.', url).href
        );
      }
      this.game.loading.setProgress(1);
      this.game.loading.hide();
    } catch (e) {
      console.error('MainMenu: failed to start scene:', e);
      try { this.game.errors.show(['Failed to load scene']); } catch {}
      this.game.loading.hide();
      this.show(); // return to menu on failure
    }
  }

  show() {
    this.game.ui.setLayerVisible('menu', true);
    // Reset to main panel
    this._toggleNetPanel(false);
  }
  hide() {
    this.game.ui.setLayerVisible('menu', false);
  }
}

export default MainMenu;
