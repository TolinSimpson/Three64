# runtime/eventSystem.js

## API
- `class EventSystem`: Lightweight pub/sub with fixed timestep support.
  - Phases: `input`, `fixed`, `update`, `late` via `on(phase, fn)`
  - Pub/Sub:
    - `onEvent(name, fn)`: subscribe to a named event
    - `offEvent(name, fn?)`: unsubscribe one handler or all for a name
    - `emit(name, payload)`: broadcast an event

## Usage
```js
import { EventSystem } from './runtime/eventSystem.js';
const events = new EventSystem({ fixedTimestep: 1/60, dom: document.body });

// Tick phases
events.on('update', (dt, app) => { /* per-frame logic */ });

// Named events
events.onEvent('RaycastFilteredHit', (payload) => {
  // e.g., handle raycast hit
});
events.emit('CustomEvent', { foo: 123 });
```

## Integration
- Components like `Raycaster` and `Volume` emit events you can subscribe to with `onEvent`.
- Typical event names: `RaycastHit`, `RaycastMiss`, `RaycastFilteredHit`, `VolumeEnter`, `VolumeExit`, `VolumeStay`.

