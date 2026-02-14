'use strict';
import { Vector3 } from "three";
import { Inventory } from "./inventory.js";
import { Statistic } from "./statistic.js";

// Lightweight action registry used by components to execute configured actions.
// Action: { type: string, params: object }
// Context: { game, object, component }

const ActionRegistry = (() => {
	const map = new Map();
	return {
		register(id, def) {
			if (!id || !def || typeof def.handler !== "function") return;
			map.set(String(id), { ...def, id: String(id) });
		},
		get(id) {
			return map.get(String(id));
		},
		list() {
			return Array.from(map.values());
		}
	};
})();

export function listActionsWithParams() {
	return ActionRegistry.list().map(a => ({
		id: a.id,
		label: a.label || a.id,
		params: Array.isArray(a.params) ? a.params.slice() : []
	}));
}

export async function executeAction(ctx, action, payload) {
	if (!action) return;
	if (Array.isArray(action)) {
		for (let i = 0; i < action.length; i++) {
			await executeAction(ctx, action[i], payload);
		}
		return;
	}
	const def = ActionRegistry.get(action.type || action.id);
	if (!def) return;
	try {
		await def.handler(ctx, action.params || {}, payload);
	} catch (e) {
		try { console.warn("Action execute failed:", action?.type, e); } catch {}
	}
}

export async function executeActions(ctx, actions, payload) {
	if (!actions) return;
	if (Array.isArray(actions)) {
		for (let i = 0; i < actions.length; i++) {
			await executeAction(ctx, actions[i], payload);
		}
	} else {
		await executeAction(ctx, actions, payload);
	}
}

// --------------------------
// Utilities
// --------------------------
function normalizeName(s) {
	return String(s || "").replace(/[\s\-_]/g, "").toLowerCase();
}

function resolveTargetObject(ctx, target) {
	const t = (target || "self").toString().toLowerCase();
	if (t === "self") {
		return ctx?.object || null;
	}
	if (t === "player") {
		const p = ctx?.game?.player;
		if (p?.object) return p.object;
		const comps = ctx?.component?.findComponents ? ctx.component.findComponents("Player") : [];
		if (Array.isArray(comps) && comps.length) return comps[0]?.object || null;
		try { return ctx?.game?.sceneProperties?.player?.[0] || null; } catch {}
	}
	// Named object via scene
	try {
		const scene = ctx?.game?.rendererCore?.scene;
		if (scene && t) {
			return scene.getObjectByName(target) || null;
		}
	} catch {}
	return null;
}

function findComponentOnObject(object, typeOrName) {
	const want = normalizeName(typeOrName);
	const list = object?.__components || [];
	for (let i = 0; i < list.length; i++) {
		const c = list[i];
		const n = normalizeName(c?.propName || c?.__typeName || c?.constructor?.name);
		if (n === want) return c;
	}
	return null;
}

function findStatisticOnObject(object, statName) {
	const list = object?.__components || [];
	const want = normalizeName(statName);
	for (let i = 0; i < list.length; i++) {
		const c = list[i];
		const isStat = (c instanceof Statistic) || normalizeName(c?.constructor?.name) === "statistic";
		if (!isStat) continue;
		const n = normalizeName(c?.options?.name || c?.propName || "stat");
		if (n === want) return c;
	}
	return null;
}

// --------------------------
// Built-in actions
// --------------------------
ActionRegistry.register("AddItem", {
	label: "Add Item",
	params: ["target", "item"],
	handler: async (ctx, params /*, payload */) => {
		const obj = resolveTargetObject(ctx, params.target || "player");
		if (!obj) return;
		const inv = findComponentOnObject(obj, "Inventory");
		if (!inv || !(inv instanceof Inventory)) return;
		const item = params.item || {};
		inv.addItem(item, null);
	}
});

ActionRegistry.register("ModifyStatistic", {
	label: "Modify Statistic",
	params: ["name", "op", "value", "duration", "easing", "keepRatio", "target"],
	handler: async (ctx, params /*, payload */) => {
		const targetObj = resolveTargetObject(ctx, params.target || "self");
		if (!targetObj) return;
		const name = params.name || "health";
		const stat = findStatisticOnObject(targetObj, name);
		if (!stat) return;
		const op = (params.op || "add").toString();
		const value = Number(params.value) || 0;
		switch (op) {
			case "add":
				stat.add(value);
				break;
			case "set":
				stat.setCurrent(value);
				break;
			case "setMax":
				stat.setMax(value, params.keepRatio === true);
				break;
			case "setMin":
				stat.setMin(value);
				break;
			case "addOverTime": {
				const duration = Math.max(0.0001, Number(params.duration) || 0);
				const easing = params.easing || stat.options?.easing || "linear";
				stat.applyDeltaOverTime(value, duration, easing);
				break;
			}
			default:
				break;
		}
	}
});

