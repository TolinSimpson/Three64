### Item Component

The `Item` component represents a pickable/droppable item in the world. It carries metadata (name, description, icon), stack size, consumable/equipable flags, and integrates with `Rigidbody` and optional `Volume` for proximity.

Parameters:
- id: string
- name: string
- description: string
- icon: string (URL or key)
- quantity: number (default 1)
- maxStack: number (default 1)
- isConsumable: boolean
- isEquipable: boolean
- equipKey: string (KeyboardEvent.code, e.g. "Digit1")
- isPickup: boolean (default true)
- isDropped: boolean (spawned via drop)
- pickupRadius: number (meters; optional)
- autoPickup: boolean (if true, proximity auto-picks)
- customProps: object
- events.onConsume/onEquip/onUnequip/onPickup/onDrop: strings (event names)

Events emitted (via EventSystem):
- ItemConsumed, ItemEquipped, ItemUnequipped, ItemPickedUp, ItemDropped (defaults; can be overridden per item).
- ItemProximity (from internal Volume when pickupRadius > 0).

Usage (GLTF userData):

```json
{
  "components": [
    {
      "type": "Item",
      "options": {
        "id": "apple",
        "name": "Apple",
        "description": "Restores a little health.",
        "icon": "ui/apple.png",
        "quantity": 1,
        "maxStack": 12,
        "isConsumable": true,
        "isEquipable": true,
        "equipKey": "Digit1",
        "isPickup": true,
        "pickupRadius": 0.0,
        "customProps": { "heal": 10 }
      }
    }
  ]
}
```

Rigidbody/Volume integration:
- When `isDropped` is true, `Item` ensures a dynamic `Rigidbody` exists.
- If `pickupRadius > 0` and `isPickup`, an internal `Volume` emits `ItemProximity` when the player enters.

Raycaster integration (recommended for pickups):
- Add a `Raycaster` on the player rig with:
  - filters.hasComponent: "Item"
  - events.onFilteredHit: "ItemRayHit"
  - includePayloadObjectRef: true
  - origin: "screenCenter"


