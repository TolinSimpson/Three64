'use strict';
import { Vector3 } from "three";
import { Component, ComponentRegistry } from "./component.js";
import { findItemComponentOnObject } from "./item.js";

// Inventory component: attach to Player (or any Object3D) to manage items.
export class Inventory extends Component {
  constructor(ctx) {
    super(ctx);
    const o = (ctx && ctx.options) || {};
    this.items = Array.isArray(o.items) ? this._sanitizeItems(o.items) : [];
    this.equippedIndex = (typeof o.equippedIndex === "number" ? o.equippedIndex : -1);
    this.maxSlots = (typeof o.maxSlots === "number" ? o.maxSlots : 24);
    this._lastRayHitObj = null;
    this._lastRayHitTime = 0;
    this._lastKeyDown = new Set();
    this._lastEquipKeyDown = new Map(); // per-key edge detection
  }

  static getDefaultParams() {
    return {
      items: [],
      equippedIndex: -1,
      maxSlots: 24
    };
  }

  static getParamDescriptions() {
    return [
      { key: "maxSlots", label: "Max Slots", type: "number", min: 1, max: 128, step: 1, description: "Maximum inventory slots." }
    ];
  }

  getSerializableState() {
    return {
      items: this.items.map(it => ({
        id: it.id || "",
        name: it.name || "",
        description: it.description || "",
        icon: it.icon || "",
        quantity: it.quantity | 0,
        maxStack: it.maxStack | 0,
        isConsumable: !!it.isConsumable,
        isEquipable: !!it.isEquipable,
        equipKey: it.equipKey || "Digit1",
        customProps: it.customProps || {}
      })),
      equippedIndex: this.equippedIndex | 0,
      maxSlots: this.maxSlots | 0
    };
  }

  applyDeserializedState(data) {
    const d = data || {};
    this.items = this._sanitizeItems(Array.isArray(d.items) ? d.items : []);
    this.equippedIndex = (typeof d.equippedIndex === "number" ? d.equippedIndex : -1);
    this.maxSlots = (typeof d.maxSlots === "number" ? d.maxSlots : 24);
  }

  Initialize() {
    // Listen for ray hits on items
    try {
      this._onRayHit = (payload) => {
        const obj = payload?.hit?.object || payload?.firstHit?.object || null;
        if (obj) {
          this._lastRayHitObj = obj;
          this._lastRayHitTime = performance.now();
        }
      };
      this.game?.eventSystem?.onEvent?.("ItemRayHit", this._onRayHit);
    } catch {}
    // Optional proximity auto-pickup
    try {
      this._onProx = (payload) => {
        const obj = payload?.object || payload?.hit?.object || null;
        if (!obj) return;
        const comp = findItemComponentOnObject(obj);
        if (!comp || comp.autoPickup !== true || comp.isPickup !== true) return;
        this._pickupItemComponent(comp);
      };
      this.game?.eventSystem?.onEvent?.("ItemProximity", this._onProx);
    } catch {}
  }

  Dispose() {
    try { if (this._onRayHit) this.game?.eventSystem?.offEvent?.("ItemRayHit", this._onRayHit); } catch {}
    try { if (this._onProx) this.game?.eventSystem?.offEvent?.("ItemProximity", this._onProx); } catch {}
  }

  // ---------------------
  // Input phase handling
  // ---------------------
  Input(/* dt */) {
    const ev = this.game?.eventSystem;
    if (!ev) return;
    // High-level binds with fallback defaults
    const interactDown = this._pressedBind(ev, "interact", ["KeyE"]);
    const dropDown = this._pressedBind(ev, "drop", ["KeyG"]);
    const invOpenDown = this._pressedBind(ev, "inventoryOpen", ["KeyI", "Tab"]);
    const interactEdge = interactDown && !this._lastKeyDown.has("interact");
    const dropEdge = dropDown && !this._lastKeyDown.has("drop");
    const invEdge = invOpenDown && !this._lastKeyDown.has("inventoryOpen");

    this._setLastKey("interact", interactDown);
    this._setLastKey("drop", dropDown);
    this._setLastKey("inventoryOpen", invOpenDown);

    // Pickup via ray hit + interact
    if (interactEdge) {
      const ttlMs = 180;
      if (this._lastRayHitObj && (performance.now() - this._lastRayHitTime) <= ttlMs) {
        const comp = findItemComponentOnObject(this._lastRayHitObj);
        if (comp && comp.isPickup !== false) {
          this._pickupItemComponent(comp);
        }
      }
    }

    // Drop currently equipped item
    if (dropEdge && this.equippedIndex >= 0 && this.equippedIndex < this.items.length) {
      this.dropItem(this.equippedIndex);
    }

    // Equip/consume hotkeys (per item equipKey)
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      if (!it || !it.isEquipable || !it.equipKey) continue;
      const isDown = this._pressedCodes(ev, [it.equipKey]);
      const wasDown = this._lastEquipKeyDown.get(it.equipKey) === true;
      if (isDown && !wasDown) {
        // If already equipped and consumable, consume; otherwise equip
        if (this.equippedIndex === i && it.isConsumable) {
          this.consumeItem(i, 1);
        } else {
          this.equipItem(i);
        }
      }
      this._lastEquipKeyDown.set(it.equipKey, isDown);
    }

