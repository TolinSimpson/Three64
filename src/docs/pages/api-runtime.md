# Runtime Modules & APIs

This section lists primary exports for each runtime module. File paths are under `src/runtime/`.

## agent.js
- `export class Agent extends Component`
  - AI/agent behavior component (ticks per frame via scene/engine).

## assetLoader.js
- `export class GLTFAssetLoader`
  - Loads `.glb/.gltf`, resolves textures, prepares meshes/materials.
- `export class SceneLoader`
  - High-level scene asset orchestration and caching.
- `export function estimatePaletteBytes(numColors: number): number`
- `export function chooseBppForColors(numColors: number): 4|8|16`
- `export function quantizationPlan({ width, height, numColors })`
- `export function normalizeHexColor(input: string|number): string`
  - Helpers for texture/palette budgeting and color handling.

## audioSystem.js
- `export class AudioSystem`
  - Simple audio layer; tracks voice counts for budget display.

## characterController.js
- `export class CharacterController`
  - Movement + ground checks; integrates with physics when available.

## component.js
- `export class Component`
  - Base type for all gameplay pieces; override lifecycle as needed.
- `export const ComponentRegistry`
  - Register component constructors and fetch by name.

## debug.js
- `export const Debug`
  - Dev flags, HUD elements, CLI controls.
- `export class BudgetTracker`
  - Tracks triangles, particles, UI tiles, RAM, etc., per frame.
- Other internal helpers manage overlay and keybindings (F1–F4).

## engine.js
- `export const config`
  - Global configuration including budgets and expansion pak flags.
- `export function tmemBytesForTexture(...)`
- `export function fitsInTMEM(...)`
- `export function getInternalResolution()`
- `export function uiSpriteWithinBudget(...)`
- `export function uiAtlasWithinBudget(...)`
- `export function createApp()`
  - App bootstrapping; wires systems and exposes minimal game API.

## eventSystem.js
- `export class EventSystem`
  - Lightweight pub/sub for gameplay events.

## input.js
- `export class Input`
  - Keyboard/mouse/gamepad abstraction feeding player/controller.

## io.js
- `export function saveLocal(key, data)`
- `export function loadLocal(key, fallback)`
- `export function downloadJSON(filename, data)`
- `export function serializeComponents(game)`
- `export function deserializeComponents(game, items)`
  - Utilities for saving/loading and component state serialization.

## loadingScreen.js
- Loading screen module displayed during heavy asset loads.

## navmesh.js
- `export class NavMesh extends Component`
  - Navmesh ingestion + queries for agents or controllers.

## particleSystem.js
- `export class ParticleSystem`
  - Particle emitters/effects with per-frame budgeting.

## rigidbody.js
- `export class Rigidbody extends Component`
  - General-purpose Ammo rigid body component with simple collision and volume events.

## physics.js
- `export class PhysicsWorld`
  - Ammo world wrapper; manages bodies and simulation step.
- `export function stepAmmo(dt)`
- `export function ammoRaycast(origin, direction, maxDistance)`

## player.js
- `export class Player extends Component`
  - Player entity wiring input + controller + camera hooks.

## renderer.js
- `export class RendererCore`
  - Creates Three.js renderer, cameras, scene graph glue.

## scene.js
- `export class Scene extends Component`
  - Scene root component; spawns other components.

## skybox.js
- `export function createSkybox(camera, { ... })`
  - Utility for skybox creation with engine conventions.

Notes:
- Many modules expose additional methods/fields beyond the signatures above. Consult source for behaviors and extension points.
- Budget helpers in `engine.js` and `debug.js` surface constraints visually in dev mode.


