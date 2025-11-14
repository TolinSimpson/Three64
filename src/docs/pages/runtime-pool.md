'use strict';

# runtime/pool.js

The pooling system consists of:
- A runtime-wide pool manager exposed as `app.pool`.
- A `Pool` component (singleton) that configures pool policies, prewarms pools, and optionally scans GLTF userData for pool hints.

## Pool Component
- `class Pool extends Component`
- Registers as `Pool` / `pool` and behaves as a singleton. If authored multiple times, later instances merge their `items` into the first.

### Options
```json
{
  "items": [
    { "archetype": "Projectile", "size": 32, "prewarm": true, "max": 64, "overflow": "drop" }
  ],
  "autoScan": true
}
```
- `items[]`: per-archetype configurations.
  - `archetype` (string): archetype name.
  - `size` (number): number of instances to pre-create.
  - `prewarm` (boolean): if true, prewarm at init.
  - `max` (number): soft cap for created instances of this archetype.
  - `overflow` (string): behavior when exceeding `max`:
    - `"create"`: allow extra creation (default).
    - `"drop"`: return `null` from `obtain`.
    - `"reuseOldest"`: recycle the oldest active instance.
- `autoScan` (boolean): when true, scans the loaded scene for GLTF userData hints and prewarms pools.

### GLTF userData hints (autoScan)
- `archetype`: string name to spawn for this marker.
- `pool.size`: integer; requested pool size hint.
- `pool.prewarm`: boolean; if true, consider this marker for prewarm.

The Pool scans all objects; for each `archetype` with `pool.prewarm=true`, it aggregates the max `pool.size` across markers and calls `app.pool.prewarm(archetype, size)`.

## Pool Manager (app.pool)
`app.pool` is available after app creation and supports:
- `prewarm(name, count, { overrides, traits })`
- `obtain(name, { overrides, traits }) -> Object3D | null`
- `release(object)`
- `setPolicy(name, { max, overflow })`

Notes:
- Internally tracks per-archetype lists: `idle`, `active`, and `createdCount`.
- Policies are enforced on `obtain()`:
  - If a `max` is set and reached:
    - `"drop"` returns `null`.
    - `"reuseOldest"` returns the oldest active instance.
    - `"create"` continues to create beyond the cap.

## Example: Configure via component
```json
{
  "component": "Pool",
  "items": [
    { "archetype": "Projectile", "size": 24, "prewarm": true, "max": 64, "overflow": "reuseOldest" }
  ],
  "autoScan": true
}
```

## Example: Authoring in GLTF (pooled Projectile)
```json
{
  "archetype": "Projectile",
  "a.speed": 14,
  "pool.size": 24,
  "pool.prewarm": true
}
```
With `autoScan` enabled on the `Pool` component, the scene will be prewarmed for `Projectile` using the largest `pool.size` found.


