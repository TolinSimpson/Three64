'use strict';

# runtime/projectile.js

`Projectile` is a pooled, physics-driven component for bullets/missiles. It now extends `Rigidbody`, inheriting its physics setup, helpers, and event hooks. A projectile can be spawned at a position, travel in a direction at a given speed, and apply damage to a `Statistic` named `health` (e.g., the Player). It is designed to work with the engine's `PoolManager` via an archetype named `Projectile`.

## API
- `class Projectile extends Rigidbody`
  - `fire({ position, direction, speed, shooter })`: Activates the projectile, placing it at `position`, orienting toward `direction`, and applying initial velocity (overridable `speed`). `shooter` is stored to avoid self-hits (reserved).
  - `reset()`: Deactivates, zeroes velocity (via `Rigidbody.zeroVelocity()`), and hides for pool reuse.
  - Lifecycle:
    - `Initialize()`: Ensures a small visual sphere exists, then calls `Rigidbody.Initialize()` to create the physics body.
    - `FixedUpdate(dt)`: Manages lifetime, performs ray-sweep impact checks (via base/world), applies player proximity damage, and despawns on hit/timeout.

## Parameters
- `speed` (number): initial speed (m/s). Default `12`.
- `damage` (number): damage applied to `health`. Default `10`.
- `radius` (number): visual/physics radius. Default `0.1`.
- `lifeSeconds` (number): lifetime before auto-despawn. Default `4`.
- `gravity` (boolean): if true, enable gravity on the rigid body. Default `false`.
- Inherits all `Rigidbody` options (e.g., `shape`, `type`, `mass`, `friction`, `restitution`, `linearDamping`, `angularDamping`, `layer`, `mask`, `events`, `useVolume`, etc.).

Default component data lives at `src/assets/default-component-data/projectile.json`.

## Events
Projectiles inherit `Rigidbody` event capabilities:
- Collision: set `options.events.onCollision` (e.g., `"ProjectileHit"`) to receive sweep-based collision events.
- Volume: enable `useVolume` and set `events.onVolumeEnter/Exit/Stay` if you want trigger-style detection around the projectile.

```js
// Subscribe somewhere central
const bus = window.__game?.eventSystem;
bus?.onEvent("ProjectileHit", (p) => {
  // p: { point, normal, distance, targetName, sourceObject }
});
```

## Pooling and Archetype
The engine registers an archetype named `Projectile` that constructs a simple visible sphere, binds a `Projectile` component, and initializes it. The `PoolManager` can `prewarm` or `obtain` this archetype:

```js
// Prewarm some bullets
app.pool.prewarm('Projectile', 16, { overrides: { speed: 16, damage: 8 } });

// Spawn and fire one manually
const obj = app.pool.obtain('Projectile', { overrides: { speed: 20, events: { onCollision: "ProjectileHit" } } });
app.rendererCore.scene.add(obj);
const proj = (obj.__components || []).find(c => (c.propName||c.constructor?.name||'').toLowerCase() === 'projectile');
proj.reset();
proj.fire({ position: start, direction: dir, shooter: null });
```

When the projectile lifetime ends or it hits, it calls `reset()` and returns itself to the pool (`PoolManager.release(obj)`).

## Integration with Agents (ranged)
`Agent` supports ranged behaviors that fire pooled `Projectile` instances:
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


