# runtime/agent.js

## API
- `class Agent extends Component`: AI/navigation agent with optional navmesh pathing.

### Parameters
- `behavior` (string): `seek` | `ranged`. Defaults to `seek`.
- `turnSpeed` (number): yaw rotation speed in rad/s. Default `3.5`.
- `arriveRadius` (number): stop distance. Default `0.25`.
- `speed` (number): base move speed passed to character controller.
- `sprintMultiplier` (number): speed multiplier for sprinting.
- `useNavMesh` (boolean): enable navmesh pathfinding when a `NavMesh` exists.
- `repathInterval` (s): path recomputation period.
- Ranged-only:
  - `fireRate` (shots/sec): default `0.8`.
  - `projectileArchetype` (string): pooled archetype to spawn (default `Projectile`).
  - `projectileSpeed` (m/s): initial projectile speed. Default `14`.
  - `projectileDamage` (number): damage applied to `Statistic` named `health`. Default `10`.
  - `attackRange` (m): max distance to attempt firing. Default `12`.

### Usage
- Attach to objects via GLTF `userData` or via script.
- For pathfinding, add a `NavMesh` component somewhere in the scene and set `useNavMesh: true`.
- To make a ranged NPC:
  - Ensure `Projectile` archetype is registered (runtime registers it).
  - Set `behavior: "ranged"` and tune `fireRate`, `projectileSpeed`, `projectileDamage`, `attackRange`.

```js
// Example userData (GLTF Extras -> userData)
{
  "component": "Agent",
  "behavior": "ranged",
  "useNavMesh": true,
  "attackRange": 12,
  "fireRate": 0.8,
  "projectileDamage": 10
}
```


