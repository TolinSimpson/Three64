'use strict';

# runtime/rigidbody.js

`Rigidbody` is a general-purpose physics component that binds a Three.js `Object3D` to an Ammo rigid body via the engine's `PhysicsWorld`. It provides simple helpers for velocity/teleport and can emit collision and volume events through the `EventSystem`.

## API
- `class Rigidbody extends Component`
  - Lifecycle:
    - `Initialize()`: Creates an Ammo rigid body using `PhysicsWorld.addRigidBodyForObject(...)`. Optionally instantiates an embedded `Volume` component to emit enter/exit/stay events.
    - `FixedUpdate(dt)`: Performs a sweep test from last to current position to emit a collision event name, if configured.
  - Helpers:
    - `setVelocity(vec3)`: Sets linear velocity (or stores fallback when Ammo not present).
    - `zeroVelocity()`: Zeros linear and angular velocity.
    - `teleport(position, quaternion)`: Teleports both the visual and the rigid body.

## Parameters
- `shape` (string): `box` | `sphere` | `capsule` | `convex`. Default `box`.
- `type` (string): `dynamic` | `kinematic` | `static`. Default `dynamic`.
- `mass` (number): Mass for dynamic bodies; ignored for kinematic/static. Default `1` (dynamic) or `0` (otherwise).
- `size` ([x,y,z]): Box size (used to derive half extents).
- `radius` (number): Sphere/capsule radius.
- `height` (number): Capsule cylinder height (Y-up).
- `friction` (number)
- `restitution` (number)
- `linearDamping` (number)
- `angularDamping` (number)
- `layer` (number): Collision group bit. Default engine layer.
- `mask` (number|number[]): Collision mask bits.
- `enableGravity` (boolean): If false, per-body gravity is set to zero. Default `true`.
- `events.onCollision` (string): Event name to emit when a sweep detects impact. Default `"RigidbodyCollision"` (empty string disables).
- `useVolume` (boolean): If true, automatically adds an internal `Volume` component for trigger-like events.
- `volumeShape`, `volumeSize`, `volumeRadius`: Override volume bounds; otherwise inherit from rigidbody size/radius.
- `events.onVolumeEnter` | `events.onVolumeExit` | `events.onVolumeStay` (strings): Event names for the internal `Volume` to emit.

## Events
- Collision emissions are based on a simple sweep/raycast from last to current position during `FixedUpdate`. Payload:
  ```js
  { point, normal, distance, targetName, sourceObject }
  ```
- Volume events are delegated to the embedded `Volume` component when `useVolume` or any volume event is configured.

### Actions support
- `events.onCollision` can be either a string (emitted via `EventSystem`) or an action object/array executed by `runtime/event.js`.
  Example:
  ```json
  {
    "events": {
      "onCollision": [
        { "type": "ModifyStatistic", "params": { "name": "health", "op": "add", "value": -10, "target": "player" } }
      ]
    }
  }
  ```

## Examples
### GLTF userData
```json
{
  "component": "Rigidbody",
  "options": {
    "shape": "capsule",
    "type": "dynamic",
    "mass": 2,
    "linearDamping": 0.02,
    "events": {
      "onCollision": "RigidbodyCollision",
      "onVolumeEnter": "",
      "onVolumeExit": "",
      "onVolumeStay": ""
    }
  }
}
```

### Subscribing
```js
const bus = window.__game?.eventSystem;
bus?.onEvent("RigidbodyCollision", (payload) => {
  // payload: { point, normal, distance, targetName, sourceObject }
});
```


