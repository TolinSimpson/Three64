'use strict';
import { loadJSON } from "./io.js";
export class EventSystem {
  constructor({ fixedTimestep = 1 / 60, dom = null } = {}) {
    this.fixedTimestep = fixedTimestep;
    this._accum = 0;
    this.handlers = {
      input: [],
      fixed: [],
      update: [],
      late: [],
    };
    // Named gameplay events (pub/sub)
    this._events = new Map();
    // Input state
    this.dom = dom || document.body;
    this.keys = new Set();
    this.gamepad = null;
    this._lookDX = 0;
    this._lookDY = 0;
    this._jumpQueued = false;
    this._moveTouchId = null;
    this._lookTouchId = null;
    this._moveStart = { x: 0, y: 0 };
    this._moveVec = { x: 0, y: 0 }; // x: strafe, y: forward
    this._lastLookX = undefined;
    this._lastLookY = undefined;
    this._lookTapStart = 0;
    this._lookTapMoved = false;
    this._touchRadius = 64;
    this.keybinds = {
      moveLeft: ["KeyA", "ArrowLeft"],
      moveRight: ["KeyD", "ArrowRight"],
      moveForward: ["KeyW", "ArrowUp"],
      moveBackward: ["KeyS", "ArrowDown"],
      sprint: ["ShiftLeft", "ShiftRight"],
      crouch: ["ControlLeft", "ControlRight"],
      jump: ["Space"],
    };
    this._setupInputListeners();
    // Load keybinds
    this._loadKeybinds();
  }
  on(phase, fn) {
    if (this.handlers[phase] && typeof fn === 'function') {
      this.handlers[phase].push(fn);
    }
  }
  tick(app, frameDt) {
    const dt = Math.max(0, Number(frameDt) || 0);
    // Input phase (poll devices, queue actions)
    this._emit('input', dt, app);
    // Fixed updates (deterministic simulation; physics/controllers)
    this._accum += dt;
    const step = this.fixedTimestep;
    let guard = 0;
    while (this._accum >= step && guard < 8) {
      this._emit('fixed', step, app);
      this._accum -= step;
      guard++;
    }
    // Variable update (smoothing, VFX, non-deterministic)
    this._emit('update', dt, app);
    // Late update (sync transforms just before render)
    this._emit('late', dt, app);
  }
  _emit(phase, dt, app) {
    const list = this.handlers[phase];
    for (let i = 0; i < list.length; i++) {
      try {
        list[i](dt, app);
      } catch (e) {
        console.error(`EventSystem ${phase} handler error:`, e);
      }
    }
  }
  // ---------------------------
  // Input handling and API
  // ---------------------------
  async _loadKeybinds() {
    try {
      const data = await loadJSON("build/assets/config/keybinds.json");
      if (data && typeof data === "object") {
        this.keybinds = Object.assign({}, this.keybinds, data);
      }
    } catch (_e) {
      // keep defaults
    }
  }
  _setupInputListeners() {
    // Keyboard
    window.addEventListener('keydown', (e) => this.keys.add(e.code));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    // Pointer look (pointer lock)
    this.dom.addEventListener('click', () => this.dom.requestPointerLock?.());
    document.addEventListener('pointerlockchange', () => {
      // no-op; controller components can check pointer lock via document.pointerLockElement === dom
    });
    this.dom.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== this.dom) return;
      this._lookDX += e.movementX || 0;
      this._lookDY += e.movementY || 0;
    });
    // Touch
    const isLeftHalf = (x) => x < (this.dom.getBoundingClientRect?.().width || window.innerWidth) * 0.5;
    const onTouchStart = (e) => {
      for (const t of e.changedTouches) {
        const x = t.clientX;
        const y = t.clientY;
        if (this._moveTouchId === null && isLeftHalf(x)) {
          this._moveTouchId = t.identifier;
          this._moveStart.x = x;
          this._moveStart.y = y;
          this._moveVec.x = 0;
          this._moveVec.y = 0;
        } else if (this._lookTouchId === null) {
          this._lookTouchId = t.identifier;
          this._lastLookX = x;
          this._lastLookY = y;
          this._lookTapStart = performance.now();
          this._lookTapMoved = false;
        }
      }
    };
    const onTouchMove = (e) => {
      e.preventDefault?.();
      for (const t of e.changedTouches) {
        if (t.identifier === this._moveTouchId) {
          const dx = t.clientX - this._moveStart.x;
          const dy = t.clientY - this._moveStart.y;
          let mx = Math.max(-1, Math.min(1, dx / this._touchRadius));
          let my = Math.max(-1, Math.min(1, -dy / this._touchRadius));
          const len = Math.hypot(mx, my);
          if (len > 1) { mx /= len; my /= len; }
          this._moveVec.x = mx;
          this._moveVec.y = my;
        } else if (t.identifier === this._lookTouchId) {
          const dx = t.clientX - (this._lastLookX || t.clientX);
          const dy = t.clientY - (this._lastLookY || t.clientY);
          this._lookDX += dx;
          this._lookDY += dy;
          if (Math.abs(dx) > 6 || Math.abs(dy) > 6) this._lookTapMoved = true;
          this._lastLookX = t.clientX;
          this._lastLookY = t.clientY;
        }
      }
    };
    const onTouchEnd = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this._moveTouchId) {
          this._moveTouchId = null;
          this._moveVec.x = 0;
          this._moveVec.y = 0;
        } else if (t.identifier === this._lookTouchId) {
          const tapTime = performance.now() - (this._lookTapStart || 0);
          if (tapTime < 240 && !this._lookTapMoved) {
            this._jumpQueued = true;
          }
          this._lookTouchId = null;
          this._lastLookX = undefined;
          this._lastLookY = undefined;
        }
      }
    };
    this.dom.addEventListener('touchstart', onTouchStart, { passive: true });
    this.dom.addEventListener('touchmove', onTouchMove, { passive: false });
    this.dom.addEventListener('touchend', onTouchEnd, { passive: true });
    this.dom.addEventListener('touchcancel', onTouchEnd, { passive: true });
  }
  _pollGamepad() {
    const pads = navigator.getGamepads?.() || [];
    this.gamepad = pads[0] || null;
  }
  get inputState() {
    // Keyboard via keybind map
    const kb = this.keybinds || {};
    const pressed = (keys) => {
      if (!Array.isArray(keys)) return false;
      for (let i = 0; i < keys.length; i++) if (this.keys.has(keys[i])) return true;
      return false;
    };
    let x = 0;
    let y = 0;
    if (pressed(kb.moveLeft)) x -= 1;
    if (pressed(kb.moveRight)) x += 1;
    if (pressed(kb.moveForward)) y += 1;
    if (pressed(kb.moveBackward)) y -= 1;
    // Gamepad
    this._pollGamepad();
    const g = this.gamepad;
    if (g) {
      const ax = g.axes?.[0] ?? 0;
      const ay = g.axes?.[1] ?? 0;
      x += ax;
      y += -ay;
      const dpx = (g.axes?.[6] === -1 ? -1 : 0) + (g.axes?.[6] === 1 ? 1 : 0);
      const dpy = (g.axes?.[7] === -1 ? 1 : 0) + (g.axes?.[7] === 1 ? -1 : 0);
      x += dpx;
      y += dpy;
    }
    // Touch virtual joystick
    x += this._moveVec.x;
    y += this._moveVec.y;
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    const sprint = pressed(kb.sprint) || (g?.buttons?.[10]?.pressed ?? false);
    const crouch = pressed(kb.crouch) || (g?.buttons?.[1]?.pressed ?? false);
    const jump = pressed(kb.jump) || (g?.buttons?.[0]?.pressed ?? false);
    return { x, y, sprint, crouch, jump };
  }
  consumeLookDelta() {
    this._pollGamepad();
    let dx = this._lookDX;
    let dy = this._lookDY;
    this._lookDX = 0;
    this._lookDY = 0;
    const g = this.gamepad;
    if (g) {
      const rx = g.axes?.[2] ?? 0;
      const ry = g.axes?.[3] ?? 0;
      dx += rx;
      dy += ry;
    }
    return { dx, dy };
  }
  consumeJumpQueued() {
    const j = this._jumpQueued;
    this._jumpQueued = false;
    return j;
  }

  // ---------------------------
  // Gameplay event pub/sub
  // ---------------------------
  onEvent(name, fn) {
    if (!name || typeof fn !== 'function') return;
    const key = String(name);
    if (!this._events.has(key)) this._events.set(key, []);
    this._events.get(key).push(fn);
  }
  offEvent(name, fn) {
    const key = String(name || '');
    const list = this._events.get(key);
    if (!list) return;
    if (!fn) { this._events.delete(key); return; }
    const idx = list.indexOf(fn);
    if (idx >= 0) list.splice(idx, 1);
  }
  emit(name, payload) {
    const key = String(name || '');
    const list = this._events.get(key) || [];
    for (let i = 0; i < list.length; i++) {
      try { list[i](payload); } catch (e) { console.error(`EventSystem emit '${key}' error:`, e); }
    }
  }
}


