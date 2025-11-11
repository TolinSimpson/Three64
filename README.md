# Three64 Scene Conventions and Component System

This project uses a minimal set of name prefixes inside GLTF scenes for rendering/physics, plus a universal component system driven by GLTF node custom properties.

## Build and Local Development

Prereqs:

- Node.js 18+

Install:

```bash
npm install
```

Build the runtime bundle (outputs to `public/build/`):

```bash
npm run build
```

Run a local server and open the app:

```bash
npm run serve
# then open http://localhost:5173/
```

Live reload during development (no pre-build required):

```bash
npm run dev
# serves http://localhost:5173 with live reload
```

- This runs the bundler in watch mode and a static server with live reload.
- Changes under `src/runtime`, `src/assets/models`, `src/assets/textures`, and `src/assets/default-component-data` trigger incremental rebuilds and refresh the browser.
- In development, the entire `src/assets/models` and `src/assets/textures` folders are copied so new/changed files appear immediately. Production builds still tree‑shake assets.
- Stop with Ctrl+C. For a production-like run, use `npm run build && npm run serve`.

Notes:

- Source files live under `src/runtime`. The entrypoint is `src/runtime/engine.js`.
- Assets now live under `src/assets/`:
  - Models (`.glb`) in `src/assets/models/`
  - Textures in `src/assets/textures/`
- Custom components for dynamic import live under `src/components/`
- Scene scripts live under `src/scenes/`
- The bundle and copied assets are emitted to `public/build/` and loaded by `public/index.html`.
- Only assets referenced by scene scripts/runtime are copied into `public/build/assets/` (basic tree‑shaken copy).

## Summary

- `COL_<name>`: Static convex collider mesh. Hidden at runtime; used to build physics colliders.
- `LOD<n>_<base>`: Level-of-detail meshes. Lowest `n` is enabled by default; higher LODs are disabled.
- Component IDs (no prefix): Set a node custom property `id` (GLTF `extras` → `userData.id`) to attach scripts via the scene manifest.

If no `COL_` meshes exist in a loaded GLTF, a single convex collider is created for the whole GLTF root as a fallback.

## Details

### Colliders: `COL_<name>`

- Any mesh starting with `COL_` is hidden and used as a static convex collider.
- Colliders are built per mesh (no merge) for fine control.
- If none are present but the GLTF contains visible meshes, a fallback collider is created using the entire GLTF root (merged) as a convex hull.

### Level of Detail: `LOD<n>_<base>`

- Meshes named `LOD0_Tree`, `LOD1_Tree`, ... are grouped by `base` and sorted by `<n>`.
- Only the lowest `n` is visible by default after load; others are hidden.
- You can extend this to implement distance-based LOD switching in your gameplay code.

### Component System (GLTF node IDs)

Attach gameplay logic to specific nodes by giving them an ID through GLTF custom properties:

- In your DCC (e.g., Blender), add a custom property to a node named `id` with a string value (e.g., `NPC`, `Door`, `Tree`). This is exported to GLTF `extras` and available at runtime as `object.userData.id`.
- In the scene manifest/module, declare a `components` mapping from ID name to one or more script modules.
- Each matching node gets its own instance of the script(s).

Example manifest snippet:

```json
{
  "assets": [
    { "type": "gltf", "url": "models/tree01.glb", "transform": { "scale": 1 } }
  ],
  "components": {
    "Tree": "./scripts/leafShaker.js",
    "NPC": [
      { "script": "./scripts/npc.js", "options": { "dialogueId": "villager1" } },
      "./scripts/ambientBob.js"
    ]
  }
}
```

Script authoring options (any of these shapes work):

- Default class export:

```js
export default class {
  constructor({ game, object, options, idName }) {}
  init() {}
  update(dt) {}
  dispose() {}
}
```

- Default factory function:

```js
export default function (game, object, options, idName) {
  return {
    init() {},
    update(dt) {},
    dispose() {}
  };
}
```

- Named exports:

```js
export class Component {
  constructor({ game, object, options, idName }) {}
  init() {}
}

export function create(game, object, options, idName) {
  return { init() {} };
}
```

Notes:
- Component IDs are sourced from `userData.id` (also accepts `userData.ID` or `userData.componentId`).
- Legacy name prefixes for IDs and gameplay markers have been removed; use `userData.id` instead.

