# Architecture Overview

Three64 is a small, component-oriented runtime designed around:
- Three.js rendering
- Optional Ammo.js physics
- Simple scene composition via components
- Tight budgets (tris, RAM, particles) to encourage efficient content

## High-level flow
1. `engine.js` boots the app, sets global `config`, creates renderer and systems, and manages budgets.
2. `scene.js` loads a scene (GLTF plus JSON), instantiates components via `component.js`.
3. Systems tick each frame: renderer, physics, audio, particles, agents, etc.
4. `debug.js` provides an overlay for HUD, toggles, and a tiny CLI in dev mode.

## Main modules
- `engine.js`: App creation, config, budgets, helper calculators, app lifecycle.
- `renderer.js`: Three.js setup and core rendering.
- `scene.js`: Scene container built from assets + components.
- `component.js`: Base `Component` class and `ComponentRegistry`.
- `assetLoader.js`: GLTF and asset loading, quantization helpers, palette budgeting.
- `physics.js`: Ammo world wrapper, stepping and raycasts.
- `player.js`, `characterController.js`, `input.js`: Player control stack.
- `particleSystem.js`, `audioSystem.js`, `skybox.js`: Feature subsystems.
- `navmesh.js`: Navmesh component/utilities.
- `eventSystem.js`: Lightweight event bus.
- `debug.js`: HUD, budget overlays, CLI, and dev toggles.

## Third‑party libraries
- Three.js: Rendering. See docs: https://threejs.org/docs
- Ammo.js: Physics. See docs: https://github.com/kripken/ammo.js
- Webpack 5: Build tooling. See docs: https://webpack.js.org/concepts/

Integration notes:
- Physics is optional; guard your code if you don’t include Ammo.
- Production builds minify and tree‑shake to keep runtime lean.

## Where it’s implemented (from README)
- Naming/prefix handling: `src/runtime/assetLoader.js` (`_processNamingConventions`)
- Components from IDs (manifest): `src/runtime/assetLoader.js` (`_instantiateProperties`)
- Components from userData (registry): `src/runtime/assetLoader.js` (`_instantiateFromUserData`)
- Fallback behaviors (colliders, default scene/assets) are handled in `assetLoader.js` with bootstrap in `engine.js`.


