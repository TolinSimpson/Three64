'use strict';
import { Component, ComponentRegistry } from "./component.js";

/**
 * GameMode Component
 *
 * A data-driven match controller that owns no variables of its own. All game
 * state lives in Statistics (scores, kills, health) and Timers (match clock,
 * respawn delays). GameMode is purely an observer and state machine -- it reads
 * Statistics, evaluates win conditions, and manages match flow.
 */
export class GameMode extends Component {
  static getDefaultParams() {
    return {
      mode: 'Deathmatch',
      matchStates: {
        lobby:     { next: 'countdown', auto: false },
        countdown: { next: 'playing',   auto: true, timerName: 'countdownTimer' },
        playing:   { next: 'ended',     auto: false },
        ended:     { next: 'lobby',     auto: true, timerName: 'endedTimer' },
      },
      teams: [
        { id: 0, name: 'FFA', color: '0xffffff' },
      ],
      winConditions: [],
      respawnDelay: 3,
      spawnPointTag: 'SpawnPoint',
      events: {},    // onMatchStart, onMatchEnd, onWinConditionMet, onPlayerKilled, onPlayerSpawned
    };
  }

  static getParamDescriptions() {
    return [
      { key: 'mode',          label: 'Mode',            type: 'string',  description: 'Descriptive label, e.g. "Deathmatch", "CTF".' },
      { key: 'matchStates',   label: 'Match States',    type: 'object',  description: 'State machine: { stateName: { next, auto, timerName } }.' },
      { key: 'teams',         label: 'Teams',           type: 'object',  description: 'Array of { id, name, color }.' },
      { key: 'winConditions', label: 'Win Conditions',  type: 'object',  description: 'Array of { statistic, op, value }. Evaluated during "playing" state.' },
      { key: 'respawnDelay',  label: 'Respawn Delay',   type: 'number',  min: 0, step: 0.5, description: 'Seconds before respawn.' },
      { key: 'spawnPointTag', label: 'Spawn Point Tag', type: 'string',  description: 'Tag to find SpawnPoint objects.' },
      { key: 'events',        label: 'Events',          type: 'object',  description: 'Configurable hooks: onMatchStart, onMatchEnd, onWinConditionMet, etc.' },
    ];
  }

  Initialize() {
    const o = this.options || {};
    this._currentState = null;
    this._respawnQueue = [];   // [{ playerId, timer }]
    this._winner = null;
    this._eventUnsubs = [];

    // Parse match states
    let matchStates = o.matchStates || {};
    if (typeof matchStates === 'string') {
      try { matchStates = JSON.parse(matchStates); } catch { matchStates = {}; }
    }
    this._matchStates = matchStates;

    // Parse teams
    let teams = o.teams || [];
    if (typeof teams === 'string') {
      try { teams = JSON.parse(teams); } catch { teams = []; }
    }
    this._teams = Array.isArray(teams) ? teams : [];

    // Parse win conditions
    let winConditions = o.winConditions || [];
    if (typeof winConditions === 'string') {
      try { winConditions = JSON.parse(winConditions); } catch { winConditions = []; }
    }
    this._winConditions = Array.isArray(winConditions) ? winConditions : [];

    // Subscribe to stat:*:changed for every statistic referenced in winConditions
    const es = this.game?.eventSystem;
    if (es) {
      for (const wc of this._winConditions) {
        if (wc.statistic) {
          const name = String(wc.statistic).replace(/\s+/g, '').toLowerCase();
          const handler = () => this._evaluateWinConditions();
          es.onEvent(`stat:${name}:changed`, handler);
          this._eventUnsubs.push(() => es.offEvent(`stat:${name}:changed`, handler));
        }
      }

      // Subscribe to timer:*:complete for any timerName in matchStates
      for (const [, cfg] of Object.entries(this._matchStates)) {
        if (cfg.timerName) {
          const timerName = String(cfg.timerName).replace(/\s+/g, '').toLowerCase();
          const handler = () => {
            // Auto-advance if current state uses this timer
            const curCfg = this._matchStates[this._currentState];
            if (curCfg?.timerName) {
              const curTimer = String(curCfg.timerName).replace(/\s+/g, '').toLowerCase();
              if (curTimer === timerName) {
                this.advanceState();
              }
            }
          };
          es.onEvent(`timer:${timerName}:complete`, handler);
          this._eventUnsubs.push(() => es.offEvent(`timer:${timerName}:complete`, handler));
        }
      }
    }

    // Register for O(1) lookup (events, etc.)
    if (this.game) this.game.gameMode = this;

    // Enter initial state (first key in matchStates)
    const firstState = Object.keys(this._matchStates)[0];
    if (firstState) {
      this._enterState(firstState);
    }
  }