ActionRegistry.register("SendComponentMessage", {
	label: "Send Component Message",
	params: ["target", "component", "method", "args", "objectName"],
	handler: async (ctx, params, payload) => {
		const t = (params.target || "self").toString();
		const obj = t === "byName" ? resolveTargetObject(ctx, params.objectName || "") : resolveTargetObject(ctx, params.target || "self");
		if (!obj) return;
		const comp = findComponentOnObject(obj, params.component || "");
		if (!comp) return;
		const method = (params.method || "").toString();
		const args = Array.isArray(params.args) ? params.args : (params.args != null ? [params.args] : []);
		try {
			if (typeof comp[method] === "function") {
				comp[method](...args, payload);
			}
		} catch {}
	}
});

// ----------------------------------
// New actions for game systems
// ----------------------------------

ActionRegistry.register("AdvanceMatchState", {
	label: "Advance Match State",
	params: [],
	handler: async (ctx) => {
		const gm = ctx?.game?.gameMode;
		if (gm && typeof gm.advanceState === "function") {
			gm.advanceState();
		}
	}
});

ActionRegistry.register("SetAnimState", {
	label: "Set Animation State",
	params: ["target", "state"],
	handler: async (ctx, params) => {
		const obj = resolveTargetObject(ctx, params.target || "self");
		if (!obj) return;
		const ac = findComponentOnObject(obj, "AnimationController");
		if (ac && typeof ac.setState === 'function') {
			ac.setState(params.state || "idle");
		}
	}
});

ActionRegistry.register("NetworkAction", {
	label: "Send Network Action",
	params: ["action", "params"],
	handler: async (ctx, params) => {
		const net = ctx?.game?.network;
		if (net && typeof net.sendAction === 'function') {
			const actionParams = params.params || {};
			if (typeof actionParams === 'string') {
				try { net.sendAction(params.action, JSON.parse(actionParams)); } catch { net.sendAction(params.action, {}); }
			} else {
				net.sendAction(params.action, actionParams);
			}
		}
	}
});

ActionRegistry.register("RequestRespawn", {
	label: "Request Respawn",
	params: ["playerId"],
	handler: async (ctx, params) => {
		const gm = ctx?.game?.gameMode;
		if (gm && typeof gm.requestRespawn === "function") {
			gm.requestRespawn(params.playerId || 0);
		}
	}
});

ActionRegistry.register("SpawnFromPool", {
	label: "Spawn From Pool",
	params: ["archetype", "target", "overrides", "traits", "position", "objectName"],
	handler: async (ctx, params) => {
		const game = ctx?.game;
		const pool = game?.pool;
		const scene = game?.rendererCore?.scene;
		if (!pool || !scene) return;
		const archetype = (params.archetype || "").toString().trim();
		if (!archetype) return;
		const obj = resolveTargetObject(ctx, params.target || "self");
		const overrides = params.overrides && typeof params.overrides === "object" ? params.overrides : {};
		const traits = params.traits && typeof params.traits === "object" ? params.traits : {};
		const inst = pool.obtain(archetype, { overrides, traits });
		if (!inst) return;
		const pos = params.position;
		if (pos && (typeof pos.x === "number" || Array.isArray(pos))) {
			const v = Array.isArray(pos) ? pos : [pos.x, pos.y ?? 0, pos.z ?? 0];
			inst.position.set(Number(v[0]) || 0, Number(v[1]) || 0, Number(v[2]) || 0);
		} else if (obj?.getWorldPosition) {
			obj.getWorldPosition(inst.position);
		}
		scene.add(inst);
	}
});

ActionRegistry.register("FireProjectile", {
	label: "Fire Projectile",
	params: ["archetype", "direction", "speed", "target"],
	handler: async (ctx, params) => {
		const game = ctx?.game;
		const pool = game?.pool;
		const scene = game?.rendererCore?.scene;
		if (!pool || !scene) return;
		const archetype = (params.archetype || "Projectile").toString().trim() || "Projectile";
		const obj = resolveTargetObject(ctx, params.target || "self");
		if (!obj) return;
		const inst = pool.obtain(archetype, {});
		if (!inst) return;
		scene.add(inst);
		const dir = params.direction;
		let dx = 0, dy = 0, dz = 1;
		if (Array.isArray(dir)) {
			dx = Number(dir[0]) || 0; dy = Number(dir[1]) || 0; dz = Number(dir[2]) || 1;
		} else if (dir && typeof dir === "object") {
			dx = Number(dir.x) ?? 0; dy = Number(dir.y) ?? 0; dz = Number(dir.z) ?? 1;
		}
		const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
		dx /= len; dy /= len; dz /= len;
		const dirVec = new Vector3(dx, dy, dz);
		const pos = obj.getWorldPosition ? obj.getWorldPosition(new Vector3()) : new Vector3().copy(obj.position);
		const proj = findComponentOnObject(inst, "Projectile");
		if (proj && typeof proj.fire === "function") {
			proj.reset?.();
			proj.fire({
				position: pos instanceof Vector3 ? pos : new Vector3(pos?.x || 0, pos?.y || 0, pos?.z || 0),
				direction: dirVec,
				speed: Number(params.speed) || proj.speed,
				shooter: obj,
			});
		}
	}
});

