# runtime/renderer.js

## API

### `class RendererCore`
Wraps Three.js boilerplate and manages the render loop with specific retro-style constraints (low resolution, color quantization).

**Constructor:**
- `constructor(canvas)`: Initializes the WebGLRenderer, Scene, and Cameras.

**Properties:**
- `renderer`: The `THREE.WebGLRenderer`.
- `scene`: The root `THREE.Scene`.
- `camera`: The main `THREE.PerspectiveCamera`.
- `colorTarget`: `THREE.WebGLRenderTarget` (low-res buffer).
- `reducePass`: Internal pass for color quantization/dithering.

**Methods:**
- `render()`: Renders the scene to the low-res target, then applies the color reduction pass to the screen.
- `getTriangleCount() -> number`: Counts total triangles in the scene (for budgeting).
- `setDoubleSided(enabled)`: Force-enables or disables `DoubleSide` on all materials in the scene.

## Rendering Pipeline
1.  **Scene Render**: The 3D scene is rendered to `colorTarget` at `internalWidth` x `internalHeight` (defined in config, e.g., 320x240).
2.  **Post-Process**: The `colorTarget` is drawn to the screen via `reducePass`, which applies:
    -   Ordered dithering (Bayer matrix).
    -   Color quantization (simulated 5-6-5 bit depth).

## Usage

```js
// Access via App
const core = app.rendererCore;

// Add objects
core.scene.add(myMesh);

// Move camera
core.camera.position.z = 5;

// Manual render (handled by engine loop normally)
core.render();
```
