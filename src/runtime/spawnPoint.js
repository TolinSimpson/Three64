'use strict';
import { Vector3, Quaternion } from "three";
import { Component, ComponentRegistry } from "./component.js";

/**
 * SpawnPoint Component
 *
 * A lightweight marker placed on empties in the scene. GameMode queries these
 * to find valid spawn locations for players and items.
 */
export class SpawnPoint extends Component {
  static getDefaultParams() {
    return {
      tags: 'SpawnPoint',       // comma-separated tags, e.g. "SpawnPoint,TeamRed"
      team: -1,                  // team ID restriction (-1 = any)
      cooldown: 0,               // seconds before reuse
      radius: 0,                 // random offset radius for spawn jitter
      itemArchetype: '',         // if set, this is an item spawn point
      respawnInterval: 0,        // seconds between item respawns (0 = no respawn)
    };
  }

  static getParamDescriptions() {
    return [
      { key: 'tags',             label: 'Tags',              type: 'string',  description: 'Comma-separated tags, e.g. "SpawnPoint,TeamRed".' },
      { key: 'team',             label: 'Team',              type: 'number',  min: -1, step: 1, description: 'Team restriction (-1 = any team).' },
      { key: 'cooldown',         label: 'Cooldown (s)',      type: 'number',  min: 0, step: 0.5, description: 'Seconds before this point can be reused.' },
      { key: 'radius',           label: 'Jitter Radius (m)', type: 'number',  min: 0, step: 0.1, description: 'Random offset radius for spawn position.' },
      { key: 'itemArchetype',    label: 'Item Archetype',    type: 'string',  description: 'If set, GameMode spawns this archetype here.' },
      { key: 'respawnInterval',  label: 'Respawn Interval',  type: 'number',  min: 0, step: 1, description: 'Seconds between item respawns (0 = once).' },
    ];
  }

  Initialize() {
    this._cooldownRemaining = 0;
    this._tags = [];
    const raw = (this.options?.tags || 'SpawnPoint').toString();
    this._tags = raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    if (this.game?.spawnPoints) this.game.spawnPoints.push(this);
  }

  Dispose() {
    const arr = this.game?.spawnPoints;
    if (Array.isArray(arr)) {
      const i = arr.indexOf(this);
      if (i >= 0) arr.splice(i, 1);
    }
    super.Dispose?.();
  }

  Update(dt) {
    if (this._cooldownRemaining > 0) {
      this._cooldownRemaining = Math.max(0, this._cooldownRemaining - dt);
    }
  }

  // Public API
  hasTag(tag) {
    return this._tags.includes(String(tag).trim().toLowerCase());
  }

  getSpawnPosition() {
    const pos = new Vector3();
    if (this.object?.getWorldPosition) {
      this.object.getWorldPosition(pos);
    }
    // Apply jitter
    const radius = Number(this.options?.radius) || 0;
    if (radius > 0) {
      const angle = Math.random() * Math.PI * 2;
      const r = Math.random() * radius;
      pos.x += Math.cos(angle) * r;
      pos.z += Math.sin(angle) * r;
    }
    return pos;
  }

  getSpawnRotation() {
    const quat = new Quaternion();
    if (this.object?.getWorldQuaternion) {
      this.object.getWorldQuaternion(quat);
    }
    return quat;
  }

  isAvailable() {
    return this._cooldownRemaining <= 0;
  }

  markUsed() {
    this._cooldownRemaining = Number(this.options?.cooldown) || 0;
  }
}

ComponentRegistry.register('SpawnPoint', SpawnPoint);
