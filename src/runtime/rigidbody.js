'use strict';
import { Vector3, Quaternion } from "three";
import { Component, ComponentRegistry } from "./component.js";
import { Volume } from "./volume.js";
import { executeActions } from "./event.js";

// Rigidbody component: wraps Ammo rigid body creation and simple collision/volume events.
export class Rigidbody extends Component {
	constructor(ctx) {
		super(ctx);
		const o = (ctx && ctx.options) || {};
		this.shape = (o.shape || "box");                            // "box" | "sphere" | "capsule" | "convex"
		this.type = (o.type || "dynamic");                          // "dynamic" | "kinematic" | "static"
		this.mass = (typeof o.mass === "number" ? o.mass : (this.type === "dynamic" ? 1 : 0));
		this.size = Array.isArray(o.size) ? o.size : undefined;      // [x,y,z] for box
		this.radius = (typeof o.radius === "number" ? o.radius : undefined); // sphere/capsule
		this.height = (typeof o.height === "number" ? o.height : undefined); // capsule cylinder height
		this.friction = (typeof o.friction === "number" ? o.friction : undefined);
		this.restitution = (typeof o.restitution === "number" ? o.restitution : undefined);
		this.linearDamping = (typeof o.linearDamping === "number" ? o.linearDamping : undefined);
		this.angularDamping = (typeof o.angularDamping === "number" ? o.angularDamping : undefined);
		this.layer = (typeof o.layer === "number" ? o.layer : undefined);
		this.mask = (o.mask != null ? o.mask : undefined);          // number or [numbers]
		this.enableGravity = (o.enableGravity !== false);
		// Events
		const ev = o.events || {};
		this.onCollisionEvent = ev.onCollision || "";               // name or empty to disable
		this.onVolumeEnterEvent = ev.onVolumeEnter || "";
		this.onVolumeExitEvent = ev.onVolumeExit || "";
		this.onVolumeStayEvent = ev.onVolumeStay || "";
		// Optional internal Volume helper
		this.useVolume = o.useVolume === true || (!!this.onVolumeEnterEvent || !!this.onVolumeExitEvent || !!this.onVolumeStayEvent);
		this.volumeShape = (o.volumeShape || this.shape || "box");
		this.volumeSize = Array.isArray(o.volumeSize) ? o.volumeSize : this.size;
		this.volumeRadius = (typeof o.volumeRadius === "number" ? o.volumeRadius : (this.radius != null ? this.radius : undefined));
		// Internal
		this.body = null;
		this._rbType = String(this.type || "dynamic").toLowerCase();
		this._rbLastPos = null;
		this._fallbackVel = new Vector3(0, 0, 0); // used when Ammo is unavailable
		this._volumeComp = null;
	}

	static getDefaultParams() {
		return {
			shape: "box",
			type: "dynamic",
			mass: 1,
			friction: 0.5,
			restitution: 0.0,
			linearDamping: 0.01,
			angularDamping: 0.01,
			enableGravity: true,
			events: {
				onCollision: "RigidbodyCollision",
				onVolumeEnter: "",
				onVolumeExit: "",
				onVolumeStay: "",
			},
			useVolume: false,
		};
	}

	Initialize() {
		// Create ammo rigid body if physics available
		const phys = this.game?.physics || null;
		if (phys?.addRigidBodyForObject) {
			this.body = phys.addRigidBodyForObject(this.object, {
				shape: this.shape,
				type: this.type,
				mass: this.mass,
				friction: this.friction,
				restitution: this.restitution,
				linearDamping: this.linearDamping,
				angularDamping: this.angularDamping,
				layer: this.layer,
				mask: this.mask,
				size: this.size,
				radius: this.radius,
				height: this.height,
			});
			// Per-body gravity
			if (this.body && this.game?.physics?.Ammo && this.enableGravity === false) {
				try {
					const Ammo = this.game.physics.Ammo;
					this.body.setGravity(new Ammo.btVector3(0, 0, 0));
				} catch {}
			}
		}
		// Optional internal Volume component to emit enter/exit/stay events
		if (this.useVolume) {
			try {
				const volOpts = {
					enabled: true,
					phase: "fixed",
					shape: (this.volumeShape || "box"),
					size: this.volumeSize,
					radius: (typeof this.volumeRadius === "number" ? this.volumeRadius : 1),
					target: { mode: "scene", onlyMeshes: true },
					events: {
						onEnter: this.onVolumeEnterEvent || "",
						onExit: this.onVolumeExitEvent || "",
						onStay: this.onVolumeStayEvent || "",
					},
					includePayloadObjectRef: true,
				};
				this._volumeComp = new Volume({ game: this.game, object: this.object, options: volOpts, propName: "Volume" });
				this.object.__components = this.object.__components || [];
				this.object.__components.push(this._volumeComp);
				this.game.componentInstances.push(this._volumeComp);
				this._volumeComp.Initialize?.();
			} catch {}
		}
		// Track position for sweep tests
		try { this._rbLastPos = this.object.getWorldPosition(new Vector3()); } catch { this._rbLastPos = new Vector3(); }
	}

