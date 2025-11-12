# runtime/debug.js

## API
- `Debug`: dev flags, HUD elements, CLI (F1 to toggle overlay).
- `class BudgetTracker`: per-frame tallies (tris, particles, RAM, etc.).
- `initDebugOverlay(game)`: installs overlay if dev mode is enabled.

## Usage
```js
import { initDebugOverlay } from './runtime/debug.js';
// Called by engine in dev; you can call manually if needed:
initDebugOverlay(window.__game);
```


