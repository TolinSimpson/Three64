'use strict';
import { AnimationMixer, LoopOnce, LoopRepeat } from "three";
import { Component, ComponentRegistry } from "./component.js";

/**
 * AnimationController Component
 *
 * Wraps Three.js AnimationMixer with a data-driven state machine. Each state
 * maps to a GLTF AnimationClip name. Transitions define crossfade durations.
 * Self-discovers clips from the loaded GLTF scene graph.
 */
export class AnimationController extends Component {
  static getDefaultParams() {
    return {
      defaultState: 'idle',
      states: {
        idle: { clipName: 'Idle', loop: true, speed: 1.0 },
      },
      transitions: {
        '*->*': { duration: 0.25 },
      },
      autoDetect: false,
    };
  }

  static getParamDescriptions() {
    return [
      { key: 'defaultState', label: 'Default State',  type: 'string',  description: 'Initial animation state name.' },
      { key: 'states',       label: 'States',         type: 'object',  description: 'Map of state name to { clipName, loop, speed, returnTo }.' },
      { key: 'transitions',  label: 'Transitions',    type: 'object',  description: 'Map of "from->to" to { duration }. "*" is wildcard.' },
      { key: 'autoDetect',   label: 'Auto Detect',    type: 'boolean', description: 'Auto-create a state for each clip found on the object.' },
    ];
  }

  Initialize() {
    const o = this.options || {};
    this._mixer = null;
    this._actions = new Map();    // stateName -> AnimationAction
    this._currentState = null;
    this._clips = [];

    // Find animations: walk up ancestor tree to find animations array (GLTF stores clips on root)
    let animRoot = this.object;
    while (animRoot && (!animRoot.animations || animRoot.animations.length === 0)) {
      animRoot = animRoot.parent;
    }
    if (animRoot && animRoot.animations && animRoot.animations.length > 0) {
      this._clips = animRoot.animations;
    }

    if (!this.object || this._clips.length === 0) return;

    // Create mixer on this object
    this._mixer = new AnimationMixer(this.object);

    // Build clip map
    const clipMap = new Map();
    for (const clip of this._clips) {
      clipMap.set(clip.name, clip);
      clipMap.set(clip.name.toLowerCase(), clip);
    }

    // Parse states
    let states = o.states || {};
    if (typeof states === 'string') {
      try { states = JSON.parse(states); } catch { states = {}; }
    }

    // Auto-detect: create a state for each clip
    if (o.autoDetect) {
      for (const clip of this._clips) {
        const name = clip.name.toLowerCase();
        if (!states[name]) {
          states[name] = { clipName: clip.name, loop: true, speed: 1.0 };
        }
      }
    }

    // Build actions for each state
    for (const [stateName, cfg] of Object.entries(states)) {
      const clipName = cfg.clipName || stateName;
      const clip = clipMap.get(clipName) || clipMap.get(clipName.toLowerCase());
      if (!clip) continue;

      const action = this._mixer.clipAction(clip);
      action.clampWhenFinished = true;
      action.loop = cfg.loop !== false ? LoopRepeat : LoopOnce;
      action.timeScale = typeof cfg.speed === 'number' ? cfg.speed : 1.0;
      this._actions.set(stateName, { action, config: cfg });
    }

    // Parse transitions
    let transitions = o.transitions || {};
    if (typeof transitions === 'string') {
      try { transitions = JSON.parse(transitions); } catch { transitions = {}; }
    }
    this._transitions = transitions;

    // Listen for external state requests via EventSystem
    const objName = this.object?.name || '';
    if (objName && this.game?.eventSystem) {
      this._onSetState = (payload) => {
        const state = (typeof payload === 'string') ? payload : payload?.state;
        if (state) this.setState(state);
      };
      this.game.eventSystem.onEvent(`anim:${objName}:setState`, this._onSetState);
    }

    // Listen for mixer 'finished' events (non-looping clips with returnTo)
    this._mixer.addEventListener('finished', (e) => {
      if (!this._currentState) return;
      const entry = this._actions.get(this._currentState);
      if (entry?.config?.returnTo) {
        this.setState(entry.config.returnTo);
      }
    });

    // Set default state
    const defaultState = o.defaultState || 'idle';
    if (this._actions.has(defaultState)) {
      this._setInitialState(defaultState);
    } else {
      // Fallback to first available state
      const firstKey = this._actions.keys().next().value;
      if (firstKey) this._setInitialState(firstKey);
    }
  }

  Dispose() {
    if (this._mixer) {
      this._mixer.stopAllAction();
      this._mixer = null;
    }
    if (this._onSetState && this.game?.eventSystem) {
      const objName = this.object?.name || '';
      this.game.eventSystem.offEvent(`anim:${objName}:setState`, this._onSetState);
    }
    this._actions.clear();
  }

  Update(dt) {
    if (this._mixer) {
      this._mixer.update(dt);
    }
  }

  // Public API
  setState(name) {
    if (name === this._currentState) return;
    if (!this._actions.has(name)) return;

    const fromEntry = this._currentState ? this._actions.get(this._currentState) : null;
    const toEntry = this._actions.get(name);
    if (!toEntry) return;

    const duration = this._getTransitionDuration(this._currentState, name);

    if (fromEntry) {
      fromEntry.action.fadeOut(duration);
    }

    toEntry.action.reset();
    toEntry.action.fadeIn(duration);
    toEntry.action.play();

    const prevState = this._currentState;
    this._currentState = name;

    // Emit state changed event
    const objName = this.object?.name || '';
    this.game?.eventSystem?.emit(`anim:${objName}:stateChanged`, { from: prevState, to: name });

    // Trigger configured events
    this.triggerConfiguredEvent('onStateEnter', { state: name, from: prevState });
  }

  getCurrentState() {
    return this._currentState;
  }

  // Internal
  _setInitialState(name) {
    const entry = this._actions.get(name);
    if (!entry) return;
    entry.action.reset();
    entry.action.play();
    this._currentState = name;
  }

  _getTransitionDuration(from, to) {
    const t = this._transitions || {};
    // Check specific transition
    const specific = t[`${from}->${to}`];
    if (specific && typeof specific.duration === 'number') return specific.duration;
    // Check wildcard from
    const wildTo = t[`*->${to}`];
    if (wildTo && typeof wildTo.duration === 'number') return wildTo.duration;
    // Check wildcard to
    const wildFrom = t[`${from}->*`];
    if (wildFrom && typeof wildFrom.duration === 'number') return wildFrom.duration;
    // Check double wildcard
    const wildBoth = t['*->*'];
    if (wildBoth && typeof wildBoth.duration === 'number') return wildBoth.duration;
    // Default
    return 0.25;
  }
}

ComponentRegistry.register('AnimationController', AnimationController);