	Dispose() {
		// Volume is managed by component system lifetime; no explicit removal here.
	}

	FixedUpdate(dt) {
		// Minimal collision event via sweep test against static world colliders.
		const cfg = this.onCollisionEvent;
		const isString = typeof cfg === "string" && cfg.length > 0;
		const hasActions = !!cfg && !isString;
		if (!isString && !hasActions) {
			// Still advance fallback position storage
			try { this._rbLastPos.copy(this.object.getWorldPosition(new Vector3())); } catch {}
			return;
		}
		const prev = this._rbLastPos || new Vector3();
		const cur = this.object?.getWorldPosition?.(new Vector3()) || null;
		if (!cur) return;
		const delta = cur.clone().sub(prev);
		const dist = delta.length();
		if (dist > 1e-4) {
			const dir = delta.clone().multiplyScalar(1 / dist);
			const margin = 0.01;
			const hit = this.game?.physics?.raycast ? this.game.physics.raycast(prev, dir, dist + margin) : null;
			if (hit) {
				const payload = {
					point: hit.point || null,
					normal: hit.face?.normal || null,
					distance: hit.distance,
					targetName: hit.object?.name || "",
					sourceObject: this.object,
				};
				if (isString) {
					try { this.game?.eventSystem?.emit(String(cfg), payload); } catch {}
				} else {
					try { executeActions({ game: this.game, object: this.object, component: this }, cfg, payload); } catch {}
				}
			}
		}
		this._rbLastPos.copy(cur);
	}

	// Helpers
	setVelocity(vec3) {
		if (this.body && this.game?.physics?.Ammo) {
			try {
				const Ammo = this.game.physics.Ammo;
				this.body.setLinearVelocity(new Ammo.btVector3(vec3.x, vec3.y, vec3.z));
				this.body.setAngularVelocity(new Ammo.btVector3(0, 0, 0));
				this.body.activate?.();
			} catch {}
		} else {
			this._fallbackVel.copy(vec3);
		}
	}

	zeroVelocity() {
		if (this.body && this.game?.physics?.Ammo) {
			try {
				const Ammo = this.game.physics.Ammo;
				this.body.setLinearVelocity(new Ammo.btVector3(0, 0, 0));
				this.body.setAngularVelocity(new Ammo.btVector3(0, 0, 0));
				this.body.activate?.();
			} catch {}
		}
		this._fallbackVel.set(0, 0, 0);
	}

	teleport(position, quaternion) {
		// Always move the visual
		try {
			if (position) this.object.position.copy(position);
			if (quaternion) this.object.quaternion.copy(quaternion);
		} catch {}
		// Also move the body if present
		if (this.body && this.game?.physics?.Ammo) {
			try {
				const Ammo = this.game.physics.Ammo;
				const tr = new Ammo.btTransform();
				tr.setIdentity();
				const p = position || this.object.position;
				tr.setOrigin(new Ammo.btVector3(p.x, p.y, p.z));
				const q = quaternion || this.object.quaternion;
				tr.setRotation(new Ammo.btQuaternion(q.x, q.y, q.z, q.w));
				this.body.setWorldTransform(tr);
				const ms = this.body.getMotionState?.();
				if (ms && ms.setWorldTransform) ms.setWorldTransform(tr);
				this.body.setAngularVelocity(new Ammo.btVector3(0, 0, 0));
				this.body.activate?.();
			} catch {}
		}
		// Reset last-pos tracker after teleport
		try { this._rbLastPos.copy(this.object.getWorldPosition(new Vector3())); } catch {}
	}
}

ComponentRegistry.register("Rigidbody", Rigidbody);
ComponentRegistry.register("rigidbody", Rigidbody);


