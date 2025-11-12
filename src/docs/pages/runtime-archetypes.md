### Archetypes, Traits, Pooling, and Instancing

This runtime replaces per-object components authored in Blender with a simpler, prefab-style authoring model:

- Archetypes: named prefabs you register at runtime that produce entities (Three.js objects and data).
- Traits: boolean or small-parameter tags on entities that systems can query.
- Pooling: entities are obtained/released from per-archetype pools.
- Instancing: repeated static meshes can be rendered using GPU instancing.

This page describes how to author these in Blender and how the runtime consumes them.

## Authoring in Blender

All authoring data lives in GLTF userData (custom properties in Blender).

- archetype: string name of the prefab to spawn at this object's transform.
- a.*: override parameters for the archetype defaults (dotted path is supported).
- t.*: traits applied to the spawned entity (booleans or small numbers/strings).
- pool.*: optional pool hints for this spawn point.
- instKey: string key for grouping identical static meshes into an InstancedMesh.
- Name tag for instancing: you can also add "[inst=key]" to the object name instead of userData.

Example userData:

```json
{
  "archetype": "enemy.grunt",
  "a.health.max": 150,
  "a.move.speed": 3.5,
  "t.mortal": true,
  "t.shoots": true,
  "pool.size": 24,
  "pool.prewarm": true
}
```

Static instancing (no archetype):

```json
{
  "instKey": "tree01"
}
```

or set the object name to: "[inst=tree01] Tree"

Notes:
- Dotted keys are expanded (e.g., a.health.max → { a: { health: { max: 150 }}}).
- Vector axes are supported with x/y/z/w in dotted keys.
- Boolean-like values accept true/"true"/1/"1".

## Runtime behavior

During scene load:

1) For each object with userData.archetype:
- The loader obtains an entity from app.pool using the archetype name and (overrides, traits).
- The entity is placed at the object's world transform.
- The authoring object is hidden (serves as a spawn marker).

2) Pool prewarm:
- If pool.prewarm is true, the loader prewarms the pool using pool.size (max across markers for that archetype).

3) Static instancing:
- Objects tagged with instKey (or name "[inst=...]") are grouped by (instKey, geometry, material).
- Groups with more than one entry are replaced by a single InstancedMesh with baked instance transforms.
- Colliders and objects with physics metadata are excluded from instancing.

## Registering archetypes

Archetypes are registered in code using the ArchetypeRegistry.

```js
import { ArchetypeRegistry } from "../runtime/component.js";

ArchetypeRegistry.register("enemy.grunt", {
  defaults: { health: { max: 100 }, move: { speed: 2.5 } },
  create(game, params, traits) {
    // Return a Three.js Object3D (Group/Mesh) configured using params/traits
    // Optionally attach systems/data via your own conventions
    const group = new THREE.Group();
    group.name = "EnemyGrunt";
    // ... build visuals / attach gameplay data ...
    return group;
  }
});
```

To spawn at runtime (outside of scene loading):

```js
const obj = game.pool.obtain("enemy.grunt", { overrides: { health: { max: 200 }}, traits: { elite: true } });
obj.position.set(0, 0, 0);
game.rendererCore.scene.add(obj);
```

Release back to pool:

```js
game.pool.release(obj);
```

Prewarm manually:

```js
game.pool.prewarm("enemy.grunt", 32);
```

## Systems and traits

Instead of per-object "components", organize game logic into systems that iterate over entities carrying certain traits or data. Traits from `t.*` are stored on the spawned object's userData at `__traits`.

Example:

```js
function updateEnemies(game, dt) {
  game.rendererCore.scene.traverse((o) => {
    const tr = o.userData && o.userData.__traits;
    if (!tr || !tr.mortal) return;
    // ... update logic ...
  });
}
game.onUpdate((dt) => updateEnemies(game, dt));
```

## Summary of Blender keys

- archetype: string, prefab name.
- a.*: dotted override params (expanded into a nested object).
- t.*: trait flags/values.
- pool.size: integer count.
- pool.prewarm: boolean.
- instKey: string for static instancing; or name tag "[inst=key]".


