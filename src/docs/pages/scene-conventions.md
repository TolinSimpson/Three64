# Scene Conventions & Component System

These authoring conventions mirror the root README and are enforced by the runtime loaders.

## Colliders: `COL_<name>`
- Any mesh named with the `COL_` prefix is hidden at runtime and used to build static convex colliders.
- If a GLTF has no `COL_` meshes but has visible meshes, the loader builds a single convex collider from the GLTF root as a fallback.

## Level of Detail: `LOD<n>_<base>`
- Meshes named `LOD0_Tree`, `LOD1_Tree`, ... are grouped by `<base>` and sorted by `<n>`.
- Only the lowest `<n>` is visible by default after load; higher LOD meshes are hidden initially.

## Component IDs via GLTF userData
Attach gameplay logic to specific nodes by adding custom properties in your DCC (e.g., Blender) and exporting with “Include → Custom Properties”.

- Set a string ID: `userData.id = "NPC"` (also accepts `ID` or `componentId`)
- In the scene manifest or registry, map IDs to scripts/components.
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

Supported script shapes:
```js
// default class
export default class {
  constructor({ game, object, options, idName }) {}
  init() {}
  update(dt) {}
  dispose() {}
}
```
```js
// default factory
export default function (game, object, options, idName) {
  return { init() {}, update(dt) {}, dispose() {} };
}
```
```js
// named exports
export class Component {
  constructor({ game, object, options, idName }) {}
  init() {}
}
export function create(game, object, options, idName) {
  return { init() {} };
}
```

## Registry-based components (GLTF userData)
You can register scripts at startup and attach via custom properties:
- Single: `component: "Rotate"` (or `script: "Rotate"`)
- Multiple: `components: [ { "type": "Rotate", "params": { "speed": 90 } }, "Billboard" ]`
- Prefixed convenience: `comp.Rotate: true` or `comp.Rotate: "{\"speed\":90}"`

At runtime, matching nodes create instances and call `Initialize()`. Every frame, `Update(dt)` runs.

## Default Scene and Scene Index
- `public/config/scene-manifest.json` lists available scenes: `{ "id": "...", "module": "path/to/module.js" }`.
- Scene modules are copied to `public/scenes/` at build time. If the list is empty/invalid, the engine loads the built‑in default scene and default assets from `public/build/assets/`.

## Project layout (from README)
- `src/runtime/**`: Engine/runtime source
- `src/assets/**`: Source assets (models, textures, config)
- `src/components/**`: Custom components for dynamic import
- `src/scenes/**`: Scene modules
- `public/build/**`: Emitted bundle + assets

## Where it’s implemented
- Naming and prefixes: `src/runtime/assetLoader.js` in `_processNamingConventions(...)`
- Components from IDs (manifest): `src/runtime/assetLoader.js` in `_instantiateProperties(...)`
- Components from userData (registry): `src/runtime/assetLoader.js` in `_instantiateFromUserData(...)`
- Fallback colliders and default scene paths are handled within `assetLoader.js` and bootstrap in `engine.js`.


