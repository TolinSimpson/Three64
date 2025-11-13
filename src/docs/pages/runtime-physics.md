## Physics authoring and runtime

- Rigidbody userData (GLTF extras) accepted on any object:
  - physics.rigidbody: { type, shape, mass, friction, restitution, linearDamping, angularDamping, layer, mask, size, radius, height }
  - Dotted keys also supported: physics.rigidbody.type, physics.shape, physics.layer, physics.mask, physics.size, physics.radius, physics.height
  - Types: dynamic | kinematic | static
  - Shapes: box | sphere | capsule | convex
  - Filters: layer (group bit), mask (int bitmask or array/“1|2|4” string)
- Name helpers:
  - COL_/UCX_/UBX_ meshes become convex colliders (hidden by default).
- Joints (constraints) via userData:
  - physics.joint.N = { type:"p2p|hinge|slider|fixed|cone", a:"ObjectA", b:"ObjectB", anchorA:[x,y,z], anchorB:[x,y,z], axisA:[x,y,z], axisB:[x,y,z], limits:[min,max] }
  - physics.joints: [ ... ] also supported
- Runtime APIs (PhysicsWorld):
  - addRigidBodyForObject(object, opts)
  - addPointToPointJoint(a, b, opts)
  - addHingeJoint(a, b, opts)
  - addSliderJoint(a, b, opts)
  - addConeTwistJoint(a, b, opts)
  - addFixedJoint(a, b)
  - removeJoint(constraint)

# runtime/physics.js

## API
- `class PhysicsWorld`
- `stepAmmo(dt)`
- `ammoRaycast(origin, direction, maxDistance)`

## Usage
```js
import { PhysicsWorld, ammoRaycast } from './runtime/physics.js';
const world = new PhysicsWorld(scene, { enableGroundPlane: true, groundY: 0 });
// Each frame:
world.step(dt);
const hit = ammoRaycast([0,1,0], [0,-1,0], 10);
```


