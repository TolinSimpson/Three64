## Navigation mesh (GLTF-authored)

- Author a navmesh directly as a mesh node inside your GLTF scene.
  - Add a custom property `component = "NavMesh"` to that mesh in your DCC.
  - The runtime reads the mesh geometry (positions + indices) and builds the navgraph.
  - Multiple meshes under the same node are supported; world-space vertices are baked at load.

- Optional legacy fallback
  - You may still provide `{ url }` in NavMesh params to load a legacy JSON, but this is no longer recommended.

- Links as components
  - Create an empty (or any node) and add `component = "NavLink"` with params:
    - `targetName`: Name of the target object to link to.
    - `bidirectional`: true/false (default true).
    - `cost`: optional traversal cost multiplier (default 1.0).
  - At load, links register themselves with the nearest triangles on the NavMesh.

- Runtime APIs
  - `NavMesh.findPath(startVec3, endVec3, { smooth })`
  - Links are integrated into A* as neighbor edges; costs affect traversal.

- Agents
  - Use `Agent` component (`src/runtime/agent.js`) with `useNavMesh: true` to follow paths.

# runtime/navmesh.js

## API
- `class NavMesh extends Component`: Loads a JSON navmesh and provides path queries.

## Usage
Add a `NavMesh` component to an object (via Blender or registry) and set its `url` to your navmesh JSON. Agents can then request paths.


