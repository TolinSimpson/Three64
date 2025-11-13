'use strict';
import { Vector3 } from "three";
import { Component, ComponentRegistry } from "./component.js";
import { CharacterController } from "./characterController.js";

export class Agent extends Component {
  constructor(ctx) {
    super(ctx);
    this.controller = null;
    const opts = (ctx && ctx.options) || {};
    // Behavior/mode
    this.behavior = typeof opts.behavior === 'string' ? opts.behavior : 'seek'; // 'seek' | 'ranged'
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
    // Ranged attack config
    this.fireRate = typeof opts.fireRate === 'number' ? opts.fireRate : 0.8; // shots/sec
    this.projectileArchetype = typeof opts.projectileArchetype === 'string' ? opts.projectileArchetype : 'Projectile';
    this.projectileSpeed = typeof opts.projectileSpeed === 'number' ? opts.projectileSpeed : 14;
    this.projectileDamage = typeof opts.projectileDamage === 'number' ? opts.projectileDamage : 10;
    this.attackRange = typeof opts.attackRange === 'number' ? opts.attackRange : 12;
    this._fireCooldown = 0;
  }

  static getDefaultParams() {
    return {
      behavior: 'seek',
      turnSpeed: 3.5,
      arriveRadius: 0.25,
      // Movement settings passed through to CharacterController
      speed: 3.2,
      sprintMultiplier: 1.8,
      // Navigation
      useNavMesh: false,
      repathInterval: 0.5,
      // Ranged attack
      fireRate: 0.8,
      projectileArchetype: 'Projectile',
      projectileSpeed: 14,
      projectileDamage: 10,
      attackRange: 12
    };
  }

  static getParamDescriptions() {
    return [
      {
        key: 'behavior',
        label: 'Behavior',
        type: 'string',
        description: 'seek | ranged'
      },
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
      },
      {
        key: 'fireRate',
        label: 'Fire Rate (shots/sec)',
        type: 'number',
        min: 0.1,
        max: 20,
        step: 0.1,
        description: 'Ranged: shots per second.'
      },
      {
        key: 'projectileArchetype',
        label: 'Projectile Archetype',
        type: 'string',
        description: 'Archetype name to obtain from pool for shots (default Projectile).'
      },
      {
        key: 'projectileSpeed',
        label: 'Projectile Speed (m/s)',
        type: 'number',
        min: 0.1,
        max: 200,
        step: 0.1,
        description: 'Initial bullet speed.'
      },
      {
        key: 'projectileDamage',
        label: 'Projectile Damage',
        type: 'number',
        min: 0,
        max: 1000,
        step: 1,
        description: 'Damage applied to health on hit.'
      },
      {
        key: 'attackRange',
        label: 'Attack Range (m)',
        type: 'number',
        min: 0.1,
        max: 200,
        step: 0.1,
        description: 'Max range to attempt firing.'
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
      // Even without goal, allow ranged logic to tick cooldown
      this._tickRanged(dt, app, null);
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
      // Also tick ranged attack
      this._tickRanged(dt, app, goal);
      return;
    }
    // Fallback: direct steering toward goal
    this._moveToward(goal, dt, app);
    this._tickRanged(dt, app, goal);
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

  _tickRanged(dt, app, goal) {
    if (String(this.behavior).toLowerCase() !== 'ranged') {
      this._fireCooldown = Math.max(0, this._fireCooldown - dt);
      return;
    }
    this._fireCooldown -= dt;
    const player = app?.player || null;
    const rig = player?.rig || app?.rendererCore?.camera?.parent || null;
    const targetPos = goal || (rig ? rig.position : null);
    if (!targetPos) return;
    // Face target
    const to = targetPos.clone().sub(this.controller.position);
    to.y = 0;
    const dist = to.length();
    if (dist > 1e-5) {
      to.multiplyScalar(1 / dist);
      const desiredYaw = Math.atan2(-to.x, -to.z);
      const delta = wrapAngle(desiredYaw - this.controller.targetYaw);
      const maxTurn = this.turnSpeed * dt;
      const turn = Math.max(-maxTurn, Math.min(maxTurn, delta));
      this.controller.setLookDelta(turn, 0);
    }
    if (dist > this.attackRange) return;
    if (this._fireCooldown > 0) return;
    this._fireCooldown = 1 / Math.max(0.01, this.fireRate);
    this._shootProjectile(app, targetPos);
  }

  _shootProjectile(app, targetPos) {
    if (!app?.pool) return;
    let obj = null;
    try { obj = app.pool.obtain(this.projectileArchetype, { overrides: { radius: 0.08, damage: this.projectileDamage, speed: this.projectileSpeed } }); } catch {}
    if (!obj) return;
    try { app.rendererCore.scene.add(obj); } catch {}
    // Find projectile component
    const comps = obj.__components || [];
    let proj = null;
    for (let i = 0; i < comps.length; i++) {
      const c = comps[i];
      const n = (c?.propName || c?.constructor?.name || "").toString().toLowerCase();
      if (n === 'projectile') { proj = c; break; }
    }
    if (!proj || typeof proj.fire !== 'function') return;
    // Spawn from agent's muzzle (use object position, with slight vertical offset)
    const start = new Vector3();
    try { this.object?.getWorldPosition?.(start); } catch {}
    if (!Number.isFinite(start.y)) start.copy(this.controller.position);
    start.y += 1.4;
    const dir = targetPos.clone().sub(start);
    dir.y = 0;
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
    dir.normalize();
    proj.reset?.();
    proj.fire({ position: start, direction: dir, speed: this.projectileSpeed, shooter: this.object });
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