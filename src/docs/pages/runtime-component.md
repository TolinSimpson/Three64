# runtime/component.js

## API
- `class Component`: Base type for gameplay pieces.
  - Suggested lifecycle: `Initialize()`, `Update(dt)`, `Dispose()`.
- `ComponentRegistry`: `register(name, ctor)`, `get(name)`, `list()`

## Usage
```js
import { Component, ComponentRegistry } from './runtime/component.js';
class Rotate extends Component {
  Initialize() { this.speed = this.options?.speed ?? 90; }
  Update(dt) { this.object.rotation.y += (this.speed*Math.PI/180)*dt; }
}
ComponentRegistry.register('Rotate', Rotate);
```


