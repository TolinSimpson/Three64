# runtime/component.js

## API
- `class Component`: Base type for gameplay pieces.
  - Suggested lifecycle: `Initialize()`, `Update(dt)`, `Dispose()`.
- `ComponentRegistry`: `register(name, ctor)`, `get(name)`, `list()`

### Event helpers
- `onEvent(key, payload?)`: Executes the configured entry at `options.events[key]`:
  - If it's a string, emits via `EventSystem.emit(string, payload)`.
  - If it's an action or array of actions, executes them via `runtime/event.js`.
- `triggerConfiguredEvent(key, payload?)`: Alias for `onEvent`.

## Usage
```js
import { Component, ComponentRegistry } from './runtime/component.js';
class Rotate extends Component {
  Initialize() { this.speed = this.options?.speed ?? 90; }
  Update(dt) { this.object.rotation.y += (this.speed*Math.PI/180)*dt; }
}
ComponentRegistry.register('Rotate', Rotate);
```

### Example: configure actions
```json
{
  "component": "SomeComponent",
  "options": {
    "events": {
      "onHit": [
        { "type": "ModifyStatistic", "params": { "name": "health", "op": "add", "value": -5, "target": "player" } }
      ]
    }
  }
}
```


