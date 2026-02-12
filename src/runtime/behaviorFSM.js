'use strict';
import { Vector3 } from "three";
import { Component, ComponentRegistry } from "./component.js";

/**
 * BehaviorFSM Component
 *
 * A generic, editor-configurable finite state machine for AI behavior.
 * Replaces hardcoded seek/ranged behavior in Agent with a data-driven system.
 * When co-located with an Agent, the Agent delegates to this FSM.
 */
export class BehaviorFSM extends Component {
  static getDefaultParams() {
    return {
      defaultState: 'idle',
      states: {
        idle:   { behavior: 'none',   duration: 2, next: 'patrol' },
        patrol: { behavior: 'patrol', waypointTag: 'PatrolPoint', speed: 2.0, next: 'idle' },
        chase:  { behavior: 'seek',   speedMultiplier: 1.5 },
        attack: { behavior: 'ranged', fireRate: 1.2, range: 15 },
        flee:   { behavior: 'seek',   target: 'away', speedMultiplier: 2.0 },
      },
      transitions: [
        { from: 'patrol', to: 'chase',  condition: 'targetDistance', op: '<', value: 15 },
        { from: 'chase',  to: 'attack', condition: 'targetDistance', op: '<', value: 10 },
        { from: 'attack', to: 'chase',  condition: 'targetDistance', op: '>', value: 12 },
      ],
      perception: {
        sightRange: 20,
        sightAngle: 120,
        hearingRange: 10,
        updateInterval: 0.25,
      },
      difficulty: {
        reactionTime: 0.3,
        accuracy: 0.7,
        aggressiveness: 0.5,
      },
      stateAnimations: {},  // e.g. { idle: "idle", patrol: "walk", chase: "run", attack: "fire" }
    };
  }

  static getParamDescriptions() {
    return [
      { key: 'defaultState',    label: 'Default State',     type: 'string',  description: 'Initial FSM state.' },
      { key: 'states',          label: 'States',            type: 'object',  description: 'Map of state name to behavior config.' },
      { key: 'transitions',     label: 'Transitions',       type: 'object',  description: 'Array of condition-based transitions.' },
      { key: 'perception',      label: 'Perception',        type: 'object',  description: '{ sightRange, sightAngle, hearingRange, updateInterval }.' },
      { key: 'difficulty',      label: 'Difficulty',        type: 'object',  description: '{ reactionTime, accuracy, aggressiveness }.' },
      { key: 'stateAnimations', label: 'State Animations',  type: 'object',  description: 'Map of FSM state to animation state name.' },
    ];
  }

  Initialize() {
    const o = this.options || {};
    this._currentState = null;
    this._stateTimer = 0;
    this._perceptionTimer = 0;
    this._target = null;
    this._targetDistance = Infinity;
    this._targetVisible = false;
    this._waypointIndex = 0;
    this._waypoints = null;

    // Parse states
    let states = o.states || {};
    if (typeof states === 'string') {
      try { states = JSON.parse(states); } catch { states = {}; }
    }
    this._states = states;

    // Parse transitions
    let transitions = o.transitions || [];
    if (typeof transitions === 'string') {
      try { transitions = JSON.parse(transitions); } catch { transitions = []; }
    }
    this._transitions = Array.isArray(transitions) ? transitions : [];

    // Parse perception
    let perception = o.perception || {};
    if (typeof perception === 'string') {
      try { perception = JSON.parse(perception); } catch { perception = {}; }
    }
    this._perception = {
      sightRange: Number(perception.sightRange) || 20,
      sightAngle: Number(perception.sightAngle) || 120,
      hearingRange: Number(perception.hearingRange) || 10,
      updateInterval: Number(perception.updateInterval) || 0.25,
    };

    // Parse difficulty
    let difficulty = o.difficulty || {};
    if (typeof difficulty === 'string') {
      try { difficulty = JSON.parse(difficulty); } catch { difficulty = {}; }
    }
    this._difficulty = {
      reactionTime: Number(difficulty.reactionTime) || 0.3,
      accuracy: Number(difficulty.accuracy) || 0.7,
      aggressiveness: Number(difficulty.aggressiveness) || 0.5,
    };

    // Parse stateAnimations
    let stateAnims = o.stateAnimations || {};
    if (typeof stateAnims === 'string') {
      try { stateAnims = JSON.parse(stateAnims); } catch { stateAnims = {}; }
    }
    this._stateAnimations = stateAnims;

    // Enter default state
    this._enterState(o.defaultState || 'idle');
  }

