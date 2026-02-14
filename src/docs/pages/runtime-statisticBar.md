## StatisticBar (runtime/statisticBar.js)

A lightweight UI companion for a `Statistic`. It loads a generic bar UI and reflects the statistic’s value via events from the UISystem.

### What it does
- Loads `build/assets/ui/statbar.html` and `build/assets/css/statbar.css` into the HUD layer.
- Listens for `stat:{name}:changed` and updates the bar fill and label.

### Parameters
- **name**: string. The statistic identifier this bar reflects (e.g., `health`, `power`).

### Requirements
- UISystem is initialized (the engine already does this).
- Corresponding `Statistic` exists with the same `name` so the bar can receive updates.

### Usage
Instantiate the bar for a given statistic:

```js
import { Statistic } from "../runtime/statistic.js";
import { StatisticBar } from "../runtime/statisticBar.js";

const power = new Statistic({
  game,
  object: null,
  options: { name: 'power', min: 0, max: 100, current: 50 },
  propName: "Statistic",
});
power.Initialize?.();
game.addComponent(power);

const powerBar = new StatisticBar({
  game,
  object: null,
  options: { name: 'power' },
  propName: "StatisticBar",
});
await Promise.resolve(powerBar.Initialize?.());
game.addComponent(powerBar);
```

To change the value over time with easing:

```js
power.applyDeltaOverTime(+25, 1.0, 'easeOutQuad');
```

### Customization
You can duplicate and modify `src/assets/ui/statbar.html` and `src/assets/css/statbar.css` to create alternate looks or additional bars. Reference them by loading your custom assets inside a specialized UI component if needed.


