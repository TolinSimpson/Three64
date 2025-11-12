# runtime/engine.js

## API
- `config`: Global configuration (renderer, budgets, flags).
- `tmemBytesForTexture({ width, height, bpp, paletteBytes })`
- `fitsInTMEM({ width, height, bpp, paletteBytes })`
- `getInternalResolution() -> { width, height }`
- `uiSpriteWithinBudget({ width, height, format, paletteBytes }) -> boolean`
- `uiAtlasWithinBudget({ width, height }) -> boolean`
- `createApp() -> app`

## Usage
```js
import { createApp } from './runtime/engine.js';
const app = createApp();
// app.rendererCore, app.physics, app.eventSystem, app.componentInstances...
```


