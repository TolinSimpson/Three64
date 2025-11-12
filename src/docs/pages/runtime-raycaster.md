# runtime/raycaster.js

## API
- `class RaycasterComponent extends Component`
  - Origins: `screenCenter` | `mouse` | `object` (+ `localOffset` for object)
  - Types: `raycast`, `intersect`, `bounce`, `scatter`, `fan`
  - Filters: `nameEquals`, `nameIncludes`, `hasComponent`, `userDataMatch`
  - Events:
    - `events.onHit`: fired with first hit for the cast
    - `events.onMiss`: fired when no hit
    - `events.onFilteredHit`: per hit that passes filters
    - `events.onEachHit`: per hit for multi-ray modes

## Example (GLTF userData)
```json
{
  "component": "Raycaster",
  "options": {
    "castPhase": "update",
    "origin": "screenCenter",
    "type": "fan",
    "rays": 7,
    "fanAngleDeg": 45,
    "maxDistance": 50,
    "filters": { "nameIncludes": "Target", "hasComponent": "Healthbar" },
    "events": {
      "onHit": "RaycastHit",
      "onMiss": "RaycastMiss",
      "onFilteredHit": "RaycastFilteredHit"
    }
  }
}
```

## Subscribing
```js
window.__game?.eventSystem?.onEvent("RaycastFilteredHit", (payload) => {
  // payload: { type, origin, direction, hits[], firstHit, hit? }
});
```

