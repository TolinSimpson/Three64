'use strict';
import { Vector3, Raycaster, Box3, BufferGeometry, Float32BufferAttribute, Points, PointsMaterial } from "three";
import { Component, ComponentRegistry } from "./component.js";
import { loadJSON } from "./io.js";

// Pending links registered before a NavMesh is available/loaded
const __pendingNavLinks = [];

// Simple navigation mesh component with A* over triangle graph and optional funnel smoothing.
// Prefer building from a GLTF mesh node that has this component on it. Falls back to JSON if url provided.
export class NavMesh extends Component {
	constructor(ctx) {
		super(ctx);
		this._grid = null; // { originX, originZ, nx, nz, cellSize, layersPerCell, cells: Array<{ y:number, cost:number }|null> }
		this._cfg = null;
		this._links = []; // [{ aIdx, bIdx, bidirectional, cost }]
		this._loaded = false;
			this._debugObject = null;
	}

	static getDefaultParams() {
		return {
			cellSize: 0.5,
			maxGridSize: 512,
			maxSlopeDeg: 45,
			stepHeight: 0.4,
			agentRadius: 0.3,
			padding: 0.5,
			raycastHeight: 50,
			smooth: true,
		};
	}

	static getParamDescriptions() {
		return [
			{ key: "cellSize", label: "Cell Size (m)", type: "number", min: 0.1, max: 2, step: 0.05, description: "Grid cell resolution." },
			{ key: "maxSlopeDeg", label: "Max Slope (deg)", type: "number", min: 0, max: 89.9, step: 0.1, description: "Maximum walkable surface slope." },
			{ key: "stepHeight", label: "Step Height (m)", type: "number", min: 0, max: 1, step: 0.01, description: "Max vertical delta between neighbors." },
			{ key: "agentRadius", label: "Agent Radius (m)", type: "number", min: 0.05, max: 1.0, step: 0.01, description: "Clearance radius (reserved for future use)." },
			{ key: "smooth", label: "Smooth Path", type: "boolean", description: "Merge linear waypoint sequences." },
		];
	}

	async Initialize() {
		try {
			const opts = this.options || {};
			this._cfg = {
				cellSize: Number(opts.cellSize ?? NavMesh.getDefaultParams().cellSize) || 0.5,
				maxGridSize: Number(opts.maxGridSize ?? NavMesh.getDefaultParams().maxGridSize) || 512,
				maxSlopeDeg: Number(opts.maxSlopeDeg ?? NavMesh.getDefaultParams().maxSlopeDeg) || 45,
				stepHeight: Number(opts.stepHeight ?? NavMesh.getDefaultParams().stepHeight) || 0.4,
				agentRadius: Number(opts.agentRadius ?? NavMesh.getDefaultParams().agentRadius) || 0.3,
				padding: Number(opts.padding ?? NavMesh.getDefaultParams().padding) || 0.5,
				raycastHeight: Number(opts.raycastHeight ?? NavMesh.getDefaultParams().raycastHeight) || 50,
				smooth: opts.smooth !== false,
			};
			this._buildFromSceneNavigables();
			if (this.game) this.game.navMesh = this;
			if (this._loaded) this._applyPendingLinks();
		} catch (e) {
			console.warn("NavMesh.Initialize: failed", e);
			this._loaded = false;
		}
	}

