'use strict';
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
		// Prefer the first Player component's object
		const comps = ctx?.component?.findComponents ? ctx.component.findComponents("Player") : (ctx?.game?.componentInstances || []);
		if (Array.isArray(comps) && comps.length) {
			const c = comps[0];
			return c?.object || null;
		}
		// Fallback: try scene property if defined by engine
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
		// Find GameMode component in the scene
		const comps = ctx?.game?.componentInstances || [];
		for (const c of comps) {
			if (c?.constructor?.name === 'GameMode' && typeof c.advanceState === 'function') {
				c.advanceState();
				return;
			}
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
		const comps = ctx?.game?.componentInstances || [];
		for (const c of comps) {
			if (c?.constructor?.name === 'GameMode' && typeof c.requestRespawn === 'function') {
				c.requestRespawn(params.playerId || 0);
				return;
			}
		}
	}
});

ActionRegistry.register("TimerControl", {
	label: "Timer Control",
	params: ["target", "timerName", "action"],
	handler: async (ctx, params) => {
		const obj = resolveTargetObject(ctx, params.target || "self");
		// Find timer on the target object, or search scene
		let timer = null;
		if (obj) {
			const comps = obj.__components || [];
			for (const c of comps) {
				if (c?.constructor?.name === 'Timer') {
					const n = (c.options?.name || '').toString().replace(/\s+/g, '').toLowerCase();
					const want = (params.timerName || '').toString().replace(/\s+/g, '').toLowerCase();
					if (n === want) { timer = c; break; }
				}
			}
		}
		// Fallback: search all components
		if (!timer) {
			const allComps = ctx?.game?.componentInstances || [];
			const want = (params.timerName || '').toString().replace(/\s+/g, '').toLowerCase();
			for (const c of allComps) {
				if (c?.constructor?.name === 'Timer') {
					const n = (c.options?.name || '').toString().replace(/\s+/g, '').toLowerCase();
					if (n === want) { timer = c; break; }
				}
			}
		}
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


