# Runtime Modules & APIs

This section lists primary exports for each runtime module. File paths are under `src/runtime/`.

For detailed API documentation, see the module-specific pages:

- **[Engine & Config](runtime-engine.md)** (`engine.js`): Core loop, configuration, and app instance.
- **[Component System](runtime-component.md)** (`component.js`): Base class and registries for logic and archetypes.
- **[Asset Loading](runtime-assetLoader.md)** (`assetLoader.js`): GLTF loading, scene composition, and budgeting.
- **[Input](runtime-input.md)** (`input.js`): Composite input handling (Keyboard, Gamepad, Touch).
- **[Physics](runtime-physics.md)** (`physics.js`): Ammo.js integration, colliders, and raycasting.
- **[Rendering](runtime-renderer.md)** (`renderer.js`): Three.js wrapper and retro post-processing.
- **[UI System](runtime-uiSystem.md)** (`uiSystem.js`): HTML overlay management.
- **[Audio](runtime-audioSystem.md)** (`audioSystem.js`): Simple audio playback with voice limits.
- **[Scene](runtime-scene.md)** (`scene.js`): Scene-scoped configuration (lighting, skybox).
- **[Event System](runtime-eventSystem.md)** (`eventSystem.js`): Pub/Sub messaging and game loop phases.
- **[Pooling](runtime-pool.md)** (`pool.js`): Object pooling and prewarming.

## Additional Modules

### `agent.js`
- `export class Agent extends Component`
- AI/agent behavior component (ticks per frame).

### `characterController.js`
- `export class CharacterController`
- Movement + ground checks; integrates with physics.

### `debug.js`
- `export const Debug`: Dev flags, HUD elements, CLI controls.
- `export class BudgetTracker`: Tracks triangles, particles, UI tiles, RAM.

### `io.js`
- `saveLocal(key, data)`, `loadLocal(key, fallback)`
- `downloadJSON(filename, data)`
- Utilities for saving/loading state.

### `loadingScreen.js`
- Default loading screen implementation.

### `navmesh.js`
- `export class NavMesh extends Component`
- Navmesh ingestion and queries.

### `network.js` / `multisynq.js`
- `export class NetworkSystem` / `MultisynqNetworkSystem`
- Multiplayer state replication and remote player management.

### `particleSystem.js`
- `export class ParticleSystem`
- Particle emitters/effects with per-frame budgeting.

### `projectile.js`
- `export class Projectile extends Component`
- Simple projectile logic.

### `raycaster.js`
- `export class Raycaster extends Component`
- Recurring raycast queries (e.g., for sensors).

### `rigidbody.js`
- `export class Rigidbody extends Component`
- Component wrapper for `PhysicsWorld` bodies.

### `skybox.js`
- `export function createSkybox(camera, options)`
- Procedural gradient skybox helper.

### `statistic.js` / `statisticBar.js`
- Components for tracking and displaying values (health, mana, etc.).

### `volume.js`
- `export class Volume extends Component`
- Trigger volumes (Enter/Exit/Stay events).
