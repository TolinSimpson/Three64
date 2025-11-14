'use strict';
import { ComponentRegistry } from "./component.js";

// Pool management component (singleton)
// Responsibilities:
// - Configure per-archetype pool limits and overflow policy
// - Prewarm pools from explicit options.items
// - Optionally scan the loaded scene for GLTF-authored pool hints (pool.size, pool.prewarm) and prewarm
export class Pool {
	constructor(ctx) {
		this.game = ctx?.game;
		this.object = ctx?.object || null;
		this.options = ctx?.options || {};
		this.propName = ctx?.propName || "Pool";
		// options schema:
		// {
		//   items: [
		//     { archetype: "Projectile", size: 32, prewarm: true, max: 64, overflow: "create"|"drop"|"reuseOldest" }
		//   ],
		//   autoScan: true // scan scene for pool.* hints
		// }
	}

	static getDefaultParams() {
		return {
			items: [],
			autoScan: true
		};
	}

	// Ensure only one Pool component is active; merge configuration if multiple are authored
	Initialize() {
		if (!this.game) return;
		if (this.game.__poolComponent && this.game.__poolComponent !== this) {
			// Merge items into the existing singleton and ignore this instance afterwards
			try {
				const items = Array.isArray(this.options?.items) ? this.options.items : [];
				if (items.length) this.game.__poolComponent._applyItems(items);
				if (this.options?.autoScan === true) this.game.__poolComponent.scanAndPrewarm();
			} catch {}
			return;
		}
		this.game.__poolComponent = this;
		this._applyItems(Array.isArray(this.options?.items) ? this.options.items : []);
		if (this.options?.autoScan !== false) {
			this.scanAndPrewarm();
		}
	}

	_applyItems(items) {
		if (!this.game?.pool) return;
		for (let i = 0; i < items.length; i++) {
			const it = items[i] || {};
			const name = String(it.archetype || it.name || "").trim();
			if (!name) continue;
			const max = (typeof it.max === "number") ? it.max : (typeof it.size === "number" ? it.size : undefined);
			const overflow = (typeof it.overflow === "string") ? it.overflow : undefined;
			if (max != null || overflow) {
				try { this.game.pool.setPolicy(name, { max, overflow }); } catch {}
			}
			if ((it.prewarm !== false) && (typeof it.size === "number") && it.size > 0) {
				try { this.game.pool.prewarm(name, it.size, { overrides: it.overrides || {}, traits: it.traits || {} }); } catch {}
			}
		}
	}

	// Aggregate GLTF-authored hints and prewarm pools accordingly:
	// - userData.archetype: "Projectile"
	// - userData["pool.size"]: number
	// - userData["pool.prewarm"]: true
	scanAndPrewarm() {
		if (!this.game?.rendererCore?.scene || !this.game?.pool) return;
		const scene = this.game.rendererCore.scene;
		const counts = new Map(); // archetype -> { size, overrides, traits }
		try {
			scene.updateWorldMatrix(true, true);
		} catch {}
		scene.traverse((o) => {
			const ud = o?.userData || {};
			const archetype = ud.archetype || ud.Archetype || null;
			if (!archetype) return;
			const prewarm = ud["pool.prewarm"] === true || ud["pool.prewarm"] === "true";
			if (!prewarm) return;
			let size = parseInt(ud["pool.size"], 10);
			if (!Number.isFinite(size) || size <= 0) return;
			const key = String(archetype);
			const existing = counts.get(key) || { size: 0, overrides: {}, traits: {} };
			existing.size = Math.max(existing.size, size);
			counts.set(key, existing);
		});
		for (const [name, info] of counts.entries()) {
			try { this.game.pool.prewarm(name, info.size, { overrides: info.overrides, traits: info.traits }); } catch {}
		}
	}
}

ComponentRegistry.register("Pool", Pool);
ComponentRegistry.register("pool", Pool);

// Helper to ensure the singleton exists (used by engine after scene load)
export function ensurePoolSingleton(game) {
	if (!game) return null;
	if (game.__poolComponent) return game.__poolComponent;
	const inst = new Pool({ game, object: null, options: Pool.getDefaultParams(), propName: "Pool" });
	try {
		inst.Initialize?.();
		game.componentInstances.push(inst);
	} catch {}
	return inst;
}


