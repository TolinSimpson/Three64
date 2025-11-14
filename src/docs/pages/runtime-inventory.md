### Inventory Component

The `Inventory` component manages items for a player/actor: stacking, equip/unequip, consume, and dropping back into the world. Attach it to your Player object.

Parameters:
- maxSlots: number (default 24)
- items: list (optional serialized state)
- equippedIndex: number (internal, serialized)

Keybinds (configurable in `assets/config/keybinds.json`):
- interact: ["KeyE"]
- drop: ["KeyG"]
- inventoryOpen: ["KeyI", "Tab"]
- Each item may specify its own `equipKey` (e.g., "Digit1").

Events:
- InventoryChanged
- ItemPickedUp
- ItemDropped
- ItemEquipped / ItemUnequipped
- ItemConsumed
- InventoryToggle (emitted on inventoryOpen key press; hook your UI)

Pickup via Raycast:
1. Add a `Raycaster` on the Player with:
   - origin: "screenCenter"
   - filters.hasComponent: "Item"
   - events.onFilteredHit: "ItemRayHit"
   - includePayloadObjectRef: true
2. Press Interact to pick up the looked-at item.

Proximity pickup:
- If an `Item` specifies `pickupRadius > 0` and `autoPickup: true`, the internal `Volume` emits `ItemProximity`. The `Inventory` listens and will pick up automatically.

Dropping:
- Press Drop while an item is equipped to spawn the world object at the camera position with a small forward velocity. If the item originated from a world object, that same object is reused.

GLTF userData example (attach both to the same object or separate as needed):

```json
{
  "components": [
    { "type": "Inventory", "options": { "maxSlots": 24 } },
    { "type": "Raycaster", "options": {
      "origin": "screenCenter",
      "filters": { "hasComponent": "Item" },
      "events": { "onFilteredHit": "ItemRayHit" },
      "includePayloadObjectRef": true
    } }
  ]
}
```


