'use strict';
import { Vector3 } from "three";
import { Component, ComponentRegistry } from "./component.js";

// Locomotion: behavior-driven targeting helper for Agent movement/pathfinding.
// This component discovers an Agent on the same object (or globally) and configures
// its target and navigation options. Behaviors include seeking the Player, a named
// object, or a fixed world position.
export class Locomotion extends Component {
  constructor(ctx) {
    super(ctx);
    const opts = (ctx && ctx.options) || {};
    // Behavior preset
    this.behavior = typeof opts.behavior === "string" ? opts.behavior : "seekPlayer";
    this.preferRigForPlayer = opts.preferRigForPlayer !== false; // default true
    // Optional parameters used by some behaviors
    this.objectName = typeof opts.objectName === "string" ? opts.objectName : "";
    this.targetPosition = (opts.targetPosition && typeof opts.targetPosition.x === "number")
      ? new Vector3(opts.targetPosition.x, opts.targetPosition.y || 0, opts.targetPosition.z)
      : null;
    this.targetOffset = (opts.targetOffset && typeof opts.targetOffset.x === "number")
      ? new Vector3(opts.targetOffset.x, opts.targetOffset.y || 0, opts.targetOffset.z)
      : new Vector3(0, 0, 0);
    // Pathfinding config passthrough for Agent
    this.useNavMesh = opts.useNavMesh !== false; // default true
    this.repathInterval = typeof opts.repathInterval === "number" ? opts.repathInterval : 0.5;
    this.turnSpeed = typeof opts.turnSpeed === "number" ? opts.turnSpeed : undefined;
    this.arriveRadius = typeof opts.arriveRadius === "number" ? opts.arriveRadius : undefined;
    // Internal
    this._agent = null;
    this._resolvedTarget = null; // Object3D or Vector3
  }

  static getDefaultParams() {
    return {
      behavior: "seekPlayer", // "seekPlayer" | "seekObject" | "seekPosition" | "idle"
      preferRigForPlayer: true,
      objectName: "",
      targetPosition: { x: 0, y: 0, z: 0 },
      targetOffset: { x: 0, y: 0, z: 0 },
      useNavMesh: true,
      repathInterval: 0.5,
      // Agent steering hints (optional overrides)
      turnSpeed: 3.5,
      arriveRadius: 0.25,
    };
  }

  static getParamDescriptions() {
    return [
      { key: "behavior", label: "Behavior Preset", type: "string", description: "idle | seekPlayer | seekObject | seekPosition" },
      { key: "preferRigForPlayer", label: "Prefer Player Rig", type: "boolean", description: "When seeking player, follow the moving rig/camera instead of the GLTF authoring object." },
      { key: "objectName", label: "Object Name (seekObject)", type: "string", description: "Name to search in scene graph." },
      { key: "targetPosition", label: "Target Position (seekPosition)", type: "vec3", description: "World position to seek." },
      { key: "targetOffset", label: "Target Offset", type: "vec3", description: "Offset applied to resolved target." },
      { key: "useNavMesh", label: "Use NavMesh", type: "boolean", description: "Enable pathfinding when NavMesh exists." },
      { key: "repathInterval", label: "Repath Interval (s)", type: "number", min: 0.1, max: 5, step: 0.1, description: "Recompute path cadence." },
      { key: "turnSpeed", label: "Turn Speed (rad/s)", type: "number", min: 0.1, max: 10, step: 0.1, description: "Yaw turn rate hint for Agent." },
      { key: "arriveRadius", label: "Arrive Radius (m)", type: "number", min: 0.05, max: 2, step: 0.05, description: "Arrival distance hint for Agent." },
    ];
  }

  Initialize() {
    // Prefer Agent on the same object
    this._agent = this.getComponent?.("Agent") || this.findComponent?.("Agent") || null;
    this._applyNavigationHints();
    this._resolvedTarget = this._resolveBehaviorTarget(this.behavior);
    this._applyTarget();
  }

  FixedUpdate(/* dt, app */) {
    // Acquire Agent if it initialized after us
    if (!this._agent) {
      this._agent = this.getComponent?.("Agent") || this.findComponent?.("Agent") || null;
      if (this._agent) {
        this._applyNavigationHints();
        this._applyTarget();
      }
    }
    // If behavior is dynamic (player/object may spawn later), keep resolving until found.
    if (!this._resolvedTarget && this.behavior !== "idle") {
      const t = this._resolveBehaviorTarget(this.behavior);
      if (t) {
        this._resolvedTarget = t;
        this._applyTarget();
      }
    }
  }