	_buildFromSceneNavigables() {
		try {
			const scene = this.game?.rendererCore?.scene;
			if (!scene) { this._loaded = false; return; }
			const navigableMeshes = [];
			const tmpBox = new Box3();
			const bounds = new Box3();
			scene.updateWorldMatrix(true, true);
			scene.traverse((o) => {
				if (!o || !o.isMesh || !o.geometry) return;
				const ud = o.userData || {};
				if (!ud.navigable && !ud.Navigable && ud["navigable"] !== true) return;
				navigableMeshes.push(o);
				try { tmpBox.setFromObject(o); bounds.union(tmpBox); } catch {}
			});
			if (navigableMeshes.length === 0) {
				console.warn("NavMesh: no navigable meshes found (userData.navigable)");
				this._loaded = false;
				return;
			}
			bounds.min.x -= this._cfg.padding; bounds.min.z -= this._cfg.padding;
			bounds.max.x += this._cfg.padding; bounds.max.z += this._cfg.padding;
			const width = Math.max(0.001, bounds.max.x - bounds.min.x);
			const depth = Math.max(0.001, bounds.max.z - bounds.min.z);
			const nx = Math.min(this._cfg.maxGridSize, Math.max(1, Math.ceil(width / this._cfg.cellSize)));
			const nz = Math.min(this._cfg.maxGridSize, Math.max(1, Math.ceil(depth / this._cfg.cellSize)));
			const originX = bounds.min.x;
			const originZ = bounds.min.z;

			const ray = new Raycaster();
			ray.firstHitOnly = true;
			const upY = Math.max(bounds.max.y + this._cfg.raycastHeight, bounds.max.y + 10);
			const down = new Vector3(0, -1, 0);
			const maxFar = (bounds.max.y - bounds.min.y) + this._cfg.raycastHeight * 2;
			const cosSlope = Math.cos((this._cfg.maxSlopeDeg || 45) * Math.PI / 180);

			const cells = new Array(nx * nz).fill(null);
			const idx = (xi, zi) => (zi * nx + xi);

			for (let zi = 0; zi < nz; zi++) {
				const z = originZ + (zi + 0.5) * this._cfg.cellSize;
				for (let xi = 0; xi < nx; xi++) {
					const x = originX + (xi + 0.5) * this._cfg.cellSize;
					ray.set(new Vector3(x, upY, z), down);
					ray.far = maxFar;
					const hits = ray.intersectObjects(navigableMeshes, false);
					if (!hits || hits.length === 0) continue;
					let chosen = null;
					for (let h = 0; h < hits.length; h++) {
						const hit = hits[h];
						const n = hit.face?.normal || null;
						if (!n) { chosen = hit; break; }
						const dotUp = Math.abs(n.y);
						if (dotUp >= cosSlope) { chosen = hit; break; }
					}
					if (!chosen) continue;
					const y = chosen.point.y;
					let costMul = 1.0;
					try {
						const ud = chosen.object?.userData || {};
						const c = ud.navigableCost ?? ud.navCost ?? ud.cost;
						if (typeof c === "number" && c > 0) costMul = c;
					} catch {}
					cells[idx(xi, zi)] = { y, cost: costMul };
				}
			}

			this._grid = { originX, originZ, nx, nz, cellSize: this._cfg.cellSize, layersPerCell: 1, cells };
			this._loaded = true;
		} catch (e) {
			console.warn("NavMesh._buildFromSceneNavigables failed", e);
			this._loaded = false;
		}
	}

	setDebugVisible(on) {
		try {
			const scene = this.game?.rendererCore?.scene;
			if (!scene) return;
			if (!on) {
				if (this._debugObject) {
					try { scene.remove(this._debugObject); } catch {}
					try { this._debugObject.geometry?.dispose?.(); } catch {}
					try { this._debugObject.material?.dispose?.(); } catch {}
					this._debugObject = null;
				}
				return;
			}
			if (this._debugObject) {
				this._debugObject.visible = true;
				return;
			}
			const g = this._grid;
			if (!this._loaded || !g) return;
			const positions = [];
			for (let zi = 0; zi < g.nz; zi++) {
				for (let xi = 0; xi < g.nx; xi++) {
					const i = zi * g.nx + xi;
					const c = g.cells[i];
					if (!c) continue;
					const w = this._worldForIndex(i);
					positions.push(w.x, c.y + 0.02, w.z);
				}
			}
			if (positions.length === 0) return;
			const geom = new BufferGeometry();
			geom.setAttribute('position', new Float32BufferAttribute(positions, 3));
			const mat = new PointsMaterial({
				color: 0x00ff88,
				size: Math.max(0.02, g.cellSize * 0.12),
				sizeAttenuation: true,
				transparent: true,
				opacity: 0.95,
				depthWrite: false
			});
			const pts = new Points(geom, mat);
			pts.name = 'NavMeshDebugPoints';
			scene.add(pts);
			this._debugObject = pts;
		} catch {}
	}

	_cellIndexForXZ(x, z) {
		const g = this._grid;
		if (!g) return -1;
		const xi = Math.floor((x - g.originX) / g.cellSize);
		const zi = Math.floor((z - g.originZ) / g.cellSize);
		if (xi < 0 || zi < 0 || xi >= g.nx || zi >= g.nz) return -1;
		return (zi * g.nx + xi);
	}

	_worldForIndex(i) {
		const g = this._grid;
		const xi = i % g.nx;
		const zi = (i / g.nx) | 0;
		const x = g.originX + (xi + 0.5) * g.cellSize;
		const z = g.originZ + (zi + 0.5) * g.cellSize;
		return { x, z };
	}

