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


