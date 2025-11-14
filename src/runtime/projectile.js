'use strict';
import { Object3D, Mesh, MeshBasicMaterial, SphereGeometry, Vector3, Quaternion } from "three";
import { Component, ComponentRegistry, ArchetypeRegistry } from "./component.js";

export class Projectile extends Component {
	constructor(ctx) {
		super(ctx);
		const o = (ctx && ctx.options) || {};
		this.speed = typeof o.speed === "number" ? o.speed : 12;
		this.damage = typeof o.damage === "number" ? o.damage : 10;
		this.radius = typeof o.radius === "number" ? o.radius : 0.1;
		this.lifeSeconds = typeof o.lifeSeconds === "number" ? o.lifeSeconds : 4.0;
		this.gravity = o.gravity === true; // if true, let physics handle gravity
		this.shape = o.shape || "sphere"; // physics shape
		this.mass = typeof o.mass === "number" ? o.mass : 0.2;
		this._body = null;
		this._active = false;
		this._ttl = 0;
		this._lastPos = new Vector3();
		this._dir = new Vector3(0, 0, 1);
		this._vel = new Vector3(0, 0, 0);
		this._shooter = null; // optional to avoid self-hit
	}

	static getDefaultParams() {
		return {
			speed: 12,
			damage: 10,
			radius: 0.1,
			lifeSeconds: 4,
			gravity: false,
			shape: "sphere",
			mass: 0.2,
		};
	}

	Initialize() {
		// Ensure there is a small visible sphere if no mesh exists
		if (!this.object || !this.object.isObject3D) {
			this.object = new Object3D();
		}
		if (!this.object.isMesh) {
			try {
				const geo = new SphereGeometry(Math.max(0.01, this.radius), 8, 6);
				const mat = new MeshBasicMaterial({ color: 0xff5533 });
				const mesh = new Mesh(geo, mat);
				this.object.add(mesh);
			} catch {}
		}
		// Create dynamic rigid body if physics available
		const phys = this.game?.physics || null;
		if (phys?.addRigidBodyForObject) {
			this._body = phys.addRigidBodyForObject(this.object, {
				shape: this.shape || "sphere",
				type: "dynamic",
				mass: this.mass,
				radius: this.radius,
				linearDamping: 0.01,
				angularDamping: 0.01,
			});
			this._zeroVelocity();
		}
		this._ttl = 0;
		this._active = false;
	}

	Dispose() {
		this._active = false;
	}

	// Fire the projectile from position toward direction at speed
	fire({ position, direction, speed, shooter = null }) {
		const dir = (direction && direction.clone ? direction.clone() : new Vector3(direction?.x || 0, direction?.y || 0, direction?.z || 0)).normalize();
		const pos = position && position.clone ? position.clone() : new Vector3(position?.x || 0, position?.y || 0, position?.z || 0);
		this._dir.copy(dir);
		this._shooter = shooter || null;
		this._ttl = Math.max(0, Number(this.options?.lifeSeconds ?? this.lifeSeconds) || this.lifeSeconds);
		this._active = true;
		// Place object and set velocity
		try { this.object.position.copy(pos); } catch {}
		try {
			const q = new Quaternion();
			q.setFromUnitVectors(new Vector3(0, 0, 1), dir);
			this.object.quaternion.copy(q);
		} catch {}
		// Teleport physics body to fire position/orientation (so it doesn't lag or stick to its old place)
		if (this._body && this.game?.physics?.Ammo) {
			try {
				const Ammo = this.game.physics.Ammo;
				const tr = new Ammo.btTransform();
				tr.setIdentity();
				tr.setOrigin(new Ammo.btVector3(pos.x, pos.y, pos.z));
				const q = this.object.quaternion;
				tr.setRotation(new Ammo.btQuaternion(q.x, q.y, q.z, q.w));
				this._body.setWorldTransform(tr);
				const ms = this._body.getMotionState?.();
				if (ms && ms.setWorldTransform) ms.setWorldTransform(tr);
				this._body.setAngularVelocity(new Ammo.btVector3(0, 0, 0));
				this._body.activate?.();
			} catch {}
		}
		this.object.visible = true;
		this._lastPos.copy(this.object.position);
		const v = typeof speed === "number" ? speed : this.speed;
		const initialVel = dir.clone().multiplyScalar(v);
		this._vel.copy(initialVel);
		this._setVelocity(initialVel);
	}

	reset() {
		this._active = false;
		this._ttl = 0;
		this._shooter = null;
		this._vel.set(0, 0, 0);
		this._zeroVelocity();
		this.object.visible = false;
	}

