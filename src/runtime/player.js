'use strict';
import { Vector3 } from "three";
import { Component, ComponentRegistry } from "./component.js";
import { CharacterController } from "./characterController.js";

export class Player extends Component {
  constructor(ctx) {
    super(ctx);
    this.controller = null;
    this.camera = null;
    this.rig = null;
    const opts = (ctx && ctx.options) || {};
    this.lookSensitivity = typeof opts.lookSensitivity === 'number' ? opts.lookSensitivity : 0.0022;
    this.maxTouchPixelDelta = typeof opts.maxTouchPixelDelta === 'number' ? opts.maxTouchPixelDelta : 120;
  }

  static getDefaultParams() {
    return {
      lookSensitivity: 0.0022,
      maxTouchPixelDelta: 120
    };
  }

  static getParamDescriptions() {
    return [
      {
        key: 'lookSensitivity',
        label: 'Look Sensitivity',
        type: 'number',
        min: 0.0001,
        max: 0.02,
        step: 0.0001,
        description: 'Mouse/Gamepad look sensitivity used to convert deltas to yaw/pitch.'
      },
      {
        key: 'maxTouchPixelDelta',
        label: 'Max Touch Delta (px/frame)',
        type: 'number',
        min: 16,
        max: 240,
        step: 1,
        description: 'Clamp for per-frame touch look pixel movement to avoid spikes.'
      }
    ];
  }

  Initialize() {
    const app = this.game;
    this.camera = app?.rendererCore?.camera || null;
    this.rig = this.camera?.parent || this.object || null;
    const start = new Vector3();
    if (this.rig && this.rig.getWorldPosition) {
      this.rig.getWorldPosition(start);
      start.y = Math.max(0, start.y);
    } else if (this.camera) {
      this.camera.getWorldPosition(start);
      start.y = Math.max(0, start.y - 1.6);
    }
    this.controller = new CharacterController({ position: start });
    if (this.camera) this.controller.setOrientationFromCamera(this.camera);
    if (app) app.player = this;
  }

  Input(dt, app) {
    if (!app?.eventSystem || !this.controller) return;
    // Look input from touch+gamepad
    const { dx, dy } = app.eventSystem.consumeLookDelta();
    const sx = Math.max(-1, Math.min(1, dx));
    const sy = Math.max(-1, Math.min(1, dy));
    let px = dx - sx;
    let py = dy - sy;
    const clampPx = this.maxTouchPixelDelta;
    px = Math.max(-clampPx, Math.min(clampPx, px));
    py = Math.max(-clampPx, Math.min(clampPx, py));
    const stickScale = this.lookSensitivity * 12 * dt;
    const pixelScale = this.lookSensitivity * 0.6;
    const dYaw = -(sx * stickScale + px * pixelScale);
    const dPitch = -(sy * stickScale + py * pixelScale);
    this.controller.setLookDelta(dYaw, dPitch);

    // Movement input
    const s = app.eventSystem.inputState;
    const jump = s.jump || app.eventSystem.consumeJumpQueued();
    this.controller.setMoveInput(s.x, s.y, s.sprint, jump);
  }

  FixedUpdate(dt, app) {
    if (!this.controller) return;
    this.controller.fixedStep(app, dt);
  }

  Update(dt /*, app */) {
    if (!this.controller) return;
    this.controller.update(dt);
  }

  LateUpdate(dt, app) {
    if (!this.controller) return;
    const camera = this.camera || app?.rendererCore?.camera || null;
    const rig = this.rig || camera?.parent || null;
    this.controller.lateApplyToRig(rig, camera);
  }
}

ComponentRegistry.register("Player", Player);
ComponentRegistry.register("player", Player);


