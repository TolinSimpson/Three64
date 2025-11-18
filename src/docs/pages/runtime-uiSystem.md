# runtime/uiSystem.js

## API

### `class UISystem`
Manages 2D HTML overlay layers for HUD, Menus, and Debugging.

- `init()`: Sets up the UI root and default layers.

**Layer Management:**
- `loadPageIntoLayer(layerName, fileName, options)`: Fetches an HTML fragment from `assets/ui/` and injects it into a named layer.
  - `options`: `{ zIndex, visible }`.
- `configureLayer(name, { zIndex, visible })`: Updates layer properties.
- `setLayerVisible(name, visible)`: Show/hide a layer.
- `loadStylesheet(fileName)`: Dynamically loads a CSS file from `assets/css/`.

**Events:**
- `on(topic, handler)`: Subscribe to UI events (returns unsubscribe function).
- `emit(topic, detail)`: Publish a UI event.
- **Data Attributes**:
  - `data-emit="topic"`: Elements with this attribute emit events on click/touch.
  - `data-payload="{...}"`: JSON payload for the emitted event.
  - `data-amount="10"`: Numeric payload.
  - `data-ui-tiles="N"`: Declares tile usage for budgeting.

**Default Behaviors:**
- Wires specific healthbar elements (`[data-health-fill]`, `[data-health-label]`) to `health:changed` events.

## Usage

```js
// Load main menu
await app.ui.loadPageIntoLayer('menu', 'main-menu.html', { zIndex: 1000 });

// Load HUD
await app.ui.loadPageIntoLayer('hud', 'hud.html');
app.ui.loadStylesheet('hud.css');

// React to UI buttons
app.ui.on('start-game', () => {
  app.ui.setLayerVisible('menu', false);
  startGame();
});
```
