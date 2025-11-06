import * as THREE from "https://unpkg.com/three@0.161.0/build/three.module.js";
import { ComponentRegistry } from "./component.js";

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
    this.position = new THREE.Vector3(0, 0, 0); // player feet at y=0 ground

    // Ensure camera uses world up and initialize player from camera
    this.camera.up.set(0, 1, 0);
    this.position.copy(this.camera.position);
    this.position.y = Math.max(0, this.camera.position.y - this.eyeHeight);

    // Look smoothing
    this.yaw = camera.rotation.y;
    this.pitch = camera.rotation.x;
    this.targetYaw = this.yaw;
    this.targetPitch = this.pitch;
    this.euler = new THREE.Euler(0, 0, 0, 'YXZ');
    this.physics = null;

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

  setPhysics(physicsWorld) {
    this.physics = physicsWorld || null;
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
    const moveInput = new THREE.Vector2(0, 0);
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

    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    const move = new THREE.Vector3();
    move.addScaledVector(forward, moveInput.y);
    move.addScaledVector(right, moveInput.x);
    const currentSpeed = this.speed * (sprinting ? this.sprintMultiplier : 1);
    if (move.lengthSq() > 0) move.normalize().multiplyScalar(currentSpeed * dt);

    // Physics-integrated movement
    if (wantsJump && this.grounded) {
      this.velY = this.jumpSpeed;
      this.grounded = false;
    }
    if (this.physics) {
      this.physics.resolvePlayer(this, move, dt);
    } else {
      // Fallback: simple plane at y=0
      // Semi-implicit Euler for stable gravity
      this.velY -= this.gravity * dt;
      this.position.y += this.velY * dt;
      const GROUND_Y = 0;
      const GROUND_EPS = 1e-4;
      if (this.position.y < GROUND_Y - GROUND_EPS) {
        // Prevent tunneling below ground, reflect back to plane
        this.position.y = GROUND_Y;
      }
      if (this.position.y <= GROUND_Y + GROUND_EPS && this.velY <= 0) {
        this.position.y = 0;
        this.velY = 0;
        this.grounded = true;
      } else {
        this.grounded = false;
      }
      this.position.add(move);
    }

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
}

// Default export: property component for 'fpsController'
class FPSControllerComponent {
  constructor({ game, object /*, options, propName */ }) {
    this.game = game;
    this.object = object;
  }
  Initialize() {
    const pos = new THREE.Vector3();
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