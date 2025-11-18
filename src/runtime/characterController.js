'use strict';
import { Euler, Vector2, Vector3 } from "three";
import { resolveCharacterPhysics } from "./characterPhysics.js";

export class CharacterController {
  constructor({
    position = new Vector3(0, 0, 0),
    eyeHeight = 1.6,
    speed = 3.2,
    sprintMultiplier = 1.8,
    jumpSpeed = 5.5,
    lookSensitivity = 0.0022,
    maxPitch = Math.PI / 2 - 1e-3,
  } = {}) {
    this.position = position.clone();
    this.eyeHeight = eyeHeight;
    this.speed = speed;
    this.sprintMultiplier = sprintMultiplier;
    this.jumpSpeed = jumpSpeed;
    this.lookSensitivity = lookSensitivity;
    this.maxPitch = maxPitch;
    this.gravity = 9.8;
    this.velY = 0;
    this.grounded = false;

    // look state
    this.yaw = 0;
    this.pitch = 0;
    this.targetYaw = 0;
    this.targetPitch = 0;
    this._euler = new Euler(0, 0, 0, 'YXZ');

    // input state
    this._move = new Vector2(0, 0); // x: strafe, y: forward
    this._sprinting = false;
    this._jumpQueued = false;
  }

  setOrientationFromCamera(camera) {
    if (!camera) return;
    this.yaw = camera.rotation.y;
    this.pitch = camera.rotation.x;
    this.targetYaw = this.yaw;
    this.targetPitch = this.pitch;
    // initialize position from camera feet
    const p = camera.position;
    this.position.set(p.x, Math.max(0, p.y - this.eyeHeight), p.z);
  }

  setLookDelta(deltaYaw, deltaPitch) {
    if (!isFinite(deltaYaw) || !isFinite(deltaPitch)) return;
    this.targetYaw = wrapAngle(this.targetYaw + deltaYaw);
    this.targetPitch = clamp(this.targetPitch + deltaPitch, -this.maxPitch, this.maxPitch);
  }

  setMoveInput(strafe, forward, sprint = false, jump = false) {
    this._move.set(
      Math.max(-1, Math.min(1, Number(strafe) || 0)),
      Math.max(-1, Math.min(1, Number(forward) || 0))
    );
    if (this._move.lengthSq() > 1) this._move.normalize();
    this._sprinting = !!sprint;
    if (jump) this._jumpQueued = true;
  }

  update(dt) {
    // Smooth look interpolation
    const s = Math.min(1, dt * 12);
    const yawDelta = shortestArc(this.targetYaw - this.yaw);
    this.yaw = wrapAngle(this.yaw + yawDelta * s);
    this.pitch = lerp(this.pitch, this.targetPitch, s);
    this.targetYaw = wrapAngle(this.targetYaw);
  }

  fixedStep(app, dt) {
    const forwardDir = new Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const rightDir = new Vector3(-forwardDir.z, 0, forwardDir.x);
    const desired = new Vector3();
    desired.addScaledVector(forwardDir, this._move.y);
    desired.addScaledVector(rightDir, this._move.x);
    const speed = this.speed * (this._sprinting ? this.sprintMultiplier : 1);
    if (desired.lengthSq() > 0) desired.normalize().multiplyScalar(speed * dt);

    // Jump
    if (this._jumpQueued && this.grounded) {
      this.velY = this.jumpSpeed;
      this.grounded = false;
    }
    this._jumpQueued = false;

    // Integrate with physics
    const physics = app?.physics;
    if (physics) {
      resolveCharacterPhysics(physics, this, desired, dt);
    } else {
      // Fallback: simple kinematic integration without collisions
      this.velY -= (this.gravity ?? 9.8) * dt;
      this.position.add(desired);
      this.position.y += this.velY * dt;
      if (this.position.y < 0) { this.position.y = 0; this.velY = 0; this.grounded = true; }
    }
  }

  lateApplyToRig(rig, camera) {
    if (rig) {
      rig.position.copy(this.position);
      if (camera && camera.parent === rig) {
        camera.position.set(0, this.eyeHeight, 0);
      }
    } else if (camera) {
      camera.position.set(this.position.x, this.position.y + this.eyeHeight, this.position.z);
    }
    if (camera) {
      this._euler.set(this.pitch, this.yaw, 0);
      camera.quaternion.setFromEuler(this._euler);
    }
  }
}

function wrapAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
function shortestArc(a) {
  return wrapAngle(a);
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
