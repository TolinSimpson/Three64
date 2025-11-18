# runtime/engine.js

## API

### `createApp() -> App`
Bootstraps the engine, creating core systems and returning the main application instance.

**App Instance Properties:**
- `rendererCore`: Instance of `RendererCore` (Three.js wrapper).
- `physics`: Instance of `PhysicsWorld` (Ammo.js wrapper).
- `eventSystem`: Instance of `EventSystem`.
- `ui`: Instance of `UISystem`.
- `pool`: Instance of `PoolManager` (see `runtime/pool.js`).
- `budget`: Instance of `BudgetTracker`.
- `loading`: Instance of `LoadingScreen`.
- `componentInstances`: Array of all active `Component` instances.
- `toggles`: Debug toggles (e.g., `debugPhysics`, `budgetOverlay`).

**App Methods:**
- `onUpdate(fn)`: Register a custom per-frame update function `(dt, app) => void`.
- `removeComponent(component)`: Safely removes a component from the update loop.
- `setWireframe(enabled)`: Toggles wireframe mode on all scene meshes.
- `setDoubleSided(enabled)`: Toggles double-sided rendering on all scene materials.

### `config`
Global configuration object, loaded from `build/assets/config/engine-config.json` with fallbacks.

**Structure:**
- `targetFPS`: Target frame rate (e.g., 30).
- `renderer`:
  - `internalWidth`, `internalHeight`: Rendering resolution (default 640x480).
  - `defaultDoubleSided`: Whether materials are double-sided by default.
- `budgets`:
  - `trisPerFrame`, `particles`, `audio`, `ui`: limits for the budget tracker.

### Helpers
- `getInternalResolution() -> { width, height }`: Returns the configured resolution.
- `tmemBytesForTexture({ width, height, bpp, paletteBytes })`: Calculates estimated texture memory.
- `fitsInTMEM(...)`: Checks if a texture fits within the configured budget.
- `uiSpriteWithinBudget(...)`, `uiAtlasWithinBudget(...)`: Budget checks for UI assets.

## Usage

```js
import { createApp, config } from './runtime/engine.js';

// Bootstrap
const app = await createApp();

// Access systems
app.rendererCore.camera.position.set(0, 5, 10);

// Register a global update hook
app.onUpdate((dt, app) => {
  console.log("Frame delta:", dt);
});

// Check config
console.log("Target FPS:", config.targetFPS);
```
