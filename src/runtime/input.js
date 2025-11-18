'use strict';
export class Input {
  constructor(dom) {
    this.keys = new Set();
    this.gamepad = null;
    this.dom = dom || document.body;

    // Keyboard
    window.addEventListener('keydown', e => this.keys.add(e.code));
    window.addEventListener('keyup', e => this.keys.delete(e.code));

    // Pointer look (pointer lock)
    this.dom.addEventListener('click', () => {
      try { this.dom.requestPointerLock?.(); } catch (_e) {}
    });
    document.addEventListener('pointerlockchange', () => {});
    this.dom.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== this.dom) return;
      this.lookDeltaX += e.movementX || 0;
      this.lookDeltaY += e.movementY || 0;
    });

    // Touch (virtual joystick + look swipe)
    this.moveTouchId = null;
    this.lookTouchId = null;
    this.moveStart = { x: 0, y: 0 };
    this.moveVec = { x: 0, y: 0 }; // x: strafe, y: forward
    this.lookDeltaX = 0;
    this.lookDeltaY = 0;
    this.jumpQueued = false;

    const isLeftHalf = (x) => x < (this.dom.getBoundingClientRect?.().width || window.innerWidth) * 0.5;
    const touchRadius = 64; // px radius for full move deflection

    const onTouchStart = (e) => {
      for (const t of e.changedTouches) {
        const x = t.clientX;
        const y = t.clientY;
        if (this.moveTouchId === null && isLeftHalf(x)) {
          this.moveTouchId = t.identifier;
          this.moveStart.x = x;
          this.moveStart.y = y;
          this.moveVec.x = 0;
          this.moveVec.y = 0;
        } else if (this.lookTouchId === null) {
          this.lookTouchId = t.identifier;
          this._lastLookX = x;
          this._lastLookY = y;
          this._lookTapStart = performance.now();
          this._lookTapMoved = false;
        }
      }
    };

    const onTouchMove = (e) => {
      // Prevent page scroll while using controls
      e.preventDefault?.();
      for (const t of e.changedTouches) {
        if (t.identifier === this.moveTouchId) {
          const dx = t.clientX - this.moveStart.x;
          const dy = t.clientY - this.moveStart.y;
          // Map to [-1,1], invert dy so up is forward
          let mx = Math.max(-1, Math.min(1, dx / touchRadius));
          let my = Math.max(-1, Math.min(1, -dy / touchRadius));
          const len = Math.hypot(mx, my);
          if (len > 1) {
            mx /= len;
            my /= len;
          }
          this.moveVec.x = mx;
          this.moveVec.y = my;
        } else if (t.identifier === this.lookTouchId) {
          const dx = t.clientX - (this._lastLookX || t.clientX);
          const dy = t.clientY - (this._lastLookY || t.clientY);
          this.lookDeltaX += dx;
          this.lookDeltaY += dy;
          if (Math.abs(dx) > 6 || Math.abs(dy) > 6) this._lookTapMoved = true;
          this._lastLookX = t.clientX;
          this._lastLookY = t.clientY;
        }
      }
    };

    const onTouchEnd = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.moveTouchId) {
          this.moveTouchId = null;
          this.moveVec.x = 0;
          this.moveVec.y = 0;
        } else if (t.identifier === this.lookTouchId) {
          const tapTime = performance.now() - (this._lookTapStart || 0);
          if (tapTime < 240 && !this._lookTapMoved) {
            this.jumpQueued = true;
          }
          this.lookTouchId = null;
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

  pollGamepad() {
    const pads = navigator.getGamepads?.() || [];
    this.gamepad = pads[0] || null;
  }

  // Composite input state (PC/Gamepad/Mobile)
  get inputState() {
    const g = this.gamepad;
    let x = 0; // strafe right +
    let y = 0; // forward +

    // Keyboard WASD
    if (this.keys.has('KeyA')) x -= 1;
    if (this.keys.has('KeyD')) x += 1;
    if (this.keys.has('KeyW')) y += 1;
    if (this.keys.has('KeyS')) y -= 1;

    // Gamepad left stick + dpad
    if (g) {
      const ax = g.axes?.[0] ?? 0;
      const ay = g.axes?.[1] ?? 0;
      x += ax;
      y += -ay; // invert so up on stick is forward
      // DPad via axes 6/7 or standard buttons 12-15
      const dpx = (g.axes?.[6] === -1 ? -1 : 0) + (g.axes?.[6] === 1 ? 1 : 0);
      const dpy = (g.axes?.[7] === -1 ? 1 : 0) + (g.axes?.[7] === 1 ? -1 : 0);
      x += dpx;
      y += dpy;
    }

    // Touch virtual joystick
    x += this.moveVec.x;
    y += this.moveVec.y;

    // Normalize if needed
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }

    const sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || (g?.buttons?.[10]?.pressed ?? false);
    const crouch = this.keys.has('ControlLeft') || this.keys.has('ControlRight') || (g?.buttons?.[1]?.pressed ?? false);
    const jump = this.keys.has('Space') || (g?.buttons?.[0]?.pressed ?? false);

    return { x, y, sprint, crouch, jump };
  }

  consumeLookDelta() {
    // Combine touch swipe with gamepad right stick each frame
    this.pollGamepad();
    let dx = this.lookDeltaX;
    let dy = this.lookDeltaY;
    this.lookDeltaX = 0;
    this.lookDeltaY = 0;

    const g = this.gamepad;
    if (g) {
      const rx = g.axes?.[2] ?? 0;
      const ry = g.axes?.[3] ?? 0;
      // Return stick as additive deltas in normalized units
      dx += rx;
      dy += ry;
    }
    return { dx, dy };
  }

  consumeJumpQueued() {
    const j = this.jumpQueued;
    this.jumpQueued = false;
    return j;
  }
}