  // Public API to change behavior at runtime
  setBehavior(behavior, params = {}) {
    if (typeof behavior === "string") this.behavior = behavior;
    if (params) {
      if (typeof params.objectName === "string") this.objectName = params.objectName;
      if (params.targetPosition && typeof params.targetPosition.x === "number") {
        this.targetPosition = new Vector3(params.targetPosition.x, params.targetPosition.y || 0, params.targetPosition.z);
      }
      if (params.targetOffset && typeof params.targetOffset.x === "number") {
        this.targetOffset = new Vector3(params.targetOffset.x, params.targetOffset.y || 0, params.targetOffset.z);
      }
    }
    this._resolvedTarget = this._resolveBehaviorTarget(this.behavior);
    this._applyTarget();
  }

  // Public API to set an explicit target
  setManualTarget(target) {
    this._resolvedTarget = this._coerceTarget(target);
    this._applyTarget();
  }

  // Internal helpers
  _applyNavigationHints() {
    if (!this._agent) return;
    if (typeof this.useNavMesh === "boolean") this._agent.useNavMesh = this.useNavMesh;
    if (typeof this.repathInterval === "number") this._agent.repathInterval = this.repathInterval;
    if (typeof this.turnSpeed === "number") this._agent.turnSpeed = this.turnSpeed;
    if (typeof this.arriveRadius === "number") this._agent.arriveRadius = this.arriveRadius;
  }

  _applyTarget() {
    if (!this._agent) return;
    if (!this._resolvedTarget) {
      this._agent.target = null;
      return;
    }
    const tgt = this._resolvedTarget;
    if (tgt && typeof tgt.getWorldPosition === "function") {
      // Object target; offset is applied by wrapping via a proxy getter
      const offset = this.targetOffset?.clone?.() || new Vector3(0, 0, 0);
      // Provide a lightweight wrapper exposing getWorldPosition with offset
      this._agent.target = {
        getWorldPosition: (out) => {
          const v = out || new Vector3();
          try { tgt.updateWorldMatrix?.(true, false); } catch {}
          tgt.getWorldPosition(v);
          v.add(offset);
          return v;
        }
      };
    } else if (tgt instanceof Vector3) {
      const v = tgt.clone().add(this.targetOffset || new Vector3(0, 0, 0));
      this._agent.target = v;
    } else {
      this._agent.target = null;
    }
  }

  _resolveBehaviorTarget(behavior) {
    switch ((behavior || "").toString()) {
      case "idle":
        return null;
      case "seekPlayer":
        return this._resolvePlayerObject();
      case "seekObject":
        return this._resolveObjectByName(this.objectName);
      case "seekPosition":
        return this._resolvePosition(this.targetPosition);
      default:
        return null;
    }
  }

  _coerceTarget(t) {
    if (!t) return null;
    if (typeof t.x === "number" && typeof t.y === "number" && typeof t.z === "number") return new Vector3(t.x, t.y, t.z);
    if (t.getWorldPosition) return t;
    return null;
  }

  _resolvePosition(p) {
    if (p && typeof p.x === "number" && typeof p.z === "number") {
      return new Vector3(p.x, p.y || 0, p.z);
    }
    return null;
  }

  _resolveObjectByName(name) {
    if (!name) return null;
    const scene = this.game?.rendererCore?.scene || null;
    if (!scene || !scene.getObjectByName) return null;
    return scene.getObjectByName(name) || null;
  }

  _resolvePlayerObject() {
    // Prefer following the Player rig/camera (dynamic transform). Fallback to GLTF-authored object/parent.
    const playerComp = this.findComponent?.("Player") || this.game?.player || null;
    const rig = playerComp?.rig || this.game?.rendererCore?.camera?.parent || null;
    const playerObj = playerComp?.object || null;
    if (this.preferRigForPlayer && rig) return rig;
    if (playerObj && playerObj.parent) return playerObj.parent;
    return playerObj || rig || null;
  }
}

ComponentRegistry.register("Locomotion", Locomotion);
ComponentRegistry.register("locomotion", Locomotion);


