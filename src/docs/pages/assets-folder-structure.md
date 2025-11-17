# Assets Folder Structure

This page describes the purpose and expected contents of `src/assets/`. These assets are copied into the build output (`public/build/assets/`) during `npm run build` (and served directly during `npm run dev`). Keep paths and names stable—several systems rely on these conventions.

## Overview

```
src/assets/
  audio/                    # Optional audio clips (SFX, music)
  behaviours/               # Optional custom behaviour data/scripts (reserved)
  config/                   # Engine and authoring manifests/configuration
  css/                      # UI stylesheets
  default-component-data/   # JSON presets for components (used by runtime + Blender add‑on)
  models/                   # GLB models (scenes, props, etc.)
  textures/                 # Images used by materials, particles, UI
  ui/                       # HTML fragments for built‑in UI (HUD/menus)
```

Notes:
- Production builds may optimize and tree‑shake assets, but folder names remain the same in output.
- The Blender add‑on expects component presets in `default-component-data/`. See “Asset Authoring” for setup.

## `config/`
Centralized JSON configuration consumed by the runtime and authoring tools:

- `action-manifest.json`: Declarative list of Actions available to the Event System (for authoring in Blender and execution at runtime).
- `component-manifest.json`: Registry metadata for components (ids, labels, default options) used by authoring tooling.
- `engine-config.json`: Global engine toggles and budgets (e.g., tris, textures, particles).
- `keybinds.json`: Default input bindings for the player/input system.
- `scene-manifest.json`: Lists scenes available to load (ids, model paths, and optional metadata).
- `settings.json`: Default user-facing settings (graphics, audio, controls) surfaced in the Settings menu.

These files are read at startup by `src/runtime/engine.js`, `assetLoader.js`, and related modules.

## `default-component-data/`
JSON presets for runtime components (e.g., `rigidbody.json`, `navmesh.json`, `player.json`). Presets provide sane defaults and are used by:

- The runtime when instantiating components, especially for bootstrap and fallback behaviours.
- The Blender add‑on to populate per‑object component property UIs.

You can add or tweak presets to match your game’s expected defaults. When editing presets, reload the Blender add‑on data if you’re authoring in Blender.

## `models/`
Place exported `.glb` files here (levels, props, skyboxes). Recommended practices:

- Prefer `.glb` (binary glTF) with applied transforms where appropriate.
- Keep meshes and materials lean—budgets emulate N64‑like constraints.
- Name meshes and use `userData` for component hints when applicable.

See also: “Asset Authoring (Blender)” and “Scene Conventions” pages.

## `textures/`
Images for materials, particles, and UI. Keep sizes/palette tight for performance. Common files include `default-texture.png`, `environment-texture.png`, and per‑asset textures (e.g., `grass.png`, `tree.png`).

## `ui/`
HTML fragments used by the built‑in UI system (HUD, overlays, menus):

- `debug-overlay.html`, `healthbar.html`, `statbar.html`, `main-menu.html`, `settings-menu.html`

These are loaded by `src/runtime/uiSystem.js` and related modules.

## `css/`
Stylesheets for the UI fragments (mirrors names in `ui/`). Keep CSS minimal and scoped to the provided markup.

## `audio/`
Optional folder for audio assets (SFX, music). Refer to them from content or systems as needed.

## `behaviours/`
Reserved for custom behaviour data/scripts if your project needs them. This folder is optional and empty by default.

## Build & runtime notes

- Dev mode serves files directly from `src/assets/`; production copies to `public/build/assets/` with optimizations.
- Some runtime features add fallback data during bootstrap (e.g., default scene, default textures) if required files are missing.
- Paths referenced in config/manifests should remain stable to avoid broken links at load time.

## Related docs

- Asset Authoring (Blender): `src/docs/pages/asset-authoring.md`
- Scene Conventions: `src/docs/pages/scene-conventions.md`
- Runtime Overview: `src/docs/pages/api-runtime.md`


