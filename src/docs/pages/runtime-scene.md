# runtime/scene.js

## API

### `class Scene extends Component`
Container for scene-scoped logic and initial configuration. Can be used as a top-level wrapper or as a component within a GLTF to configure lighting/skybox.

**Configuration Options:**
```json
{
  "lighting": {
    "directional": {
      "enabled": true,
      "color": 16777215,
      "intensity": 0.8,
      "position": [1, 1, 1]
    },
    "ambient": {
      "enabled": true,
      "color": 4210752,
      "intensity": 0.5
    }
  },
  "skybox": {
    "enabled": true,
    "size": 200,
    "topColor": 7321343,
    "bottomColor": 14604208,
    "offset": 0,
    "exponent": 0.6,
    "followCamera": true
  }
}
```

**Features:**
- **Lighting**: Automatically creates Directional and Ambient lights based on config.
- **Skybox**: Creates a vertex-colored procedural skybox (gradient) that tracks the camera.
- **Proxies**: Exposes app-level systems (`rendererCore`, `physics`, `budget`) for convenience when used as a base class for scene logic.

**Integration:**
- When loading a GLTF scene, `SceneLoader` often instantiates a `Scene` component to manage these settings.
- Custom scenes can extend `Scene` to add game-specific initialization logic.

## Usage

```js
import { Scene } from './runtime/scene.js';

export default class MyLevel extends Scene {
  init() {
    // Called after lighting/skybox setup
    console.log("Level initialized");
    this.physics.addBoxColliderForObject(this.object);
  }

  Update(dt) {
    // Per-frame logic
  }
}
```
