# runtime/io.js

## API
- `saveLocal(key, data)`
- `loadLocal(key, fallback)`
- `downloadJSON(filename, data)`
- `serializeComponents(game)`
- `deserializeComponents(game, items)`

## Usage
```js
import { saveLocal, loadLocal } from './runtime/io.js';
saveLocal('settings', { volume: 0.8 });
const settings = loadLocal('settings', {});
```


