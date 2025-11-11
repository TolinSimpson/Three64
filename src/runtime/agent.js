'use strict';
import { Vector3 } from "three";
import { Component, ComponentRegistry } from "./component.js";
import { CharacterController } from "./characterController.js";

export class Agent extends Component {
  constructor(ctx) {
    super(ctx);
    this.controller = null;
    const opts = (ctx && ctx.options) || {};
    this.turnSpeed = typeof opts.turnSpeed === 'number' ? opts.turnSpeed : 3.5; // rad/s
    this.arriveRadius = typeof opts.arriveRadius === 'number' ? opts.arriveRadius : 0.25;
    this.target = null; // { x, y, z } or Object3D
    // Optional navmesh usage
    this.useNavMesh = opts.useNavMesh === true;
    this.repathInterval = typeof opts.repathInterval === 'number' ? opts.repathInterval : 0.5; // seconds
    this._nav = null;
    this._path = null; // Array<Vector3>
    this._pathIndex = 0;
    this._timeSinceRepath = 0;
  }

  static getDefaultParams() {
    return {
      turnSpeed: 3.5,
      arriveRadius: 0.25,
      // Movement settings passed through to CharacterController
      speed: 3.2,
      sprintMultiplier: 1.8,
      // Navigation
      useNavMesh: false,
      repathInterval: 0.5
    };
  }

  static getParamDescriptions() {
    return [
      {
        key: 'turnSpeed',
        label: 'Turn Speed (rad/s)',
        type: 'number',
        min: 0.1,
        max: 10,
        step: 0.1,
        description: 'Maximum yaw rotation speed when turning toward a target.'
      },
      {
        key: 'arriveRadius',
        label: 'Arrive Radius (m)',
        type: 'number',
        min: 0.05,
        max: 2,
        step: 0.05,
        description: 'Distance at which the agent considers itself arrived and stops.'
      },
      {
        key: 'speed',
        label: 'Move Speed (m/s)',
        type: 'number',
        min: 0.5,
        max: 12,
        step: 0.1,
        description: 'Base ground movement speed used by the character controller.'
      },
      {
        key: 'sprintMultiplier',
        label: 'Sprint Multiplier',
        type: 'number',
        min: 1,
        max: 3,
        step: 0.05,
        description: 'Multiplier applied to move speed when sprinting.'
      },
      {
        key: 'useNavMesh',
        label: 'Use NavMesh',
        type: 'boolean',
        description: 'Enable navmesh pathfinding when a NavMesh component is present.'
      },
      {
        key: 'repathInterval',
        label: 'Repath Interval (s)',
        type: 'number',
        min: 0.1,
        max: 5,
        step: 0.1,
        description: 'Time between path recomputation while moving.'
      }
    ];
  }

  Initialize() {
    const start = new Vector3();
    if (this.object && this.object.getWorldPosition) {
      this.object.getWorldPosition(start);
      start.y = Math.max(0, start.y);
    }
    const opts = this.options || {};
    this.controller = new CharacterController({
      position: start,
      // Pass through optional movement parameters if provided
      speed: typeof opts.speed === 'number' ? opts.speed : undefined,
      sprintMultiplier: typeof opts.sprintMultiplier === 'number' ? opts.sprintMultiplier : undefined,
    });
    // Initialize facing from object rotation if available
    if (this.object && this.object.rotation) {
      this.controller.yaw = this.object.rotation.y || 0;
      this.controller.targetYaw = this.controller.yaw;
    }
    if (this.options && this.options.target) {
      this.target = this.options.target;
    }
    // Optional navmesh lookup
    this.useNavMesh = this.options?.useNavMesh === true;
    this.repathInterval = typeof this.options?.repathInterval === 'number' ? this.options.repathInterval : this.repathInterval;
    this._nav = this.findComponent?.('NavMesh') || this.game?.navMesh || null;
    this._path = null;
    this._pathIndex = 0;
    this._timeSinceRepath = 0;
  }

  _getTargetPosition() {
    if (!this.target) return null;
    if (typeof this.target.x === 'number' && typeof this.target.y === 'number' && typeof this.target.z === 'number') {
      return new Vector3(this.target.x, this.target.y, this.target.z);
    }
    if (this.target.getWorldPosition) {
      const v = new Vector3();
      this.target.getWorldPosition(v);
      return v;
    }
    return null;
  }

  FixedUpdate(dt, app) {
    if (!this.controller) return;
    const goal = this._getTargetPosition();
    if (!goal) {
      this.controller.setMoveInput(0, 0, false, false);
      this.controller.fixedStep(app, dt);
      return;
    }
    // If navmesh is available and enabled, follow a path
    if (this.useNavMesh && (this._nav || (this._nav = this.findComponent?.('NavMesh') || app?.navMesh || null))) {
      this._timeSinceRepath += dt;
      if (!this._path || this._timeSinceRepath >= this.repathInterval) {
        this._path = this._nav.findPath(this.controller.position, goal, { smooth: true });
        this._pathIndex = 0;
        this._timeSinceRepath = 0;
      }
      const nextPoint = this._nextWaypoint(goal);
      this._moveToward(nextPoint, dt, app);
      return;
    }
    // Fallback: direct steering toward goal
    this._moveToward(goal, dt, app);
  }

  Update(dt /*, app */) {
    if (!this.controller) return;
    this.controller.update(dt);
  }

  LateUpdate(dt /*, app */) {
    if (!this.controller) return;
    // Apply position to the agent object and face yaw
    if (this.object) {
      this.object.position.copy(this.controller.position);
      if (this.object.rotation) this.object.rotation.y = this.controller.yaw;
    }
  }

  _nextWaypoint(goal) {
    const pos = this.controller.position;
    // If no path, go straight to goal
    if (!Array.isArray(this._path) || this._path.length === 0) return goal;
    // Skip waypoints that are within arriveRadius
    while (this._pathIndex < this._path.length) {
      const wp = this._path[this._pathIndex];
      const d = horizontalDistance(pos, wp);
      if (d > this.arriveRadius * 0.75) break;
      this._pathIndex += 1;
    }
    // If consumed path, go to goal
    if (this._pathIndex >= this._path.length) return goal;
    return this._path[this._pathIndex];
  }

  _moveToward(targetVec, dt, app) {
    const pos = this.controller.position;
    const to = targetVec.clone().sub(pos);
    to.y = 0;
    const dist = to.length();
    if (dist < this.arriveRadius) {
      this.controller.setMoveInput(0, 0, false, false);
      this.controller.fixedStep(app, dt);
      return;
    }
    if (dist > 1e-5) to.multiplyScalar(1 / dist);
    const desiredYaw = Math.atan2(-to.x, -to.z);
    const delta = wrapAngle(desiredYaw - this.controller.targetYaw);
    const maxTurn = this.turnSpeed * dt;
    const turn = Math.max(-maxTurn, Math.min(maxTurn, delta));
    this.controller.setLookDelta(turn, 0);
    this.controller.setMoveInput(0, 1, false, false);
    this.controller.fixedStep(app, dt);
  }
}

function wrapAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

ComponentRegistry.register("Agent", Agent);
ComponentRegistry.register("agent", Agent);

function horizontalDistance(a, b) {
  const dx = (a.x - b.x);
  const dz = (a.z - b.z);
  return Math.sqrt(dx * dx + dz * dz);
}