'use strict';
import { loadJSON } from './io.js';
import { SceneLoader } from './assetLoader.js';

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
  }
  hide() {
    this.game.ui.setLayerVisible('menu', false);
  }
}

export default MainMenu;


