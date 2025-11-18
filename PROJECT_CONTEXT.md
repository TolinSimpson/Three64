# Three64 Project Context

This file provides a high-level overview of the project structure and architecture to assist LLMs in understanding the codebase.

## Project Overview
**Three64** is a lightweight, component-based game engine built on top of [Three.js](https://threejs.org/) and [Ammo.js](https://github.com/kripken/ammo.js). It is designed with "retro" constraints in mind (N64-style poly counts, texture sizes, and screen resolution) to encourage efficient content authoring.

## Directory Structure

```
Three64/
├── public/                  # Runtime output directory (served by web server)
│   ├── build/               # Generated bundles and assets (copied/processed)
│   │   ├── assets/          # Runtime assets (models, config, css, etc.)
│   │   └── runtime.js       # Main engine bundle
│   └── index.html           # Entry HTML file
├── src/
│   ├── assets/              # Source assets
│   │   ├── config/          # JSON configs (engine, scenes, keybinds)
│   │   ├── models/          # GLTF/GLB models
│   │   ├── ui/              # HTML fragments for UI layers
│   │   └── ...
│   ├── blender/             # Blender source files and add-ons
│   ├── docs/                # Documentation (Markdown)
│   ├── runtime/             # Core engine source code (ES modules)
│   └── build.js             # Custom build script (Webpack wrapper)
├── package.json             # Dependencies and scripts
└── README.md                # Quick start guide
```

## Architecture

The engine uses a hybrid Object-Oriented / Component-based architecture. It is **not** a pure ECS (Entity Component System).

### Core Modules (`src/runtime/`)

*   **`engine.js`**: The entry point. Bootstraps the application, initializes the renderer, physics, and UI systems, and manages the main game loop.
*   **`component.js`**: Defines the base `Component` class. All gameplay logic extends this. Components are attached to Three.js `Object3D` instances via an `__components` array.
*   **`assetLoader.js`**: Handles GLTF loading. Crucially, it parses `userData` from GLTF nodes to instantiate components and physics bodies at runtime.
*   **`scene.js`**: Represents a loaded scene. Can be subclassed for scene-specific logic. Manages lighting and skybox configuration.
*   **`physics.js`**: Wrapper around Ammo.js. Handles rigid body creation, constraints (joints), and raycasting.
*   **`renderer.js`**: Manages the Three.js `WebGLRenderer`, `Scene`, and `Camera`. Implements a retro post-processing pass (color quantization/dithering).
*   **`uiSystem.js`**: Manages HTML-based UI overlays (HUD, menus).
*   **`network.js` / `multisynq.js`**: Handles multiplayer networking. Supports a local relay server (LAN) or the Multisynq platform (Internet). Replicates player state and interpolates remote entities.

### Data-Driven Design & Authoring

The engine heavily relies on external assets and configuration. **Blender** acts as the primary scene editor.

1.  **Scene Manifests** (`src/assets/config/scene-manifest.json`): Defines available levels/scenes.
2.  **Engine Config** (`src/assets/config/engine-config.json`): Global settings for resolution, budget limits, and debug flags.
3.  **GLTF Authoring (Blender)**:
    *   **Scene Editor**: Blender is used to lay out levels and objects.
    *   **UserData / Custom Properties**: Components and Physics are attached to objects via Blender's "Custom Properties" panel.
    *   **Add-on**: A custom Blender add-on (`src/blender/three64_blender_addon.py`) provides a UI for selecting components and configuring their properties (which export as `userData` in GLTF).
    *   **Runtime Parsing**: `assetLoader.js` reads these properties:
        *   `userData.component`: Name of the component to attach (e.g., "Player").
        *   `userData.physics`: Physics definitions (mass, shape, friction).
        *   `userData.events`: structured data for the EventSystem (e.g. `events.onCollision`).

## Conventions

*   **Colliders**: Meshes named `COL_...` are automatically converted to invisible static colliders.
*   **LOD**: Meshes named `LOD0_`, `LOD1_` are grouped for Level-of-Detail handling.
*   **Instancing**: Objects marked with `[inst=Key]` are batched into `InstancedMesh` for performance.
*   **Scripts**: Game logic is written as ES6 modules in `src/runtime/` (or `src/components/` for custom user code) and registered via `ComponentRegistry`.

## Development Workflow

*   **Build**: `npm run build` (runs `src/build.js` -> Webpack).
*   **Dev**: `npm run dev` (watches for changes and serves `public/`).
*   **Docs**: Detailed API docs are located in `src/docs/pages/`.
