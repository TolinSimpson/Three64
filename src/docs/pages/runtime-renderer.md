# runtime/renderer.js

## API
- `class RendererCore`
  - Creates Three.js renderer, scene, camera; exposes helpers and frame render.

## Usage
```js
import { RendererCore } from './runtime/renderer.js';
const canvas = document.getElementById('app-canvas');
const rendererCore = new RendererCore(canvas);
```