  Dispose() {
    if (this.game?.gameMode === this) this.game.gameMode = null;
    for (const unsub of this._eventUnsubs) {
      try { unsub(); } catch {}
    }
    this._eventUnsubs = [];
  }

  FixedUpdate(dt) {
    // Process respawn queue
    for (let i = this._respawnQueue.length - 1; i >= 0; i--) {
      const entry = this._respawnQueue[i];
      entry.timer -= dt;
      if (entry.timer <= 0) {
        this._respawnQueue.splice(i, 1);
        this._doRespawn(entry.playerId);
      }
    }
  }

  // Public API
  advanceState() {
    const curCfg = this._matchStates[this._currentState];
    if (curCfg?.next) {
      this._enterState(curCfg.next);
    }
  }

  getCurrentState() {
    return this._currentState;
  }

  requestRespawn(playerId) {
    const delay = Number(this.options?.respawnDelay) || 3;
    this._respawnQueue.push({ playerId, timer: delay });
  }

  getWinner() {
    return this._winner;
  }

  getTeams() {
    return this._teams;
  }

  // Internal
  _enterState(name) {
    const prevState = this._currentState;
    this._currentState = name;

    this.game?.eventSystem?.emit('match:stateChanged', {
      from: prevState,
      to: name,
      mode: this.options?.mode || 'Deathmatch',
    });

    // Trigger lifecycle events
    if (name === 'playing') {
      this.triggerConfiguredEvent('onMatchStart', { mode: this.options?.mode });
      // Start any global timer with matching name for the playing state
    }
    if (prevState === 'playing' && name !== 'playing') {
      this.triggerConfiguredEvent('onMatchEnd', { winner: this._winner, mode: this.options?.mode });
      this.game?.eventSystem?.emit('match:ended', { winner: this._winner, reason: 'stateTransition' });
    }
  }

  _evaluateWinConditions() {
    if (this._currentState !== 'playing') return;

    for (const wc of this._winConditions) {
      const statName = String(wc.statistic || '').replace(/\s+/g, '').toLowerCase();
      const stat = this.game?.statistics?.get(statName);
      if (!stat) continue;

      const current = Number(stat.options?.current) || 0;
      const value = Number(wc.value) || 0;
      let met = false;

      switch (wc.op) {
        case '>=': met = current >= value; break;
        case '<=': met = current <= value; break;
        case '>':  met = current > value;  break;
        case '<':  met = current < value;  break;
        case '==': met = current === value; break;
        case '!=': met = current !== value; break;
        default: break;
      }

      if (met) {
        this._winner = { statistic: wc.statistic, value: current, condition: wc };
        this.triggerConfiguredEvent('onWinConditionMet', { winner: this._winner });
        this.game?.eventSystem?.emit('match:ended', { winner: this._winner, reason: 'winCondition' });
        this.advanceState();
        return;
      }
    }
  }

  _doRespawn(playerId) {
    // Find available SpawnPoint
    const tag = (this.options?.spawnPointTag || 'SpawnPoint').toLowerCase();
    const allSpawns = this._findSpawnPoints(tag);

    // Pick available one (optionally matching team)
    let chosen = null;
    for (const sp of allSpawns) {
      if (sp.isAvailable()) {
        chosen = sp;
        break;
      }
    }
    if (!chosen && allSpawns.length > 0) {
      // Fallback: pick random
      chosen = allSpawns[Math.floor(Math.random() * allSpawns.length)];
    }

    if (chosen) {
      chosen.markUsed();
      const pos = chosen.getSpawnPosition();
      const rot = chosen.getSpawnRotation();

      this.game?.eventSystem?.emit('match:playerSpawned', {
        playerId,
        position: pos,
        rotation: rot,
      });
      this.triggerConfiguredEvent('onPlayerSpawned', { playerId, position: pos, rotation: rot });
    }
  }

  _findSpawnPoints(tag) {
    const list = this.game?.spawnPoints;
    if (!Array.isArray(list)) return [];
    return list.filter((c) => c && c.game && typeof c.hasTag === "function" && c.hasTag(tag));
  }
}

ComponentRegistry.register('GameMode', GameMode);