	FixedUpdate(dt, app) {
		if (!this._active) return;
		// Lifetime
		this._ttl -= dt;
		if (this._ttl <= 0) { this._despawn(); return; }
		// Track previous position for ray sweep
		const prev = this._lastPos;
		// Manual integration path when physics is unavailable
		const hasAmmo = !!(this.game?.physics?.Ammo);
		if (!hasAmmo) {
			try {
				// Integrate position using stored velocity
				this.object.position.addScaledVector(this._vel, dt);
			} catch {}
		}
		const cur = this.object.position.clone();
		// Raycast against static world to stop on impact
		const phys = this.game?.physics || null;
		if (phys?.raycast) {
			const delta = cur.clone().sub(prev);
			const dist = delta.length();
			if (dist > 1e-4) {
				const dir = delta.clone().multiplyScalar(1 / dist);
				const hit = phys.raycast(prev, dir, dist + this.radius * 1.1);
				if (hit && hit.distance <= dist + this.radius * 1.1) {
					this._impact(hit.object);
					this._despawn();
					return;
				}
			}
		}
		// Player proximity damage (player is not a collider)
		const player = this.game?.player || null;
		const rig = player?.rig || this.game?.rendererCore?.camera?.parent || null;
		if (rig) {
			const dx = rig.position.x - cur.x;
			const dy = (rig.position.y + (player?.controller?.eyeHeight || 1.6) * 0.5) - cur.y;
			const dz = rig.position.z - cur.z;
			const d2 = dx * dx + dy * dy + dz * dz;
			const hitR = Math.max(0.2, this.radius + 0.35);
			if (d2 <= hitR * hitR) {
				this._damageStatistic("health", this.damage);
				this._despawn();
				return;
			}
		}
		this._lastPos.copy(cur);
	}

	_damageStatistic(name, amount) {
		const comps = this.game?.componentInstances || [];
		for (let i = 0; i < comps.length; i++) {
			const c = comps[i];
			if (!c) continue;
			const n = (c.options?.name || c.propName || c.constructor?.name || "").toString().toLowerCase();
			if (n !== "statistic" && n !== name && (c._getName?.() !== name)) continue;
			// Prefer Statistic components named 'health'
			if (typeof c.add === "function" && (c._getName?.() === name || c.options?.name === name)) {
				c.add(-Math.abs(amount || 0));
				return true;
			}
		}
		return false;
	}

	_impact(/* hitObject */) {
		// Future: spawn VFX, decals, etc.
	}

	_setVelocity(vec3) {
		if (this._body && this.game?.physics?.Ammo) {
			try {
				const Ammo = this.game.physics.Ammo;
				this._body.setLinearVelocity(new Ammo.btVector3(vec3.x, vec3.y, vec3.z));
				this._body.setAngularVelocity(new Ammo.btVector3(0, 0, 0));
				this._body.activate?.();
			} catch {}
		} else {
			// Fallback: store velocity for manual integration
			this._vel.copy(vec3);
		}
	}

	_zeroVelocity() {
		if (this._body && this.game?.physics?.Ammo) {
			try {
				const Ammo = this.game.physics.Ammo;
				this._body.setLinearVelocity(new Ammo.btVector3(0, 0, 0));
				this._body.setAngularVelocity(new Ammo.btVector3(0, 0, 0));
				this._body.activate?.();
			} catch {}
		}
	}

	_despawn() {
		this.reset();
		// Return to pool if pooled
		if (this.object?.userData?.__pooled && this.game?.pool) {
			try { this.game.pool.release(this.object); } catch {}
		} else {
			try {
				if (this.object?.parent) this.object.parent.remove(this.object);
			} catch {}
		}
	}
}

ComponentRegistry.register("Projectile", Projectile);
ComponentRegistry.register("projectile", Projectile);

// Register a simple pooled archetype for projectiles
ArchetypeRegistry.register("Projectile", {
	defaults: Projectile.getDefaultParams(),
	create(game, params) {
		const obj = new Object3D();
		obj.name = "Projectile";
		// Visual sphere
		try {
			const geo = new SphereGeometry(Math.max(0.01, params?.radius || 0.1), 8, 6);
			const mat = new MeshBasicMaterial({ color: 0xff5533 });
			const mesh = new Mesh(geo, mat);
			obj.add(mesh);
		} catch {}
		// Bind component
		const comp = new Projectile({ game, object: obj, options: params || {}, propName: "Projectile" });
		obj.__components = obj.__components || [];
		obj.__components.push(comp);
		game.componentInstances.push(comp);
		comp.Initialize?.();
		return obj;
	}
});