  /**
   * Evaluate the FSM. Called by Agent.FixedUpdate when co-located.
   * Returns { moveInput, lookTarget, fire, sprint } for Agent to apply.
   */
  evaluate(dt, context) {
    this._stateTimer += dt;

    // Update perception periodically
    this._perceptionTimer += dt;
    if (this._perceptionTimer >= this._perception.updateInterval) {
      this._perceptionTimer = 0;
      this._updatePerception(context);
    }

    // Evaluate transitions (priority order)
    this._evaluateTransitions(context);

    // Execute current state behavior
    const stateCfg = this._states[this._currentState];
    if (!stateCfg) return { moveInput: { x: 0, z: 0 }, lookTarget: null, fire: false, sprint: false };

    // Check duration-based state transitions
    if (stateCfg.duration && this._stateTimer >= stateCfg.duration && stateCfg.next) {
      this._enterState(stateCfg.next);
      return this.evaluate(0, context); // re-evaluate in new state
    }

    return this._executeBehavior(stateCfg, dt, context);
  }

  getCurrentState() {
    return this._currentState;
  }

  // Internal
  _enterState(name) {
    if (!this._states[name]) return;
    const prevState = this._currentState;
    this._currentState = name;
    this._stateTimer = 0;
    this._waypointIndex = 0;
    this._waypoints = null;

    // Emit animation state change
    const animState = this._stateAnimations[name];
    if (animState && this.object?.name) {
      this.game?.eventSystem?.emit(`anim:${this.object.name}:setState`, animState);
    }

    // Emit FSM state change
    this.game?.eventSystem?.emit('fsm:stateChanged', {
      object: this.object?.name,
      from: prevState,
      to: name,
    });
  }

  _evaluateTransitions(context) {
    for (const t of this._transitions) {
      // Check "from" match
      if (t.from !== '*' && t.from !== this._currentState) continue;

      // Evaluate condition
      const condValue = this._evaluateCondition(t.condition, context);
      const threshold = Number(t.value) || 0;
      let met = false;

      switch (t.op) {
        case '<':  met = condValue < threshold;  break;
        case '>':  met = condValue > threshold;  break;
        case '<=': met = condValue <= threshold; break;
        case '>=': met = condValue >= threshold; break;
        case '==': met = condValue === threshold; break;
        case '!=': met = condValue !== threshold; break;
        default: break;
      }

      if (met) {
        this._enterState(t.to);
        return; // Only one transition per frame
      }
    }
  }

  _evaluateCondition(condition, context) {
    switch (condition) {
      case 'targetDistance':
        return this._targetDistance;

      case 'health': {
        // Read health stat from co-located Statistic or global
        const comps = this.object?.__components || [];
        for (const c of comps) {
          if (c?.constructor?.name === 'Statistic') {
            const n = (c.options?.name || '').toString().replace(/\s+/g, '').toLowerCase();
            if (n === 'health') return Number(c.options?.current) || 0;
          }
        }
        // Fallback: global
        const globalStat = this.game?.statistics?.get('health');
        return globalStat ? Number(globalStat.options?.current) || 0 : 100;
      }

      case 'timer':
        return this._stateTimer;

      case 'hasLineOfSight':
        return this._targetVisible ? 1 : 0;

      case 'targetVisible':
        return this._targetVisible ? 1 : 0;

      case 'random':
        return Math.random();

      default:
        // Try to read a named statistic
        if (condition) {
          const stat = this.game?.statistics?.get(condition.toLowerCase());
          if (stat) return Number(stat.options?.current) || 0;
        }
        return 0;
    }
  }

  _updatePerception(context) {
    const app = context?.app || this.game;
    // Get target (default: player)
    const playerRig = app?.player?.rig || app?.player?.object || app?.rendererCore?.camera?.parent;
    if (!playerRig) {
      this._targetDistance = Infinity;
      this._targetVisible = false;
      return;
    }

    const myPos = new Vector3();
    if (this.object?.getWorldPosition) {
      this.object.getWorldPosition(myPos);
    } else if (context?.position) {
      myPos.copy(context.position);
    }

    const targetPos = new Vector3();
    if (playerRig.getWorldPosition) {
      playerRig.getWorldPosition(targetPos);
    } else {
      targetPos.copy(playerRig.position);
    }

    this._target = targetPos;
    const dx = targetPos.x - myPos.x;
    const dz = targetPos.z - myPos.z;
    this._targetDistance = Math.sqrt(dx * dx + dz * dz);

    // Simple visibility: distance + angle check
    if (this._targetDistance <= this._perception.sightRange) {
      // Angle check
      const toTarget = new Vector3(dx, 0, dz).normalize();
      const forward = new Vector3(0, 0, -1);
      if (this.object?.rotation) {
        forward.set(-Math.sin(this.object.rotation.y), 0, -Math.cos(this.object.rotation.y));
      }
      const dot = forward.dot(toTarget);
      const halfAngle = (this._perception.sightAngle / 2) * (Math.PI / 180);
      this._targetVisible = dot >= Math.cos(halfAngle);
    } else if (this._targetDistance <= this._perception.hearingRange) {
      this._targetVisible = true; // "heard"
    } else {
      this._targetVisible = false;
    }
  }

