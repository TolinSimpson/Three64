## Navigation (runtime heightfield)

- Tag walkable meshes in your GLTF with `userData.navigable = true`.
- At load, the engine builds a 2.5D heightfield grid over the scene bounds:
  - Downward raycasts over the tagged meshes determine per‑cell ground height.
  - Cells are marked walkable if they meet slope and step‑height constraints.
  - Optional per‑object cost: set `userData.navigableCost` (or `navCost`/`cost`) on a mesh to scale movement cost.

- No baking step is required; just set userData on your GLTF meshes.

### Parameters (NavMesh component)
- `cellSize` (m): grid resolution (default 0.5)
- `maxSlopeDeg` (deg): maximum walkable surface slope (default 45)
- `stepHeight` (m): maximum vertical delta between neighbor cells (default 0.4)
- `agentRadius` (m): used for future clearance logic (default 0.3)
- `smooth` (bool): simple waypoint smoothing (default true)

### Links (optional)
- Add `NavLink` component to any node to connect two points:
  - `targetName`: name of the target object
  - `bidirectional` (default true)
  - `cost` (default 1.0)
- At load, each link snaps to the nearest grid nodes and adds edges into the graph.

### API
- `NavMesh.findPath(start: Vector3, end: Vector3, { smooth?: boolean }) => Vector3[]`
- Returns an array of world positions (Y from sampled ground).

### Agents
- Use `Agent` (`src/runtime/agent.js`) with `useNavMesh: true` to follow paths.

### Authoring summary
- On walkable geometry: `userData.navigable = true`
- Optional: `userData.navigableCost = number`
- Add `NavMesh` anywhere in the scene (e.g., root component mapping) to enable navigation.

### Notes
- For large worlds, consider tiling cell generation; current implementation builds a single grid over scene bounds.


