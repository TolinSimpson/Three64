'use strict';
import { Object3D, Vector3 } from "three";
import { Component, ComponentRegistry } from "./component.js";
import { Rigidbody } from "./rigidbody.js";
import { Volume } from "./volume.js";

// Item component: metadata and world pickup/drop integration.
export class Item extends Component {
  constructor(ctx) {
    super(ctx);
    const o = (ctx && ctx.options) || {};
    // Identity and presentation
    this.id = (o.id || "");
    this.name = (o.name || "Item");
    this.description = (o.description || "");
    this.icon = (o.icon || ""); // URL or atlas key
    // Stacking and quantities
    this.quantity = (typeof o.quantity === "number" ? o.quantity : 1);
    this.maxStack = (typeof o.maxStack === "number" ? o.maxStack : 1);
    // Usage/equip
    this.isConsumable = o.isConsumable === true;
    this.isEquipable = o.isEquipable === true;
    this.equipKey = (o.equipKey || "Digit1"); // KeyboardEvent.code
    // World state flags
    this.isPickup = o.isPickup !== false; // can be picked up by player
    this.isDropped = o.isDropped === true; // spawned via drop
    // Pickup helpers
    this.pickupRadius = (typeof o.pickupRadius === "number" ? o.pickupRadius : 0);
    this.autoPickup = o.autoPickup === true;
    // Custom user properties
    this.customProps = (o.customProps && typeof o.customProps === "object") ? o.customProps : {};
    // Gameplay events to emit
    const ev = o.events || {};
    this.events = {
      onConsume: ev.onConsume || "",
      onEquip: ev.onEquip || "",
      onUnequip: ev.onUnequip || "",
      onPickup: ev.onPickup || "",
      onDrop: ev.onDrop || "",
    };
    // Internal references
    this._volume = null;
    this._rb = null;
    this._pickedUp = false;
  }

  static getDefaultParams() {
    return {
      id: "",
      name: "Item",
      description: "",
      icon: "",
      quantity: 1,
      maxStack: 1,
      isConsumable: false,
      isEquipable: true,
      equipKey: "Digit1",
      isPickup: true,
      isDropped: false,
      pickupRadius: 0,
      autoPickup: false,
      customProps: {},
      events: {
        onConsume: "ItemConsumed",
        onEquip: "ItemEquipped",
        onUnequip: "ItemUnequipped",
        onPickup: "ItemPickedUp",
        onDrop: "ItemDropped",
      },
    };
  }

  static getParamDescriptions() {
    return [
      { key: "id", label: "ID", type: "string", description: "Unique item id (optional)." },
      { key: "name", label: "Name", type: "string", description: "Display name." },
      { key: "description", label: "Description", type: "string", description: "Tooltip/description." },
      { key: "icon", label: "Icon URL/Key", type: "string", description: "Icon resource identifier." },
      { key: "quantity", label: "Quantity", type: "number", min: 1, max: 999, step: 1, description: "Initial quantity." },
      { key: "maxStack", label: "Max Stack", type: "number", min: 1, max: 999, step: 1, description: "Maximum items per stack." },
      { key: "isConsumable", label: "Consumable", type: "boolean", description: "If true, consuming reduces quantity." },
      { key: "isEquipable", label: "Equipable", type: "boolean", description: "If true, item can be equipped." },
      { key: "equipKey", label: "Equip Key (KeyboardEvent.code)", type: "string", description: "Key to toggle equip." },
      { key: "isPickup", label: "Is Pickup", type: "boolean", description: "If true, can be picked up from world." },
      { key: "isDropped", label: "Is Dropped", type: "boolean", description: "Spawned as a dropped item." },
      { key: "pickupRadius", label: "Pickup Radius", type: "number", min: 0, max: 10, step: 0.1, description: "Optional proximity radius." },
      { key: "autoPickup", label: "Auto Pickup", type: "boolean", description: "Pickup when in radius (no key)." },
      { key: "customProps", label: "Custom Props", type: "object", description: "Arbitrary JSON object attached to item." },
    ];
  }

  // Serialize only the data relevant to the inventory; not world refs
  static serializableKeys = [
    "id", "name", "description", "icon",
    "quantity", "maxStack", "isConsumable",
    "isEquipable", "equipKey", "isPickup", "isDropped",
    "pickupRadius", "autoPickup", "customProps"
  ];

