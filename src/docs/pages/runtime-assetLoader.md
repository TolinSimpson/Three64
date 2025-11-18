# runtime/assetLoader.js

## API

### `class GLTFAssetLoader`
Low-level loader for GLTF/GLB files.

- `constructor(budgetTracker)`
- `load(url, onProgress, options) -> Promise<{ scene, stats }>`
  - Loads the model.
  - Patches materials (support for `doubleSided` override).
  - Enforces texture memory budgeting (calculates usage, sets filters to Nearest).
  - Updates `budgetTracker` with triangle and tile counts.

### `class SceneLoader`
High-level scene composition tool. Loads a "Scene Definition" (manifest) or a raw GLTF as a scene.

- `constructor(game)`: `game` is the App instance.
- `loadFromDefinition(def, baseUrl) -> Promise<{ objects, manifest }>`
- `loadFromUrl(manifestUrl) -> Promise<{ objects, manifest, scripts }>`
- `game`: Access the internal `Scene` component wrapper.

**Key Features:**
1.  **Asset Loading**: Fetches GLTF assets defined in the manifest.
2.  **Physics setup**:
    - Reads `userData.physics` or naming conventions (e.g., `COL_`, `UCX_`) to create colliders.
    - Supports `box`, `sphere`, `capsule`, `convex`, `mesh` shapes.
    - Supports joints via `userData.physics.joints`.
3.  **Component Instantiation**:
    - Scans `userData` for component definitions (e.g., `userData.component = "Player"`, `userData.options = {...}`).
    - Instantiates components via `ComponentRegistry`.
    - Supports "numbered" components (e.g., `component2`, `script_2`) for multiple scripts on one object.
4.  **Archetype Spawning**:
    - Scans `userData.archetype` to spawn pooled objects at markers.
5.  **Instancing**:
    - Detects `[inst=Key]` in names or `userData.instKey` to automatically batch meshes into `InstancedMesh`.

### Texture Helpers
Utilities for calculating texture budgets (N64-style limits).
- `estimatePaletteBytes(numColors)`
- `chooseBppForColors(numColors)`
- `quantizationPlan({ width, height, numColors })`
- `normalizeHexColor(input)`

## Usage

```js
import { SceneLoader } from './runtime/assetLoader.js';

// Load a scene manifest
const loader = new SceneLoader(app);
await loader.loadFromUrl('build/assets/config/scene-manifest.json');

// Or load a raw GLTF as a scene
await loader.loadFromDefinition({
  assets: [{ type: 'gltf', url: 'models/level.glb' }]
}, 'build/assets/');
```