### Authoring Components via GLTF userData (Registry-based)

You can attach scripts directly on GLTF nodes using Blender custom properties (export with “Include → Custom Properties” enabled). Scripts must be registered at startup with the registry.

- Registration example:

```js
// src/runtime/component.js
import { Component, ComponentRegistry } from "./component.js";

class Rotate extends Component {
  Initialize() { this.speed = this.options?.speed ?? 90; }
  Update(dt) { this.object.rotation.y += (this.speed * Math.PI/180) * dt; }
}
ComponentRegistry.register("Rotate", Rotate);
```

- Supported userData shapes on a Blender object (any combination):
  - Single component:
    - `component: "Rotate"` (or `script: "Rotate"`)
    - Optional params: `options: { "speed": 90 }`
  - Multiple components:
    - `components: [ { "type": "Rotate", "params": { "speed": 90 } }, "Billboard" ]`
    - If Blender only allows strings: `components: "[{\"type\":\"Rotate\",\"params\":{\"speed\":90}}]"`
  - Prefixed convenience:
    - `comp.Rotate: true` → attach with defaults
    - `comp.Rotate: { "speed": 90 }` or `comp.Rotate: "{\"speed\":90}"`
    - Short form prefix also allowed: `c_Rotate: true`

At runtime, each node with matching properties creates an instance and calls `Initialize()`. Every frame, `Update(dt)` is called on all component instances.

## Default Scene and Scene Index

- `public/config/scene-manifest.json` lists available scenes: `{ "id": "...", "module": "path/to/module.js" }`.
- Scene modules are copied from `src/scenes/` to `public/scenes/` at build time.
- If the list is empty or invalid, the engine loads the built-in default scene and fetches assets from `public/build/assets/` (e.g., `models/default-scene.glb`). 

## Notes for Blender

- Set object names directly for the remaining prefixes (e.g., `COL_floor`, `LOD0_Tree`, `LOD1_Tree`).
- To attach components, add a custom property to the node:
  - `id: "YourIdName"` (string).
- To attach registry-based components, add custom properties like `component`, `components`, or `comp.Rotate` as shown above, and ensure “Custom Properties” is enabled in the glTF exporter.
- Rigidbodies via custom properties are supported for static colliders:
  - `rigidbody: { type: "STATIC" }` (or `rb: { type: "STATIC" }`) will be treated as a static collider if physics is enabled, even without `COL_`.

## Where It’s Implemented

- Parsing and prefix handling: `src/runtime/assetLoader.js` in `_processNamingConventions(...)` (supports `COL_`, `LOD*`, and collects `userData.id`).
- Component instantiation from IDs (manifest): `src/runtime/assetLoader.js` in `_instantiateProperties(...)`.
- Component instantiation from userData (registry): `src/runtime/assetLoader.js` in `_instantiateFromUserData(...)`.
- Fallbacks:
  - Whole-model collider if no `COL_` meshes.
  - Default scene loader if scenes index is empty.


## Blender Add-on: Three64 Component Data

This repository includes a Blender add-on that reads JSON definitions from `src/assets/default-component-data/` (or any folder you pick) and adds a dropdown to Object Properties (and the Custom Properties panel) to set a component ID on the selected object.

- Location in repo: `src/blender/gltf_userData.py` (install this single file or zip it)
- How to install:
  1. In Blender: Edit → Preferences → Add-ons → Install… → select `src/blender/gltf_userData.py` (or a zip containing it) → enable “Three64 Component Data”.
- Preferences:
  - “Component Data Directory” points to where your `.json` files live. It can be an absolute folder anywhere on your machine so the add-on does not need to bundle the JSON. Recommended for this repo: point it at `src/assets/default-component-data`. From the included `.blend` (`src/blender/default-scene.blend`) a convenient relative path is `//../assets/default-component-data`.
- Usage:
  - Select any object, open Object Properties → “Three64 Component” panel (or open Object Properties → “Custom Properties”).
  - Pick a value from the dropdown. The selection is mirrored into a true custom property `id` on the object so it can be exported to glTF (with “Include → Custom Properties” enabled).
  - Click the refresh icon to re-scan the directory after adding/removing JSON files.
  - If you need to change the external folder, click “Open Add-on Preferences” in the panel, then set “Component Data Directory” to the path of your `default-component-data` folder.