  _executeBehavior(stateCfg, dt, context) {
    const result = { moveInput: { x: 0, z: 0 }, lookTarget: null, fire: false, sprint: false };
    const behavior = stateCfg.behavior || 'none';

    switch (behavior) {
      case 'none':
        // Stand still
        break;

      case 'patrol':
        return this._behaviorPatrol(stateCfg, dt, context);

      case 'seek':
        return this._behaviorSeek(stateCfg, dt, context);

      case 'ranged':
        return this._behaviorRanged(stateCfg, dt, context);

      case 'seekCover':
        return this._behaviorSeekCover(stateCfg, dt, context);

      case 'wander':
        return this._behaviorWander(stateCfg, dt, context);

      default:
        break;
    }

    return result;
  }

  _behaviorPatrol(cfg, dt, context) {
    const result = { moveInput: { x: 0, z: 1 }, lookTarget: null, fire: false, sprint: false };

    // Find waypoints
    if (!this._waypoints) {
      const tag = (cfg.waypointTag || 'PatrolPoint').toLowerCase();
      this._waypoints = this._findObjectsByTag(tag);
      this._waypointIndex = 0;
    }

    if (!this._waypoints || this._waypoints.length === 0) {
      result.moveInput = { x: 0, z: 0 };
      return result;
    }

    const wp = this._waypoints[this._waypointIndex % this._waypoints.length];
    if (wp?.position) {
      result.lookTarget = wp.position.clone();
      const myPos = this.object?.position || new Vector3();
      const dx = wp.position.x - myPos.x;
      const dz = wp.position.z - myPos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < 1.0) {
        this._waypointIndex = (this._waypointIndex + 1) % this._waypoints.length;
      }
    }

    return result;
  }

  _behaviorSeek(cfg, dt, context) {
    const result = { moveInput: { x: 0, z: 0 }, lookTarget: null, fire: false, sprint: false };

    if (!this._target) return result;

    const isAway = cfg.target === 'away';
    result.lookTarget = isAway ? null : this._target.clone();
    result.moveInput = { x: 0, z: isAway ? -1 : 1 };
    result.sprint = (cfg.speedMultiplier || 1) > 1.3;

    return result;
  }

  _behaviorRanged(cfg, dt, context) {
    const result = { moveInput: { x: 0, z: 0 }, lookTarget: null, fire: false, sprint: false };

    if (!this._target) return result;

    const range = Number(cfg.range) || 15;
    result.lookTarget = this._target.clone();

    if (this._targetDistance <= range && this._targetVisible) {
      result.fire = true;
    } else if (this._targetDistance > range) {
      result.moveInput = { x: 0, z: 1 };
    }

    return result;
  }

  _behaviorSeekCover(cfg, dt, context) {
    const result = { moveInput: { x: 0, z: 1 }, lookTarget: null, fire: false, sprint: true };

    // Find cover points
    const tag = (cfg.coverTag || 'CoverPoint').toLowerCase();
    const covers = this._findObjectsByTag(tag);
    if (covers.length === 0) return result;

    // Find nearest cover
    const myPos = this.object?.position || new Vector3();
    let nearest = null;
    let nearestDist = Infinity;
    for (const c of covers) {
      if (!c?.position) continue;
      const d = myPos.distanceTo(c.position);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = c;
      }
    }

    if (nearest) {
      result.lookTarget = nearest.position.clone();
    }

    return result;
  }

  _behaviorWander(cfg, dt, context) {
    const result = { moveInput: { x: 0, z: 0 }, lookTarget: null, fire: false, sprint: false };

    // Simple wander: random direction change every few seconds
    if (this._stateTimer % 3 < dt) {
      const angle = Math.random() * Math.PI * 2;
      result.moveInput = { x: Math.sin(angle), z: Math.cos(angle) };
    } else {
      result.moveInput = { x: 0, z: 1 };
    }

    return result;
  }

  _findObjectsByTag(tag) {
    const scene = this.game?.rendererCore?.scene;
    if (!scene) return [];
    const results = [];
    scene.traverse((obj) => {
      if (obj.name?.toLowerCase().includes(tag)) {
        results.push(obj);
      }
      // Also check userData for tag
      if (obj.userData?.tags) {
        const tags = String(obj.userData.tags).split(',').map(s => s.trim().toLowerCase());
        if (tags.includes(tag)) results.push(obj);
      }
    });
    return results;
  }
}

ComponentRegistry.register('BehaviorFSM', BehaviorFSM);