	_findClosestNodeForPosition(p) {
		const g = this._grid;
		if (!g) return -1;
		const center = this._cellIndexForXZ(p.x, p.z);
		if (center >= 0 && g.cells[center]) return center;
		const maxRing = 3;
		for (let ring = 1; ring <= maxRing; ring++) {
			for (let dz = -ring; dz <= ring; dz++) {
				for (let dx = -ring; dx <= ring; dx++) {
					if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
					const xi = (center % g.nx) + dx;
					const zi = ((center / g.nx) | 0) + dz;
					if (xi < 0 || zi < 0 || xi >= g.nx || zi >= g.nz) continue;
					const i = zi * g.nx + xi;
					if (g.cells[i]) return i;
				}
			}
		}
		return -1;
	}

	_neighbors(i) {
		const g = this._grid;
		if (!g) return [];
		const xi = i % g.nx;
		const zi = (i / g.nx) | 0;
		const out = [];
		for (let dz = -1; dz <= 1; dz++) {
			for (let dx = -1; dx <= 1; dx++) {
				if (dx === 0 && dz === 0) continue;
				const nx = xi + dx, nz = zi + dz;
				if (nx < 0 || nz < 0 || nx >= g.nx || nz >= g.nz) continue;
				const j = nz * g.nx + nx;
				const a = g.cells[i], b = g.cells[j];
				if (!a || !b) continue;
				if (Math.abs(a.y - b.y) > this._cfg.stepHeight) continue;
				const dist = Math.hypot(dx, dz) * g.cellSize;
				const cost = dist * 0.5 * ((a.cost || 1) + (b.cost || 1));
				out.push({ j, cost });
			}
		}
		for (let k = 0; k < this._links.length; k++) {
			const L = this._links[k];
			if (L.aIdx === i) out.push({ j: L.bIdx, cost: L.cost || g.cellSize });
			if (L.bidirectional !== false && L.bIdx === i) out.push({ j: L.aIdx, cost: L.cost || g.cellSize });
		}
		return out;
	}

	heuristic(i, goal) {
		const a = this._worldForIndex(i);
		const b = this._worldForIndex(goal);
		return Math.hypot(a.x - b.x, a.z - b.z);
	}

	findPath(start, end, opts) {
		if (!this._loaded || !this._grid) return [];
		const startV = start instanceof Vector3 ? start : new Vector3(start?.x || 0, start?.y || 0, start?.z || 0);
		const endV = end instanceof Vector3 ? end : new Vector3(end?.x || 0, end?.y || 0, end?.z || 0);
		const startIdx = this._findClosestNodeForPosition(startV);
		const endIdx = this._findClosestNodeForPosition(endV);
		if (startIdx < 0 || endIdx < 0) return [];
		const g = this._grid;

		const open = new MinQueue();
		const cameFrom = new Map();
		const gScore = new Map();
		const fScore = new Map();
		gScore.set(startIdx, 0);
		fScore.set(startIdx, this.heuristic(startIdx, endIdx));
		open.push(startIdx, fScore.get(startIdx));
		const closed = new Set();

		while (!open.isEmpty()) {
			const current = open.pop();
			if (current === endIdx) {
				const pathIdx = [current];
				let cur = current;
				while (cameFrom.has(cur)) {
					cur = cameFrom.get(cur);
					pathIdx.push(cur);
				}
				pathIdx.reverse();
				const pts = [];
				for (let k = 0; k < pathIdx.length; k++) {
					const i = pathIdx[k];
					const c = g.cells[i];
					if (!c) continue;
					const w = this._worldForIndex(i);
					pts.push(new Vector3(w.x, c.y, w.z));
				}
				return (opts?.smooth ?? this._cfg.smooth) ? this._smoothPath(pts) : pts;
			}
			closed.add(current);
			const neighbors = this._neighbors(current);
			for (const nb of neighbors) {
				const j = nb.j;
				if (closed.has(j)) continue;
				const tentative = (gScore.get(current) || Infinity) + nb.cost;
				if (tentative < (gScore.get(j) || Infinity)) {
					cameFrom.set(j, current);
					gScore.set(j, tentative);
					const f = tentative + this.heuristic(j, endIdx);
					fScore.set(j, f);
					open.push(j, f);
				}
			}
		}
		return [];
	}

