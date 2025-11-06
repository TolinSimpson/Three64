import { Component, ComponentRegistry } from "./component.js";
import * as THREE from "https://unpkg.com/three@0.161.0/build/three.module.js";

export default class Collider extends Component {
  Initialize() {
    const physics = this.game?.physics;
    if (!physics) {
      console.warn("Collider component: physics world not available");
      return;
    }
    if (this.object?.__colliderBuilt) {
      return;
    }
    const opts = this.options || {};
    const type = (opts.type || "convex").toLowerCase();
    const mergeChildren = opts.mergeChildren !== false;
    const visible = opts.visible === true;
    let material = null;
    if (visible) {
      const color = typeof opts.color === "number" ? opts.color : 0x00ffff;
      material = new THREE.MeshBasicMaterial({ color, wireframe: true });
    }

    if (type === "convex") {
      physics.addConvexColliderForObject(this.object, { mergeChildren, visible, material });
      this.object.__colliderBuilt = true;
    } else {
      console.warn("Collider component: unsupported type:", type);
    }
  }
}

// Register under common names/aliases
ComponentRegistry.register("collider", Collider);
ComponentRegistry.register("Collider", Collider);
ComponentRegistry.register("physicsCollider", Collider);
ComponentRegistry.register("COL", Collider);

