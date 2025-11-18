# runtime/component.js

## API

### `class Component`
Base class for all gameplay logic.

**Constructor:**
- `constructor({ game, object, options, propName })`
  - `game`: Reference to the `App` instance.
  - `object`: The Three.js `Object3D` this component is attached to.
  - `options`: Configuration object (from JSON/GLTF).
  - `propName`: The name/ID of this component instance.

**Lifecycle Methods (Override these):**
- `Initialize()`: Called after instantiation. Async safe.
- `Update(dt)`: Called every frame with delta time (seconds).
- `Dispose()`: Cleanup logic. Removes component from game and object.
- `static getDefaultParams()`: Return default `options`.
- `static getParamDescriptions()`: Return editor metadata for `options`.

**Event & Action Helpers:**
- `onEvent(key, payload?)`: Executes the event handler configured in `options.events[key]`.
  - If string: emits via `game.eventSystem`.
  - If object/array: executes as Actions (see `runtime/event.js`).
- `triggerConfiguredEvent(key, payload?)`: Alias for `onEvent`.

**Query Helpers:**
- `getComponent(typeOrName)`: Find sibling component on the same object.
- `getComponents(typeOrName)`: Find all sibling components on the same object.
- `findComponent(typeOrName)`: Find first matching component globally.
- `findComponents(typeOrName)`: Find all matching components globally.

**Serialization:**
- `Serialize()`: Returns `{ type, objectId, data }`.
  - Uses `this.serializableKeys` array or `getSerializableState()` method if defined.
- `Deserialize(data)`: Restores state.
  - Uses `this.serializableKeys` or `applyDeserializedState(data)`.

### `ComponentRegistry`
Global registry for component classes.
- `register(name, class)`: Register a component class.
- `get(name)`: Retrieve a component class (case-insensitive, ignores special chars).
- `list()`: List all registered names.

### `ArchetypeRegistry`
Registry for reusable object templates (prefabs).
- `register(name, definition)`: Register an archetype. `definition` can be a factory function or an object `{ defaults, create }`.
- `create(game, name, { overrides, traits })`: Instantiates an archetype.
  - `overrides`: merged with defaults.
  - `traits`: boolean flags or values passed to creation logic.

## Usage

```js
import { Component, ComponentRegistry } from './runtime/component.js';

class Spinner extends Component {
  static getDefaultParams() { return { speed: 90 }; }

  Initialize() {
    this.speed = this.options.speed;
  }

  Update(dt) {
    if (this.object) {
      this.object.rotation.y += (this.speed * Math.PI / 180) * dt;
    }
  }
}

ComponentRegistry.register('Spinner', Spinner);
```