  Initialize() {
    // Attach a Rigidbody for dropped world items if physics is available
    if (this.isDropped && this.object && !this._findExistingRigidbody()) {
      try {
        const rb = new Rigidbody({ game: this.game, object: this.object, options: { type: "dynamic", mass: 1, friction: 0.6, restitution: 0.0 }, propName: "Rigidbody" });
        this._attachComponent(rb);
        this._rb = rb;
      } catch {}
    } else {
      this._rb = this._findExistingRigidbody();
    }
    // Optional proximity volume
    if (this.pickupRadius > 0 && this.isPickup) {
      try {
        const vol = new Volume({
          game: this.game,
          object: this.object,
          options: {
            enabled: true,
            phase: "fixed",
            shape: "sphere",
            radius: this.pickupRadius,
            target: { mode: "scene", onlyMeshes: true },
            includePayloadObjectRef: true,
            events: { onEnter: "ItemProximity", onExit: "", onStay: "" }
          },
          propName: "Volume"
        });
        this._attachComponent(vol);
        this._volume = vol;
      } catch {}
    }
  }

  Dispose() {
    // no-op
  }

  // Return a plain serializable item data object for inventory storage
  toItemData() {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      icon: this.icon,
      quantity: this.quantity,
      maxStack: this.maxStack,
      isConsumable: this.isConsumable,
      isEquipable: this.isEquipable,
      equipKey: this.equipKey,
      customProps: { ...(this.customProps || {}) }
    };
  }

  // Pickup handler used by inventory
  markPickedUp() {
    this._pickedUp = true;
    // Hide and detach from scene, but keep object as prefab reference
    try { this.object.visible = false; } catch {}
    try { if (this.object.parent) this.object.parent.remove(this.object); } catch {}
    // Emit gameplay event
    const ev = this.events?.onPickup;
    if (ev && this.game?.eventSystem) {
      this.game.eventSystem.emit(String(ev), { id: this.id, name: this.name, object: this.object });
    }
  }

  // Reattach to world as dropped item at position/velocity
  placeAsDropped(position, forwardDir) {
    if (!this.object) return;
    const scene = this.game?.rendererCore?.scene;
    if (!scene) return;
    try {
      this.object.visible = true;
      scene.add(this.object);
      if (position) this.object.position.copy(position);
      // Ensure/refresh Rigidbody
      if (!this._rb) this._rb = this._findExistingRigidbody();
      if (!this._rb) {
        try {
          const rb = new Rigidbody({ game: this.game, object: this.object, options: { type: "dynamic", mass: 1 }, propName: "Rigidbody" });
          this._attachComponent(rb);
          this._rb = rb;
        } catch {}
      }
      // Give it a small toss forward if possible
      if (this._rb && forwardDir) {
        const v = forwardDir.clone().normalize().multiplyScalar(2.5);
        v.y += 1.0;
        try { this._rb.setVelocity(v); } catch {}
      }
      // Emit event
      const ev = this.events?.onDrop;
      if (ev && this.game?.eventSystem) {
        this.game.eventSystem.emit(String(ev), { id: this.id, name: this.name, object: this.object });
      }
    } catch {}
  }

  _attachComponent(comp) {
    try {
      this.object.__components = this.object.__components || [];
      this.object.__components.push(comp);
      this.game.componentInstances.push(comp);
      comp.Initialize?.();
    } catch {}
  }

  _findExistingRigidbody() {
    const list = this.object?.__components || [];
    for (const c of list) {
      if (!c) continue;
      const n = (c.propName || c.__typeName || c.constructor?.name || "").toString().toLowerCase();
      if (n === "rigidbody") return c;
    }
    return null;
  }
}

ComponentRegistry.register("Item", Item);
ComponentRegistry.register("item", Item);

export function findItemComponentOnObject(obj) {
  let cur = obj;
  while (cur && cur instanceof Object3D) {
    const comps = cur.__components || [];
    for (const c of comps) {
      const n = (c?.propName || c?.__typeName || c?.constructor?.name || "").toString().toLowerCase();
      if (n === "item") return c;
    }
    cur = cur.parent || null;
  }
  return null;
}