	_smoothPath(points) {
		if (!Array.isArray(points) || points.length <= 2) return points || [];
		const out = [points[0].clone()];
		for (let i = 1; i + 1 < points.length; i++) {
			const prev = out[out.length - 1];
			const cur = points[i];
			const next = points[i + 1];
			const v1x = cur.x - prev.x, v1z = cur.z - prev.z;
			const v2x = next.x - cur.x, v2z = next.z - cur.z;
			const dot = v1x * v2x + v1z * v2z;
			const l1 = Math.hypot(v1x, v1z), l2 = Math.hypot(v2x, v2z);
			if (l1 > 1e-4 && l2 > 1e-4) {
				const cos = dot / (l1 * l2);
				if (cos > 0.996) continue;
			}
			out.push(cur.clone());
		}
		out.push(points[points.length - 1].clone());
		return out;
	}

	_registerLinkByWorldPositions(aVec3, bVec3, bidirectional = true, cost = 1.0) {
		if (!this._loaded || !this._grid) return;
		const aIdx = this._findClosestNodeForPosition(aVec3);
		const bIdx = this._findClosestNodeForPosition(bVec3);
		if (aIdx < 0 || bIdx < 0) return;
		this._links.push({ aIdx, bIdx, bidirectional: bidirectional !== false, cost: typeof cost === "number" ? cost : 1.0 });
	}

	_applyPendingLinks() {
		for (let i = 0; i < __pendingNavLinks.length; i++) {
			const p = __pendingNavLinks[i];
			try {
				this._registerLinkByWorldPositions(p.a, p.b, p.bidirectional, p.cost);
			} catch {}
		}
		__pendingNavLinks.length = 0;
	}

  // (dead triangle-based code removed – heightfield A* at lines above is the active implementation)
}

// Helpers (triangle math removed for heightfield approach)

/** Binary min-heap priority queue – O(log n) push/pop. */
class MinQueue {
  constructor() { this._h = []; }
  push(item, priority) {
    const h = this._h;
    h.push({ item, priority });
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (h[p].priority <= h[i].priority) break;
      const tmp = h[i]; h[i] = h[p]; h[p] = tmp;
      i = p;
    }
  }
  pop() {
    const h = this._h;
    if (h.length === 0) return undefined;
    const top = h[0].item;
    const last = h.pop();
    if (h.length > 0) {
      h[0] = last;
      let i = 0;
      const n = h.length;
      while (true) {
        let smallest = i;
        const l = 2 * i + 1, r = 2 * i + 2;
        if (l < n && h[l].priority < h[smallest].priority) smallest = l;
        if (r < n && h[r].priority < h[smallest].priority) smallest = r;
        if (smallest === i) break;
        const tmp = h[i]; h[i] = h[smallest]; h[smallest] = tmp;
        i = smallest;
      }
    }
    return top;
  }
  isEmpty() { return this._h.length === 0; }
}

ComponentRegistry.register("NavMesh", NavMesh);
ComponentRegistry.register("navmesh", NavMesh);

// -----------------------------
// NavLink component
// -----------------------------
export class NavLink extends Component {
	static getDefaultParams() {
		return {
			targetName: "",
			bidirectional: true,
			cost: 1.0,
		};
	}
	static getParamDescriptions() {
		return [
			{ key: "targetName", label: "Target Object Name", type: "string", description: "Name of the target object to link to." },
			{ key: "bidirectional", label: "Bidirectional", type: "boolean", description: "If true, link works both ways." },
			{ key: "cost", label: "Cost Multiplier", type: "number", min: 0.01, max: 10, step: 0.01, description: "Traversal cost multiplier for this link." },
		];
	}
	Initialize() {
		try {
			const a = new Vector3();
			this.object?.updateWorldMatrix?.(true, false);
			this.object?.getWorldPosition?.(a);
			const targetName = (this.options && this.options.targetName) || "";
			let targetObj = null;
			if (targetName && this.game?.rendererCore?.scene) {
				try { targetObj = this.game.rendererCore.scene.getObjectByName(targetName) || null; } catch {}
			}
			const b = new Vector3();
			if (targetObj && targetObj.getWorldPosition) targetObj.getWorldPosition(b); else b.copy(a);
			const linkData = {
				a,
				b,
				bidirectional: this.options?.bidirectional !== false,
				cost: typeof this.options?.cost === "number" ? this.options.cost : 1.0,
			};
			// If NavMesh is available and loaded, register immediately; otherwise defer
			const nav = (this.findComponent && this.findComponent('NavMesh')) || this.game?.navMesh || null;
			if (nav && nav._loaded && typeof nav._registerLinkByWorldPositions === "function") {
				nav._registerLinkByWorldPositions(linkData.a, linkData.b, linkData.bidirectional, linkData.cost);
			} else {
				__pendingNavLinks.push(linkData);
			}
		} catch {}
	}
}
ComponentRegistry.register("NavLink", NavLink);
ComponentRegistry.register("navlink", NavLink);


