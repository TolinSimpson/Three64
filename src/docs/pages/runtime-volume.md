'use strict';
# runtime/volume.js

## API
- `class Volume extends Component`: Trigger volume for enter/exit/stay events.
  - Shape: `box` (size `[x,y,z]`) or `sphere` (`radius`)
  - Phase: `input` | `fixed` | `update` | `late`
  - Target collection:
    - mode `scene`: scans scene (meshes by default)
    - mode `property`: uses scene property/groups by name (see scene-conventions)
    - mode `names`: matches exact object names
  - Filters: `nameEquals`, `nameIncludes`, `hasComponent`, `userDataMatch`
  - Events: `events.onEnter`, `events.onExit`, `events.onStay` (string or actions)

### Actions support
Each event can be a string (emitted via `EventSystem`) or an action object/array executed by `runtime/event.js`.

## Example (GLTF userData)
```json
{
  "component": "Volume",
  "options": {
    "shape": "box",
    "size": [2, 1, 2],
    "phase": "update",
    "target": { "mode": "scene", "onlyMeshes": true },
    "filters": { "nameIncludes": "Player" },
    "events": {
      "onEnter": "VolumeEnter",
      "onExit": "VolumeExit",
      "onStay": "VolumeStay"
    }
  }
}
```

## Subscribe to events
```js
const bus = window.__game?.eventSystem;
bus?.onEvent("VolumeEnter", (payload) => {
  // payload: { name, userData, object? }
});
```


