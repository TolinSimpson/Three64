## Statistic (runtime/statistic.js)

A generic runtime component that represents any bounded scalar value (e.g., health, stamina, mana, power, gold). It owns the authoritative value and emits UI events so overlays can reflect changes.

### Parameters
- **name**: string. Identifier used in UI events, e.g. `health`, `power`, `gold`.
- **min**: number. Lower bound (default 0).
- **max**: number. Upper bound (default 100).
- **current**: number. Initial value (default 100).
- **regenPerSec**: number. Passive change per second; positive for regen, negative for drain (default 0).
- **clamp**: boolean. If true, `current` is clamped to \[min, max] (default true).
- **easing**: string. Default easing for over-time deltas. Supported: `linear`, `easeInQuad`, `easeOutQuad`, `easeInOutCubic`.

### Methods (core API)
- `setCurrent(value: number)`: Sets the current value (respects clamping).
- `add(delta: number)`: Adds an instant delta to the current value.
- `applyDeltaOverTime(delta: number, durationSec: number, easing?: string)`: Applies delta distributed over `durationSec` with easing.
- `setMax(maxValue: number, keepRatio?: boolean)`: Sets max; optionally preserves current/max ratio.
- `setMin(minValue: number)`: Sets min and re-clamps current/max if necessary.

The component’s `Update(dt)` automatically:
- Applies `regenPerSec * dt` if configured.
- Advances any active over-time delta tween.
- Emits UI change events when the effective value changes.

### UI integration (events)
Statistic uses the UISystem’s event bus. Replace `{name}` with the configured `name` (lowercased, whitespace removed).

- Outgoing to UI:
  - `stat:{name}:changed` with payload `{ name, current, min, max }`
- Incoming intents (optional):
  - `stat:{name}:add` (payload: number)
  - `stat:{name}:damage` (payload: number; subtracts)
  - `stat:{name}:heal` (payload: number; adds)
  - `stat:{name}:set` (payload: number)
  - `stat:{name}:addOverTime` (payload: `{ delta, duration, easing? }`)

### Usage
Create a statistic and (optionally) a matching UI bar (see `StatisticBar`):

```js
import { Statistic } from "../runtime/statistic.js";
import { StatisticBar } from "../runtime/statisticBar.js";

// Health example
const health = new Statistic({
  game,
  object: null,
  options: { name: 'health', min: 0, max: 100, current: 100, regenPerSec: 0 },
  propName: "Statistic",
});
health.Initialize?.();
game.addComponent(health);

const healthBar = new StatisticBar({
  game,
  object: null,
  options: { name: 'health' },
  propName: "StatisticBar",
});
await Promise.resolve(healthBar.Initialize?.());
game.addComponent(healthBar);
```

Multiple statistics can coexist (e.g., `power`, `gold`) by creating additional `Statistic`/`StatisticBar` pairs with distinct `name` values.


