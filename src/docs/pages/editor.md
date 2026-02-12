# Scene Editor

A browser-based scene authoring tool for placing GLTF objects, assigning engine components, and configuring their properties. All component data is written into GLTF node `userData` using the `components` array format so the engine loads it directly at runtime.

The editor is a dev-only tool. It is **not** included in `npm run build` output (the CLI launcher is copied to `public/build/editor-cli.mjs` for convenience; the full editor server and frontend are not).

## Launch

```bash
npm run editor
```

Open [http://localhost:3664](http://localhost:3664) in your browser.

To use a different port:

```bash
npm run editor -- --port=3665
```

If the port is already in use the server prints a message and exits instead of crashing.

## Requirements

The editor depends on **express** (installed as a devDependency). Run `npm install` if you haven't already.

## Layout

The editor is a single-page application split into five areas:

```
+-----------+-------------------------------+------------------+
|  Toolbar  |  (spans full width)           |                  |
+-----------+-------------------------------+------------------+
|  Assets   |        3D Viewport            |  Hierarchy       |
|  (left)   |        (center)               |  (top-right)     |
|           |                               +------------------+
|           |                               |  Inspector       |
|           |                               |  (bottom-right)  |
+-----------+-------------------------------+------------------+
```

### Toolbar

| Button / Input | Action |
|---|---|
| **New** | Clear the scene (prompts if unsaved) |
| **Open** | Open a `.glb`/`.gltf` file from your filesystem |
| **Save** | Export as GLB and write to `src/assets/models/` via the editor server |
| **Export** | Export as GLB and download through the browser |
| **W Move** | Translate gizmo mode |
| **E Rotate** | Rotate gizmo mode |
| **R Scale** | Scale gizmo mode |
| **World / Local** | Toggle transform space |
| **Snap** | Enable snapping with configurable translate / rotate / scale increments |

### Assets Panel (left sidebar)

Lists all `.glb` and `.gltf` files found in `src/assets/models/`. Click a model name to enter **placement mode**: a semi-transparent ghost preview follows your mouse on the ground plane. Click in the viewport to stamp it. Press **Escape** to cancel placement.

The list refreshes automatically after a **Save**.

### 3D Viewport (center)

- **Orbit**: left-click drag
- **Zoom**: scroll wheel
- **Pan**: right-click drag (or middle-click drag)
- **Select**: left-click an object
- **Gizmo**: translate / rotate / scale handles appear on the selected object

The viewport shows a grid, axis indicator, and ambient + directional editor lights. These helpers are not exported when you save.

### Hierarchy Panel (top-right)

A collapsible tree of every object under the scene root.

- **Click** a row to select (syncs with the viewport and inspector).
- **Expand / collapse** child nodes with the arrow button.
- **Eye icon** toggles visibility.
- **Drag** a row onto another row to reparent.
- **Right-click** opens a context menu: Duplicate, Rename, Delete.

### Inspector Panel (bottom-right)

When an object is selected the inspector shows:

1. **Name** -- editable text field.
2. **Transform** -- Position, Rotation (degrees), and Scale as numeric inputs. These stay synced with the gizmo in both directions.
3. **Components** -- each attached component is a collapsible group with:
   - A property editor auto-generated from the component's `paramDescriptions`.
   - A remove button (the X in the header).
4. **Add Component** -- a dropdown listing every component from `src/assets/default-component-data/`. Select one or type a custom name and click **Add**. Default parameters are populated automatically.

## Keyboard Shortcuts

| Key | Action |
|---|---|
| **W** | Translate mode |
| **E** | Rotate mode |
| **R** | Scale mode |
| **F** | Focus camera on selected object |
| **Delete** / **Backspace** | Delete selected object |
| **Ctrl+D** | Duplicate selected object |
| **Ctrl+S** | Open save dialog |
| **Escape** | Deselect / exit placement mode |

## GLTF Round-Trip

### Loading

Files are loaded with Three.js `GLTFLoader` (same version the engine uses: three 0.161). Existing `userData` on every node is preserved and displayed in the inspector.

### Saving

The scene root is exported with Three.js `GLTFExporter` as binary GLB. Editor-only objects (grid, lights, selection box) are stripped before export. The GLB is sent to `POST /api/save-gltf?filename=<name>` which writes it to `src/assets/models/`.

### Component Data Format

The editor reads components from all the legacy formats the engine supports (`component`, `component2`, `comp.*`, `c_*`, etc.) but always writes back using the clean `components` array:

```json
{
  "components": [
    { "type": "Agent", "params": { "speed": 3.2, "behavior": "seek" } },
    { "type": "Rigidbody", "params": { "shape": "box", "mass": 1 } }
  ]
}
```

This is stored in `object.userData` and exported as GLTF node `extras`. The engine's `_extractComponentsFromUserData` (in `assetLoader.js`) reads it at load time.

## Property Editor Types

The inspector generates controls based on each component's `paramDescriptions` entries:

| `type` | Control |
|---|---|
| `number` | Slider + numeric input (respects `min`, `max`, `step`) |
| `string` | Text input |
| `boolean` | Checkbox |
| `enum` | Dropdown (from `options` array) |
| `vec3` | Three numeric inputs (X, Y, Z) |
| `object` | JSON textarea |

Parameters without a matching description fall back to a type inferred from the default value, or a JSON textarea for complex objects.

## File Structure

```
src/editor/
  cli.mjs              CLI launcher (also copied into builds)
  server.mjs           Express API server + static file serving
  public/
    index.html          Editor HTML shell
    style.css           Dark-theme editor styles
    js/
      main.js           Bootstrap, wires all modules together
      viewport.js       Three.js scene, camera, gizmos, raycasting
      assetLibrary.js   Asset browser + placement mode
      hierarchy.js      Scene tree view
      inspector.js      Name, transform, component editors
      propertyEditor.js Auto-generated form controls from paramDescriptions
      toolbar.js        Toolbar buttons + keyboard shortcuts
      userData.js       Read/write component data in userData
      gltfIO.js         GLTFLoader / GLTFExporter + server save
```

## Editor Server API

The editor runs a lightweight Express server (default port 3664).

| Endpoint | Method | Description |
|---|---|---|
| `/api/models` | GET | Returns `{ models: ["file.glb", ...] }` from `src/assets/models/` |
| `/api/components` | GET | Returns `{ components: [{ type, params, paramDescriptions }, ...] }` from `src/assets/default-component-data/` |
| `/api/save-gltf?filename=name.glb` | POST | Accepts raw GLB bytes and writes to `src/assets/models/` |
| `/models/<file>` | GET | Serves model files for the GLTFLoader |
| `/three/...` | GET | Serves Three.js from `node_modules` for browser ES module imports |

## Compatibility with Blender Workflow

Models authored in Blender with the Three64 add-on (which writes flattened dotted-key custom properties) will load into the editor and display their components correctly. On save the editor normalizes them to the `components` array format. The engine supports both formats, so round-tripping through either tool works.
