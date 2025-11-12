# runtime/eventSystem.js

## API
- `class EventSystem`: Lightweight pub/sub with fixed timestep support.

## Usage
```js
import { EventSystem } from './runtime/eventSystem.js';
const events = new EventSystem({ fixedTimestep: 1/60, dom: document.body });
events.on('hit', (data) => {});
events.emit('hit', { id: 1 });
```