ActionRegistry.register("EmitParticles", {
	label: "Emit Particles",
	params: ["count", "scale", "target", "position"],
	handler: async (ctx, params) => {
		const game = ctx?.game;
		const ps = game?.particleSystem;
		if (!ps || typeof ps.spawn !== "function") return;
		const obj = resolveTargetObject(ctx, params.target || "self");
		const count = Math.max(1, Math.floor(Number(params.count) || 1));
		const scale = Math.max(0.01, Number(params.scale) || 1);
		let pos = params.position;
		let v;
		if (!pos && obj?.getWorldPosition) {
			v = obj.getWorldPosition(new Vector3());
		} else if (Array.isArray(pos)) {
			v = new Vector3(Number(pos[0]) || 0, Number(pos[1]) ?? 0, Number(pos[2]) ?? 0);
		} else if (pos && typeof pos === "object") {
			v = new Vector3(Number(pos.x) ?? 0, Number(pos.y) ?? 0, Number(pos.z) ?? 0);
		} else {
			return;
		}
		for (let i = 0; i < count; i++) {
			ps.spawn(v, scale);
		}
	}
});

ActionRegistry.register("SetVisible", {
	label: "Set Visible",
	params: ["target", "visible", "objectName"],
	handler: async (ctx, params) => {
		const t = (params.target || "self").toString();
		const obj = t === "byName" ? resolveTargetObject(ctx, params.objectName || "") : resolveTargetObject(ctx, params.target || "self");
		if (!obj) return;
		const v = params.visible;
		obj.visible = v === true || v === "true" || v === 1 || v === "1";
	}
});

ActionRegistry.register("EmitEvent", {
	label: "Emit Event",
	params: ["event", "payload"],
	handler: async (ctx, params) => {
		const ev = (params.event || "").toString();
		if (!ev) return;
		const payload = params.payload && typeof params.payload === "object" ? params.payload : {};
		ctx?.game?.eventSystem?.emit?.(ev, payload);
	}
});

ActionRegistry.register("SequencerControl", {
	label: "Sequencer Control",
	params: ["target", "sequencerName", "action", "objectName", "time"],
	handler: async (ctx, params) => {
		const t = (params.target || "self").toString();
		let seq = null;
		const want = (params.sequencerName || "").toString().replace(/\s+/g, "").toLowerCase();
		const obj = t === "byName" ? resolveTargetObject(ctx, params.objectName || "") : resolveTargetObject(ctx, params.target || "self");
		if (obj?.__components) {
			for (const c of obj.__components) {
				if ((c?.constructor?.name || "").toString().toLowerCase() === "sequencer") {
					const n = (c.options?.name || "").toString().replace(/\s+/g, "").toLowerCase();
					if (n === want || !want) { seq = c; break; }
				}
			}
		}
		if (!seq && want) seq = ctx?.game?.sequencers?.get(want) || null;
		if (!seq) return;
		const action = (params.action || "").toString().toLowerCase();
		switch (action) {
			case "play":   seq.play();   break;
			case "pause":  seq.pause();  break;
			case "resume": seq.resume(); break;
			case "stop":   seq.stop();   break;
			case "reset":  seq.reset();  break;
			case "seek":   seq.seek(Number(params.time) || 0); break;
			default: break;
		}
	}
});

ActionRegistry.register("TimerControl", {
	label: "Timer Control",
	params: ["target", "timerName", "action"],
	handler: async (ctx, params) => {
		const obj = resolveTargetObject(ctx, params.target || "self");
		let timer = null;
		const want = (params.timerName || "").toString().replace(/\s+/g, "").toLowerCase();
		if (obj?.__components) {
			for (const c of obj.__components) {
				if (c?.constructor?.name === "Timer") {
					const n = (c.options?.name || "").toString().replace(/\s+/g, "").toLowerCase();
					if (n === want) { timer = c; break; }
				}
			}
		}
		if (!timer && ctx?.game?.timers) timer = ctx.game.timers.get(want);
		if (!timer) return;
		const action = (params.action || '').toString().toLowerCase();
		switch (action) {
			case 'start':  timer.start();  break;
			case 'stop':   timer.stop();   break;
			case 'pause':  timer.pause();  break;
			case 'resume': timer.resume(); break;
			case 'reset':  timer.reset();  break;
			default: break;
		}
	}
});

export { ActionRegistry };


