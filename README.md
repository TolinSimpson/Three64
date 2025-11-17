# Three64 Engine

A lightweight Three.js-based engine with Ammo.js physics and a Blender-driven authoring workflow.

Default engine settings are set to emulate the Nintendo64's constraints.

This README is a quick-start. Full docs live in `src/docs/pages/` and render directly on GitHub.

## Features
- Three.js renderer with scene/skybox management
- Ammo.js physics (rigidbodies, raycasts)
- AI navigation (navmesh + agent steering)
- Character controller and locomotion
- Event and input systems
- UI system (HUD, stat bars)
- Inventory and item framework
- Particles and projectile utilities
- Audio system
- Loading screen and main/settings menus
- Asset pipeline + Blender add-on/exporter

## Requirements
- Node.js 18+

## Install
```bash
npm install
```

## Develop (watch + live reload)
```bash
npm run dev
# open http://localhost:5173
```

## Build (outputs to public/build)
```bash
npm run build
```

## Serve static (no watch)
```bash
npm run serve
# then open http://localhost:5173/
```

Notes:
- Production builds disable dev mode and do not include `/public/docs`.
- Entry: `src/runtime/engine.js` → Output: `public/build/runtime.js`.

In development, press F1 for the debug overlay. An “Open Docs” button appears there (dev-only). Production builds keep dev features disabled.

## Documentation
- Getting Started
  - [Intro](https://github.com/TolinSimpson/Three64/blob/main/src/docs/pages/intro.md)
  - [Setup & Build](https://github.com/TolinSimpson/Three64/blob/main/src/docs/pages/setup-build.md)
  - [Scene Conventions](https://github.com/TolinSimpson/Three64/blob/main/src/docs/pages/scene-conventions.md)
  - [Assets Folder Structure](https://github.com/TolinSimpson/Three64/blob/main/src/docs/pages/assets-folder-structure.md)
- Asset Authoring (Blender)
  - [Asset Authoring](https://github.com/TolinSimpson/Three64/blob/main/src/docs/pages/asset-authoring.md)
  - [Blender add-on README](https://github.com/TolinSimpson/Three64/blob/main/src/blender/README.md)
- API
  - [Architecture Overview](https://github.com/TolinSimpson/Three64/blob/main/src/docs/pages/api-architecture.md)
  - [Runtime Overview](https://github.com/TolinSimpson/Three64/blob/main/src/docs/pages/api-runtime.md)
  - Runtime Modules
    - [Agent](https://github.com/TolinSimpson/Three64/blob/main/src/docs/pages/runtime-agent.md)
    - [Archetypes](https://github.com/TolinSimpson/Three64/blob/main/src/docs/pages/runtime-archetypes.md)
    - [Asset Loader](https://github.com/TolinSimpson/Three64/blob/main/src/docs/pages/runtime-assetLoader.md)
    - [Audio System](https://github.com/TolinSimpson/Three64/blob/main/src/docs/pages/runtime-audioSystem.md)
    - [Character Controller](https://github.com/TolinSimpson/Three64/blob/main/src/docs/pages/runtime-characterController.md)
    - [Component](https://github.com/TolinSimpson/Three64/blob/main/src/docs/pages/runtime-component.md)
    - [Debug](https://github.com/TolinSimpson/Three64/blob/main/src/docs/pages/runtime-debug.md)
    - [Engine](https://github.com/TolinSimpson/Three64/blob/main/src/docs/pages/runtime-engine.md)
    - [Event System](https://github.com/TolinSimpson/Three64/blob/main/src/docs/pages/runtime-eventSystem.md)
    - [Healthbar Component](https://github.com/TolinSimpson/Three64/blob/main/src/docs/pages/runtime-healthbarComponent.md)
    - [Input](https://github.com/TolinSimpson/Three64/blob/main/src/docs/pages/runtime-input.md)
    - [Inventory](https://github.com/TolinSimpson/Three64/blob/main/src/docs/pages/runtime-inventory.md)
    - [IO](https://github.com/TolinSimpson/Three64/blob/main/src/docs/pages/runtime-io.md)
    - [Item](https://github.com/TolinSimpson/Three64/blob/main/src/docs/pages/runtime-item.md)
    - [Loading Screen](https://github.com/TolinSimpson/Three64/blob/main/src/docs/pages/runtime-loadingScreen.md)
    - [Navmesh](https://github.com/TolinSimpson/Three64/blob/main/src/docs/pages/runtime-navmesh.md)
    - [Particle System](https://github.com/TolinSimpson/Three64/blob/main/src/docs/pages/runtime-particleSystem.md)
    - [Physics](https://github.com/TolinSimpson/Three64/blob/main/src/docs/pages/runtime-physics.md)
    - [Player](https://github.com/TolinSimpson/Three64/blob/main/src/docs/pages/runtime-player.md)
    - [Pool](https://github.com/TolinSimpson/Three64/blob/main/src/docs/pages/runtime-pool.md)
    - [Projectile](https://github.com/TolinSimpson/Three64/blob/main/src/docs/pages/runtime-projectile.md)
    - [Raycaster](https://github.com/TolinSimpson/Three64/blob/main/src/docs/pages/runtime-raycaster.md)
    - [Renderer](https://github.com/TolinSimpson/Three64/blob/main/src/docs/pages/runtime-renderer.md)
    - [Rigidbody](https://github.com/TolinSimpson/Three64/blob/main/src/docs/pages/runtime-rigidbody.md)
    - [Scene](https://github.com/TolinSimpson/Three64/blob/main/src/docs/pages/runtime-scene.md)
    - [Skybox](https://github.com/TolinSimpson/Three64/blob/main/src/docs/pages/runtime-skybox.md)
    - [Statistic](https://github.com/TolinSimpson/Three64/blob/main/src/docs/pages/runtime-statistic.md)
    - [Statistic Bar](https://github.com/TolinSimpson/Three64/blob/main/src/docs/pages/runtime-statisticBar.md)
    - [UI System](https://github.com/TolinSimpson/Three64/blob/main/src/docs/pages/runtime-uiSystem.md)
    - [Volume](https://github.com/TolinSimpson/Three64/blob/main/src/docs/pages/runtime-volume.md)
