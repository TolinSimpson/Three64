# runtime/assetLoader.js

## API
- `class GLTFAssetLoader`: Loads `.glb/.gltf`, prepares meshes/materials.
- `class SceneLoader`: Higher-level scene orchestration/caching.
- `estimatePaletteBytes(numColors)`
- `chooseBppForColors(numColors)`
- `quantizationPlan({ width, height, numColors })`
- `normalizeHexColor(input)`

## Usage
```js
import { SceneLoader } from './runtime/assetLoader.js';
const loader = new SceneLoader();
// Typically used internally by engine/scene; direct use is optional.
```