    // Inventory open/close is UI concern; emit signal
    if (invEdge) {
      ev.emit("InventoryToggle", { open: true });
    }
  }

  // ---------------------
  // Public API
  // ---------------------
  addItem(itemData, prefabRef = null) {
    const data = this._coerceItem(itemData);
    if (!data) return false;
    // Try to stack with existing items (match by id if present else by name)
    const matchIdx = this._findStackIndex(data);
    if (matchIdx >= 0) {
      const slot = this.items[matchIdx];
      const canTake = Math.max(0, (slot.maxStack | 0) - (slot.quantity | 0));
      if (canTake <= 0) return this._emitChanged(), false;
      const toMove = Math.min(canTake, data.quantity | 0);
      slot.quantity = (slot.quantity | 0) + toMove;
      // If we stacked everything, we can keep one prefabRef if empty
      if (!slot.prefabRef && prefabRef) slot.prefabRef = prefabRef;
      this._emitEvent("InventoryChanged", {});
      return true;
    }
    // Place into new slot
    if (this.items.length >= this.maxSlots) return false;
    data.prefabRef = prefabRef || null;
    this.items.push(data);
    this._emitEvent("InventoryChanged", {});
    return true;
  }

  removeItem(index, count = Infinity) {
    if (index < 0 || index >= this.items.length) return false;
    const it = this.items[index];
    const take = Math.min(it.quantity | 0, Math.max(1, count | 0));
    it.quantity -= take;
    if (it.quantity <= 0) {
      // If removing equipped, unequip
      if (this.equippedIndex === index) this.equippedIndex = -1;
      this.items.splice(index, 1);
    }
    this._emitEvent("InventoryChanged", {});
    return true;
  }

  consumeItem(index, count = 1) {
    if (index < 0 || index >= this.items.length) return false;
    const it = this.items[index];
    if (!it.isConsumable) return false;
    const num = Math.max(1, count | 0);
    if ((it.quantity | 0) < num) return false;
    it.quantity -= num;
    this._emitEvent(it.events?.onConsume || "ItemConsumed", { item: this._publicItemPayload(index) });
    if (it.quantity <= 0) {
      if (this.equippedIndex === index) this.equippedIndex = -1;
      this.items.splice(index, 1);
    }
    this._emitEvent("InventoryChanged", {});
    return true;
  }

  equipItem(index) {
    if (index < 0 || index >= this.items.length) return false;
    if (this.equippedIndex === index) {
      // Toggle: unequip
      const prev = index;
      this.equippedIndex = -1;
      this._emitEvent(this.items[prev].events?.onUnequip || "ItemUnequipped", { item: this._publicItemPayload(prev) });
      this._emitEvent("InventoryChanged", {});
      return true;
    }
    const prev = this.equippedIndex;
    this.equippedIndex = index;
    if (prev >= 0) {
      this._emitEvent(this.items[prev].events?.onUnequip || "ItemUnequipped", { item: this._publicItemPayload(prev) });
    }
    this._emitEvent(this.items[index].events?.onEquip || "ItemEquipped", { item: this._publicItemPayload(index) });
    this._emitEvent("InventoryChanged", {});
    return true;
  }

  dropItem(index) {
    if (index < 0 || index >= this.items.length) return false;
    const it = this.items[index];
    const app = this.game;
    const cam = app?.rendererCore?.camera || null;
    // Spawn position: in front of camera if available
    const pos = new Vector3();
    const dir = new Vector3(0, 0, -1);
    if (cam) {
      cam.getWorldDirection(dir);
      pos.copy(cam.position).addScaledVector(dir, 0.8);
    } else {
      try { pos.copy(this.object?.getWorldPosition(new Vector3()) || new Vector3()); } catch {}
    }

    // Use prefab reference if we have one; otherwise emit a drop event without world spawn
    if (it.prefabRef) {
      const comp = findItemComponentOnObject(it.prefabRef);
      if (comp) {
        try { comp.isDropped = true; } catch {}
        comp.placeAsDropped(pos, dir);
      } else {
        // If item component missing on prefab, just add to scene
        try {
          const scene = app?.rendererCore?.scene;
          if (scene) {
            it.prefabRef.visible = true;
            scene.add(it.prefabRef);
            it.prefabRef.position.copy(pos);
          }
        } catch {}
      }
      this._emitEvent(it.events?.onDrop || "ItemDropped", { item: this._publicItemPayload(index) });
      // Remove one from stack
      this.removeItem(index, 1);
      return true;
    } else {
      // No prefab to spawn; just emit event and remove one
      this._emitEvent(it.events?.onDrop || "ItemDropped", { item: this._publicItemPayload(index), spawned: false });
      this.removeItem(index, 1);
      return true;
    }
  }

  // ---------------------
  // Helpers
  // ---------------------
  _pickupItemComponent(comp) {
    const data = comp?.toItemData?.();
    if (!data) return false;
    const ok = this.addItem(data, comp.object);
    if (ok) {
      try { comp.markPickedUp?.(); } catch {}
      this._emitEvent("ItemPickedUp", { item: data });
      if (data.isEquipable && this.equippedIndex === -1) {
        // Auto-equip first pickable equipable
        this.equipItem(this.items.length - 1);
      }
      return true;
    }
    return false;
  }

  _emitEvent(name, payload) {
    try { this.game?.eventSystem?.emit(String(name), payload || {}); } catch {}
  }

  _emitChanged() {
    this._emitEvent("InventoryChanged", {});
  }

  _sanitizeItems(arr) {
    const out = [];
    for (const it of arr) {
      const d = this._coerceItem(it);
      if (d) out.push(d);
    }
    return out;
  }

  _coerceItem(it) {
    if (!it || typeof it !== "object") return null;
    const copy = {
      id: (it.id || ""),
      name: (it.name || "Item"),
      description: (it.description || ""),
      icon: (it.icon || ""),
      quantity: Math.max(1, (it.quantity | 0) || 1),
      maxStack: Math.max(1, (it.maxStack | 0) || 1),
      isConsumable: it.isConsumable === true,
      isEquipable: it.isEquipable !== false,
      equipKey: (it.equipKey || "Digit1"),
      customProps: (it.customProps && typeof it.customProps === "object") ? it.customProps : {},
      events: {
        onConsume: it.events?.onConsume || "ItemConsumed",
        onEquip: it.events?.onEquip || "ItemEquipped",
        onUnequip: it.events?.onUnequip || "ItemUnequipped",
        onPickup: it.events?.onPickup || "ItemPickedUp",
        onDrop: it.events?.onDrop || "ItemDropped",
      },
      prefabRef: it.prefabRef || null
    };
    return copy;
  }

  _findStackIndex(data) {
    // Prefer id match when available, else name+props match
    if (data.id) {
      for (let i = 0; i < this.items.length; i++) if (this.items[i].id === data.id) return i;
    } else {
      for (let i = 0; i < this.items.length; i++) {
        const s = this.items[i];
        if (s.name === data.name && s.maxStack === data.maxStack && s.isConsumable === data.isConsumable) {
          return i;
        }
      }
    }
    return -1;
  }

  _publicItemPayload(index) {
    const it = this.items[index];
    return {
      id: it.id, name: it.name, description: it.description, icon: it.icon,
      quantity: it.quantity, maxStack: it.maxStack, isConsumable: it.isConsumable,
      isEquipable: it.isEquipable, equipKey: it.equipKey, customProps: it.customProps
    };
  }

  _pressedBind(ev, name, fallbackCodes) {
    const list = Array.isArray(ev.keybinds?.[name]) ? ev.keybinds[name] : fallbackCodes;
    return this._pressedCodes(ev, list);
  }

  _pressedCodes(ev, codes) {
    if (!Array.isArray(codes)) return false;
    for (let i = 0; i < codes.length; i++) {
      if (ev.keys?.has?.(codes[i])) return true;
    }
    return false;
  }

  _setLastKey(name, isDown) {
    if (isDown) this._lastKeyDown.add(name); else this._lastKeyDown.delete(name);
  }
}

ComponentRegistry.register("Inventory", Inventory);
ComponentRegistry.register("inventory", Inventory);


