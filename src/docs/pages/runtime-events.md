# runtime/event.js

Configurable action execution for gameplay events. Lets components run structured actions when events occur, instead of (or in addition to) emitting string event names.

## Concepts
- Action object: `{ "type": string, "params": object }`
- Action array: `[ {type, params}, ... ]`
- Context: `{ game, object, component }` provided to handlers

## Schema
Supported built-ins:

- AddItem
  - params: `target: "player"|"self"|string`, `item: {...}`
  - Adds an item to the target's `Inventory`.

- ModifyStatistic
  - params: `name`, `op: "add"|"set"|"setMax"|"setMin"|"addOverTime"`, `value?`, `duration?`, `easing?`, `keepRatio?`, `target: "self"|"player"|string`
  - Modifies a `Statistic` component on the target object.

- SendComponentMessage
  - params: `target: "self"|"player"|"byName"`, `objectName?`, `component`, `method`, `args?`
  - Invokes a method on another component on the resolved object.

Notes:
- `target` of type string (not "self"/"player") resolves by scene object name.
- All actions are backward compatible with string-based `EventSystem` emissions; strings still work.

## API
`event.js` exports:
- `executeActions(ctx, actions, payload?)`
- `executeAction(ctx, action, payload?)`
- `listActionsWithParams()`
- `ActionRegistry` for extending with custom actions

## Authoring
In any component options, configure events under `options.events`:

```json
{
  "events": {
    "onCollision": [
      { "type": "ModifyStatistic", "params": { "name": "health", "op": "add", "value": -10, "target": "player" } },
      { "type": "SendComponentMessage", "params": { "target": "self", "component": "Rigidbody", "method": "zeroVelocity" } }
    ]
  }
}
```

You may also call `onEvent(key, payload)` from a component to execute its configured actions:

```js
await this.onEvent("onHit", { damage: 5 });
```

If `options.events.onHit` is a string, it is emitted via `EventSystem.emit`. If it is an action object/array, it is executed.

## Integration
- Rigidbody: `events.onCollision` accepts string or actions. Collision payload: `{ point, normal, distance, targetName, sourceObject }`.
- Volume: `events.onEnter/onExit/onStay` accept string or actions. Payload: `{ name, userData, object? }`.
- Component base: `onEvent(key, payload)` and `triggerConfiguredEvent(key, payload)` helpers run configured actions.

## Blender Add-on
Manifest: `assets/config/action-manifest.json`

```json
{
  "actions": [
    { "id": "AddItem", "label": "Add Item", "params": ["target", "item"] },
    { "id": "ModifyStatistic", "label": "Modify Statistic", "params": ["name", "op", "value", "duration", "easing", "keepRatio", "target"] },
    { "id": "SendComponentMessage", "label": "Send Component Message", "params": ["target", "component", "method", "args", "objectName"] }
  ]
}
```

The add-on can use `listActionsWithParams()` at runtime or the manifest during authoring to present action types and parameter fields in dropdowns.


