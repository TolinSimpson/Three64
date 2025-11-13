'use strict';

# runtime/projectile.js

`Projectile` is a pooled, physics-driven projectile component. It can be spawned at a position, travel in a direction at a given speed, and apply damage to a `Statistic` named `health` (e.g., the Player). It is designed to work with the engine's `PoolManager` via an archetype named `Projectile`.

## API
- `class Projectile extends Component`
  - `fire({ position, direction, speed, shooter })`: Activates the projectile, placing it at `position`, pointing toward `direction`, with optional `speed` override. `shooter` is stored to help avoid self-hits (reserved).
  - `reset()`: Deactivates and zeroes velocity for re-use in pool.
  - Lifecycle:
    - `Initialize()`: Sets up a visual sphere (if none), adds a dynamic rigid body when physics is available, and ensures velocity is zeroed.
    - `FixedUpdate(dt)`: Maintains lifetime, ray-sweeps for impacts, and proximity-checks the Player rig to apply damage, then returns to pool when expired/hit.

## Parameters
- `speed` (number): initial speed (m/s). Default `12`.
- `damage` (number): damage applied to `health`. Default `10`.
- `radius` (number): visual/physics radius. Default `0.1`.
- `lifeSeconds` (number): lifetime before auto-despawn. Default `4`.
- `gravity` (boolean): if true, allow physics gravity (otherwise travels on set velocity). Default `false`.
- `shape` (string): physics shape (`sphere` | `box` | `capsule` | `convex`). Default `sphere`.
- `mass` (number): rigidbody mass. Default `0.2`.

Default component data lives at `src/assets/default-component-data/projectile.json`.

## Pooling and Archetype
The engine registers an archetype named `Projectile` that constructs a simple visible sphere, binds a `Projectile` component, and initializes it. The `PoolManager` can `prewarm` or `obtain` this archetype:

```js
// Prewarm some bullets
app.pool.prewarm('Projectile', 16, { overrides: { speed: 16, damage: 8 } });

// Spawn and fire one manually
const obj = app.pool.obtain('Projectile', { overrides: { speed: 20 } });
app.rendererCore.scene.add(obj);
const proj = (obj.__components || []).find(c => (c.propName||c.constructor?.name||'').toLowerCase() === 'projectile');
proj.reset();
proj.fire({ position: start, direction: dir, shooter: null });
```

When the projectile lifetime ends or it hits, it calls `reset()` and returns itself to the pool (`PoolManager.release(obj)`).

## Integration with Agents (ranged)
`Agent` gained a new behavior `ranged`:
- It faces the Player and fires pooled `Projectile` instances when within `attackRange`.
- Tunables on the `Agent` side:
  - `fireRate` (shots/sec), `projectileArchetype` (default `Projectile`), `projectileSpeed`, `projectileDamage`, `attackRange`.

Example `Agent` config for a ranged NPC:
```js
{
  "component": "Agent",
  "behavior": "ranged",
  "useNavMesh": true,
  "attackRange": 12,
  "fireRate": 0.8,
  "projectileArchetype": "Projectile",
  "projectileSpeed": 14,
  "projectileDamage": 10
}
```

## Damage application
On impact or close proximity to the Player rig, the projectile searches for a `Statistic` component named `health` and applies a negative delta equal to `damage`. The UI (via `UISystem`) listens to `health` updates and reflects changes if the default HUD is present.


