'use strict';
import { Component, ComponentRegistry } from "./component.js";
import { MeshBasicMaterial, Vector3 } from "three";

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
    // Default behavior: use ONLY the mesh this component is attached to
    const mergeChildren = opts.mergeChildren === true; // default false
    const visible = opts.visible === true;
    const fast = opts.fast === true ? true : false; // default precise (per-vertex) for attached mesh
    let material = null;
    if (visible) {
      const color = typeof opts.color === "number" ? opts.color : 0x00ffff;
      material = new MeshBasicMaterial({ color, wireframe: true });
    }

    if (type === "convex") {
      this.object.updateWorldMatrix(true, true);
      if (mergeChildren) {
        // Author requested full subtree; keep existing API and allow fast path via bbox if requested
        if (fast && typeof physics._addConvexFromPoints === "function") {
          const worldPoints = [];
          const corners = [
            new Vector3(), new Vector3(), new Vector3(), new Vector3(),
            new Vector3(), new Vector3(), new Vector3(), new Vector3()
          ];
          const addBoxCorners = (box, matrixWorld) => {
            const min = box.min, max = box.max;
            corners[0].set(min.x, min.y, min.z).applyMatrix4(matrixWorld);
            corners[1].set(max.x, min.y, min.z).applyMatrix4(matrixWorld);
            corners[2].set(min.x, max.y, min.z).applyMatrix4(matrixWorld);
            corners[3].set(min.x, min.y, max.z).applyMatrix4(matrixWorld);
            corners[4].set(max.x, max.y, min.z).applyMatrix4(matrixWorld);
            corners[5].set(max.x, min.y, max.z).applyMatrix4(matrixWorld);
            corners[6].set(min.x, max.y, max.z).applyMatrix4(matrixWorld);
            corners[7].set(max.x, max.y, max.z).applyMatrix4(matrixWorld);
            for (let i = 0; i < 8; i++) worldPoints.push(corners[i].clone());
          };
          this.object.traverse((o) => {
            if (!o.isMesh || !o.geometry) return;
            if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
            addBoxCorners(o.geometry.boundingBox, o.matrixWorld);
          });
          if (worldPoints.length >= 4) {
            physics._addConvexFromPoints(worldPoints, { visible, material });
          }
        } else {
          physics.addConvexColliderForObject(this.object, { mergeChildren: true, visible, material });
        }
      } else {
        // Default: only this object's mesh (or first mesh child if not a mesh)
        const meshes = [];
        if (this.object.isMesh && this.object.geometry) {
          meshes.push(this.object);
        } else {
          // find first mesh in subtree as a fallback for empties
          let found = null;
          this.object.traverse((o) => { if (!found && o.isMesh && o.geometry) found = o; });
          if (found) meshes.push(found);
        }
        if (!meshes.length) {
          console.warn("Collider component: no mesh found on object for self collider");
        } else {
          for (const m of meshes) {
            if (fast && typeof physics._addConvexFromPoints === "function") {
              // bbox corners for the single mesh
              if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
              const box = m.geometry.boundingBox;
              const corners = [
                new Vector3(box.min.x, box.min.y, box.min.z).applyMatrix4(m.matrixWorld),
                new Vector3(box.max.x, box.min.y, box.min.z).applyMatrix4(m.matrixWorld),
                new Vector3(box.min.x, box.max.y, box.min.z).applyMatrix4(m.matrixWorld),
                new Vector3(box.min.x, box.min.y, box.max.z).applyMatrix4(m.matrixWorld),
                new Vector3(box.max.x, box.max.y, box.min.z).applyMatrix4(m.matrixWorld),
                new Vector3(box.max.x, box.min.y, box.max.z).applyMatrix4(m.matrixWorld),
                new Vector3(box.min.x, box.max.y, box.max.z).applyMatrix4(m.matrixWorld),
                new Vector3(box.max.x, box.max.y, box.max.z).applyMatrix4(m.matrixWorld)
              ];
              physics._addConvexFromPoints(corners, { visible, material });
            } else if (typeof physics._addConvexFromPoints === "function") {
              // precise per-vertex hull for the single mesh
              const pts = [];
              const pos = m.geometry.getAttribute("position");
              if (pos) {
                const v = new Vector3();
                for (let i = 0; i < pos.count; i++) {
                  v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
                  pts.push(v.clone());
                }
                physics._addConvexFromPoints(pts, { visible, material });
              }
            } else {
              // fallback to engine API (may include children; acceptable as last resort)
              physics.addConvexColliderForObject(m, { mergeChildren: false, visible, material });
            }
          }
        }
      }
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

