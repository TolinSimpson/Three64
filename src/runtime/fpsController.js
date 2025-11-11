'use strict';
import { Vector2, Vector3, Euler } from "three";
import { ComponentRegistry } from "./component.js";
import { ensureAmmo, stepAmmo, ammoRaycast } from "./physics.js";

export class FPSController {
  constructor(dom, camera, input = null, options = {}) {
    this.dom = dom;
    this.camera = camera;
    this.enabled = false;
    this.sensitivity = options.sensitivity ?? 0.0022;
    this.speed = options.speed ?? 3.2;
    this.sprintMultiplier = options.sprintMultiplier ?? 1.8;
    this.jumpSpeed = options.jumpSpeed ?? 5.5;
    this.maxMouseDeltaPx = options.maxMouseDeltaPx ?? 50; // clamp pointer-lock spikes
    this.maxTouchPixelDelta = options.maxTouchPixelDelta ?? 120; // clamp per-frame touch pixels
    this.keys = new Set();
    this.input = input;
    this.rig = null;

    // Player kinematics
    this.eyeHeight = 1.6;
    this.gravity = 9.8;
    this.velY = 0;
    this.grounded = false;
    this.position = new Vector3(0, 0, 0); // player feet at y=0 ground

    // Ensure camera uses world up and initialize player from camera
    this.camera.up.set(0, 1, 0);
    this.position.copy(this.camera.position);
    this.position.y = Math.max(0, this.camera.position.y - this.eyeHeight);

    // Look smoothing
    this.yaw = camera.rotation.y;
    this.pitch = camera.rotation.x;
    this.targetYaw = this.yaw;
    this.targetPitch = this.pitch;
    this.euler = new Euler(0, 0, 0, 'YXZ');
    dom.addEventListener('click', () => this.lock());
    document.addEventListener('pointerlockchange', () => {
      this.enabled = document.pointerLockElement === dom;
    });
    dom.addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      const mx = Math.max(-this.maxMouseDeltaPx, Math.min(this.maxMouseDeltaPx, e.movementX || 0));
      const my = Math.max(-this.maxMouseDeltaPx, Math.min(this.maxMouseDeltaPx, e.movementY || 0));
      this.targetYaw -= mx * this.sensitivity;
      // Normalize target to avoid runaway beyond circle
      this.targetYaw = Math.atan2(Math.sin(this.targetYaw), Math.cos(this.targetYaw));
      this.targetPitch -= my * this.sensitivity;
      this.targetPitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.targetPitch));
    });
    window.addEventListener('keydown', (e) => this.keys.add(e.code));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
  }


  setRig(object3D) {
    this.rig = object3D || null;
    if (this.rig) {
      this.position.copy(this.rig.position);
    }
  }

  lock() {
    this.dom.requestPointerLock?.();
  }

  update(dt) {
    // Step Ammo world early; initialize lazily
    ensureAmmo().then(() => stepAmmo(dt)).catch(() => {});
    // Smooth look with proper circular interpolation for yaw
    const lerp = (a, b, t) => a + (b - a) * t;
    const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
    const s = Math.min(1, dt * 12);
    // Move yaw along shortest arc towards targetYaw
    const yawDelta = wrapAngle(this.targetYaw - this.yaw);
    this.yaw = wrapAngle(this.yaw + yawDelta * s);
    // Standard lerp for pitch
    this.pitch = lerp(this.pitch, this.targetPitch, s);
    // Clamp pitch to avoid flipping; keep slight epsilon
    const EPS = 1e-3;
    const HALF_PI = Math.PI / 2 - EPS;
    if (this.pitch > HALF_PI) this.pitch = HALF_PI;
    if (this.pitch < -HALF_PI) this.pitch = -HALF_PI;
    // Keep targets numerically stable as well
    this.targetYaw = wrapAngle(this.targetYaw);
    // Apply orientation with fixed order Yaw->Pitch and zero roll
    this.euler.set(this.pitch, this.yaw, 0);
    this.camera.quaternion.setFromEuler(this.euler);

    // Allow mobile/touch control without pointer lock
    const mobileActive = !!(this.input && (this.input.moveTouchId !== null || this.input.lookTouchId !== null));
    if (!this.enabled && !mobileActive) {
      // Even when disabled, keep rig aligned to player position
      if (this.rig) {
        this.rig.position.copy(this.position);
      } else {
        this.camera.position.x = this.position.x;
        this.camera.position.y = this.position.y + this.eyeHeight;
        this.camera.position.z = this.position.z;
      }
      return;
    }

    // Additional look from touch/gamepad when available
    if (this.input) {
      const { dx, dy } = this.input.consumeLookDelta();
      const stickScale = this.sensitivity * 12 * dt; // for gamepad-like deltas [-1,1]
      const pixelScale = this.sensitivity * 0.6;     // for touch pixels
      // Heuristic split
      const sx = Math.max(-1, Math.min(1, dx));
      const sy = Math.max(-1, Math.min(1, dy));
      let px = dx - sx;
      let py = dy - sy;
      // Clamp per-frame pixel deltas to avoid spikes
      px = Math.max(-this.maxTouchPixelDelta, Math.min(this.maxTouchPixelDelta, px));
      py = Math.max(-this.maxTouchPixelDelta, Math.min(this.maxTouchPixelDelta, py));
      this.targetYaw -= sx * stickScale + px * pixelScale;
      this.targetYaw = Math.atan2(Math.sin(this.targetYaw), Math.cos(this.targetYaw));
      this.targetPitch -= sy * stickScale + py * pixelScale;
      const HALF_PI = Math.PI / 2;
      this.targetPitch = Math.max(-HALF_PI, Math.min(HALF_PI, this.targetPitch));
    }

    // Horizontal input (Quake-style)
    const moveInput = new Vector2(0, 0);
    let sprinting = false;
    let wantsJump = false;
    if (this.input) {
      // Use composite input from Input helper
      const s = this.input.inputState;
      moveInput.x = s.x;  // strafe
      moveInput.y = s.y;  // forward
      sprinting = s.sprint || this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
      wantsJump = s.jump || this.input.consumeJumpQueued() || this.keys.has('Space');
    } else {
      if (this.keys.has('KeyW')) moveInput.y += 1;
      if (this.keys.has('KeyS')) moveInput.y -= 1;
      if (this.keys.has('KeyA')) moveInput.x -= 1;
      if (this.keys.has('KeyD')) moveInput.x += 1;
      sprinting = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
      wantsJump = this.keys.has('Space');
    }
    if (moveInput.lengthSq() > 1) moveInput.normalize();

    const forward = new Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new Vector3(-forward.z, 0, forward.x);
    const move = new Vector3();
    move.addScaledVector(forward, moveInput.y);
    move.addScaledVector(right, moveInput.x);
    const currentSpeed = this.speed * (sprinting ? this.sprintMultiplier : 1);
    if (move.lengthSq() > 0) move.normalize().multiplyScalar(currentSpeed * dt);

    // Physics-integrated movement
    if (wantsJump && this.grounded) {
      this.velY = this.jumpSpeed;
      this.grounded = false;
    }
    this._resolveKinematicWithAmmo(move, dt);

    // Sync rig (preferred) or camera fallback
    if (this.rig) {
      this.rig.position.copy(this.position);
      // Ensure camera local offset remains eyeHeight; camera orientation already set above
      if (this.camera.parent === this.rig) {
        this.camera.position.set(0, this.eyeHeight, 0);
      }
    } else {
      this.camera.position.x = this.position.x;
      this.camera.position.y = this.position.y + this.eyeHeight;
      this.camera.position.z = this.position.z;
    }
  }

  _raycastWithGround(origin, direction, maxDistance = 100) {
    const dir = direction.clone().normalize();
    let closest = ammoRaycast(origin, dir, maxDistance);
    // Ground plane y=0
    if (Math.abs(dir.y) > 1e-5) {
      const t = (0 - origin.y) / dir.y;
      if (t >= 0 && t <= maxDistance) {
        const p = origin.clone().addScaledVector(dir, t);
        const groundHit = {
          distance: t,
          point: p,
          face: { normal: new Vector3(0, 1, 0) },
          object: null,
        };
        if (!closest || groundHit.distance < closest.distance) closest = groundHit;
      }
    }
    return closest || null;
  }

  _resolveKinematicWithAmmo(desiredMove, dt) {
    const up = new Vector3(0, 1, 0);
    const pos = this.position;
    const eyeHeight = this.eyeHeight || 1.6;
    const radius = 0.4;
    const stepSnap = 0.3;
    const EPS = 1e-4;

    // Vertical integrate gravity
    this.velY -= (this.gravity ?? 9.8) * dt;

    // Ground detection from head
    const head = pos.clone().addScaledVector(up, eyeHeight);
    const downHit = this._raycastWithGround(head, new Vector3(0, -1, 0), eyeHeight + 10);
    let groundY = null;
    if (downHit) groundY = downHit.point.y;

    // Predict vertical motion
    let newY = pos.y + this.velY * dt;
    let grounded = false;
    if (groundY !== null) {
      const feetToGround = Math.max(0, pos.y - groundY);
      const nearGround = feetToGround <= stepSnap + 1e-3;
      const falling = this.velY <= 0;
      if (nearGround && falling && head.y >= groundY) {
        newY = groundY;
        this.velY = 0;
        grounded = true;
      }
    }
    pos.y = newY;
    this.grounded = grounded;

    // Capsule sample heights
    const sampleHeights = [Math.min(radius + 0.02, eyeHeight * 0.33), Math.min(eyeHeight * 0.5, 0.9), Math.max(eyeHeight - radius - 0.02, eyeHeight * 0.7)];
    const capsuleRaycast = (originBase, dir, dist) => {
      let best = null;
      for (let i = 0; i < sampleHeights.length; i++) {
        const o = originBase.clone().addScaledVector(up, sampleHeights[i]);
        const h = this._raycastWithGround(o, dir, dist);
        if (!h) continue;
        if (!best || h.distance < best.distance) best = h;
      }
      return best;
    };

    // Substep horizontal slide
    let remainingLen = desiredMove.length();
    if (remainingLen > EPS) {
      let dir = desiredMove.clone().multiplyScalar(1 / remainingLen);
      const maxStep = 0.25;
      let subRemaining = remainingLen;
      const originBase = pos.clone();
      while (subRemaining > EPS) {
        const stepLen = Math.min(maxStep, subRemaining);
        let stepRemaining = stepLen;
        let iterations = 0;
        while (stepRemaining > EPS && iterations < 3) {
          iterations++;
          const hit = capsuleRaycast(originBase, dir, stepRemaining + radius);
          if (hit && hit.distance < stepRemaining + radius - EPS) {
            const n = hit.face?.normal?.clone?.() || new Vector3(0, 1, 0);
            const forwardAllowed = Math.max(0, hit.distance - radius);
            if (forwardAllowed > EPS) {
              pos.addScaledVector(dir, forwardAllowed);
            }
            const consumed = forwardAllowed;
            stepRemaining -= consumed;
            subRemaining -= consumed;
            if (stepRemaining > EPS) {
              if (dir.dot(n) > 0) n.multiplyScalar(-1);
              const slideDir = dir.clone().addScaledVector(n, -dir.dot(n));
              const sLen = slideDir.length();
              if (sLen > EPS) dir.copy(slideDir.multiplyScalar(1 / sLen)); else break;
            }
          } else {
            pos.addScaledVector(dir, stepRemaining);
            subRemaining -= stepRemaining;
            stepRemaining = 0;
          }
        }
        originBase.copy(pos);
      }
    }

    // Ceiling
    if (this.velY > 0) {
      const upHit = this._raycastWithGround(head, up, this.velY * dt + 0.1);
      if (upHit) this.velY = 0;
    }
  }
}

// Default export: property component for 'fpsController'
class FPSControllerComponent {
  constructor({ game, object /*, options, propName */ }) {
    this.game = game;
    this.object = object;
  }
  Initialize() {
    const pos = new Vector3();
    this.object.getWorldPosition(pos);
    const rig = this.game?.rendererCore?.camera?.parent;
    if (rig) {
      rig.position.set(pos.x, Math.max(0, pos.y), pos.z);
    }
    if (this.game?.fps) {
      this.game.fps.position.set(pos.x, Math.max(0, pos.y), pos.z);
    }
  }
}

export default FPSControllerComponent;

// Register for registry-based userData components
ComponentRegistry.register("fpsController", FPSControllerComponent);
ComponentRegistry.register("FPSController", FPSControllerComponent);