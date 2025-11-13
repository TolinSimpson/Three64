'use strict';
import { Vector3 } from "three";
import { Component, ComponentRegistry } from "./component.js";
import { loadJSON } from "./io.js";

// Pending links registered before a NavMesh is available/loaded
const __pendingNavLinks = [];

// Simple navigation mesh component with A* over triangle graph and optional funnel smoothing.
// Prefer building from a GLTF mesh node that has this component on it. Falls back to JSON if url provided.
export class NavMesh extends Component {
	constructor(ctx) {
		super(ctx);
		this.vertices = []; // Array<Vector3>
		this.triangles = []; // Array<[i0,i1,i2]>
		this.triangleCentroids = []; // Array<Vector3>
		this.neighbors = []; // Array<Array<neighborTriangleIndex>>
		this._areaCost = []; // per-triangle traversal cost multiplier (>= 0.0), default 1
		this._links = []; // [{ aTri, bTri, bidirectional, cost }]
		this._loaded = false;
	}

	static getDefaultParams() {
		return {
			// If present, legacy JSON navmesh source (vertices + triangles). If absent and object is set, geometry is used.
			url: "",
			// If true, attempt to smooth the path using the funnel algorithm across triangle portals.
			smooth: true,
		};
	}

	static getParamDescriptions() {
		return [
			{ key: "url", label: "Legacy JSON URL (optional)", type: "string", description: "If set, load navmesh from JSON; otherwise use this object's mesh." },
			{ key: "smooth", label: "Smooth Path", type: "boolean", description: "Smooth using string-pulling (funnel algorithm)." },
		];
	}

	async Initialize() {
		try {
			const opts = this.options || {};
			if (this.object && this._buildFromObjectGeometry(this.object)) {
				this._loaded = true;
			} else if (opts.url) {
				const url = new URL(opts.url, document.baseURI).toString();
				const data = await loadJSON(url);
				this._ingestData(data);
				this._loaded = true;
			} else {
				console.warn("NavMesh.Initialize: no mesh object or url provided");
				this._loaded = false;
			}
			if (this.game) this.game.navMesh = this;
			if (this._loaded) this._applyPendingLinks();
		} catch (e) {
			console.warn("NavMesh.Initialize: failed", e);
			this._loaded = false;
		}
	}

  _ingestData(data) {
    if (!data) return;
    const vertsIn = Array.isArray(data.vertices) ? data.vertices : [];
    const trisIn = Array.isArray(data.triangles) ? data.triangles : [];
    this.vertices = vertsIn.map((v) => {
      const x = Number(v[0]) || 0;
      const y = Number(v[1]) || 0;
      const z = Number(v[2]) || 0;
      return new Vector3(x, y, z);
    });
    this.triangles = [];
    for (let i = 0; i + 2 < trisIn.length; i += 3) {
      const a = trisIn[i] | 0;
      const b = trisIn[i + 1] | 0;
      const c = trisIn[i + 2] | 0;
      if (a >= 0 && b >= 0 && c >= 0 && a < this.vertices.length && b < this.vertices.length && c < this.vertices.length) {
        this.triangles.push([a, b, c]);
      }
    }
		// Initialize defaults
		this._areaCost = new Array(this.triangles.length).fill(1.0);
		this._links = [];
    this._buildAcceleration();
  }

	_buildFromObjectGeometry(root) {
		try {
			const verts = [];
			const tris = [];
			root.updateWorldMatrix(true, true);
			root.traverse((o) => {
				if (!o || !o.isMesh || !o.geometry) return;
				const g = o.geometry;
				const pos = g.getAttribute('position');
				if (!pos) return;
				const base = verts.length;
				// push all vertices transformed to world
				for (let i = 0; i < pos.count; i++) {
					const v = new Vector3().fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
					verts.push(v);
				}
				const index = g.getIndex();
				if (index && index.count >= 3) {
					const arr = index.array;
					for (let i = 0; i + 2 < arr.length; i += 3) {
						tris.push([base + arr[i], base + arr[i + 1], base + arr[i + 2]]);
					}
				} else {
					for (let i = 0; i + 2 < pos.count; i += 3) {
						tris.push([base + i, base + i + 1, base + i + 2]);
					}
				}
			});
			if (verts.length === 0 || tris.length === 0) return false;
			this.vertices = verts;
			this.triangles = tris;
			this._areaCost = new Array(this.triangles.length).fill(1.0);
			this._links = [];
			this._buildAcceleration();
			return true;
		} catch (e) {
			console.warn("NavMesh._buildFromObjectGeometry failed", e);
			return false;
		}
	}

	_registerLinkByWorldPositions(aVec3, bVec3, bidirectional = true, cost = 1.0) {
		if (!this._loaded) return;
		const aTri = this._findContainingOrNearestTriangle(aVec3);
		const bTri = this._findContainingOrNearestTriangle(bVec3);
		if (aTri < 0 || bTri < 0) return;
		this._links.push({ aTri, bTri, bidirectional: bidirectional !== false, cost: typeof cost === 'number' ? cost : 1.0 });
		// connect neighbors immediately
		try {
			this.neighbors[aTri].push(bTri);
			if (bidirectional !== false) this.neighbors[bTri].push(aTri);
		} catch {}
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

  _buildAcceleration() {
    // Centroids
    this.triangleCentroids = this.triangles.map(([a, b, c]) => {
      const va = this.vertices[a], vb = this.vertices[b], vc = this.vertices[c];
      return new Vector3().addVectors(va, vb).add(vc).multiplyScalar(1 / 3);
    });
    // Neighbor graph by shared edges
    const edgeToTri = new Map();
    const keyForEdge = (i0, i1) => i0 < i1 ? `${i0}_${i1}` : `${i1}_${i0}`;
    for (let t = 0; t < this.triangles.length; t++) {
      const [a, b, c] = this.triangles[t];
      for (const [i0, i1] of [[a, b], [b, c], [c, a]]) {
        const k = keyForEdge(i0, i1);
        if (!edgeToTri.has(k)) edgeToTri.set(k, []);
        edgeToTri.get(k).push(t);
      }
    }
    this.neighbors = new Array(this.triangles.length);
    for (let t = 0; t < this.triangles.length; t++) this.neighbors[t] = [];
    for (const arr of edgeToTri.values()) {
      if (arr.length === 2) {
        const [t0, t1] = arr;
        this.neighbors[t0].push(t1);
        this.neighbors[t1].push(t0);
      }
    }
		// Add neighbor edges from off-mesh links
		for (const l of this._links) {
			if (l.aTri >= 0 && l.bTri >= 0) {
				this.neighbors[l.aTri].push(l.bTri);
				if (l.bidirectional !== false) this.neighbors[l.bTri].push(l.aTri);
			}
		}
  }

  findPath(start, end, opts) {
    if (!this._loaded || !this.vertices.length || !this.triangles.length) return [];
    const startV = start instanceof Vector3 ? start : new Vector3(start?.x || 0, start?.y || 0, start?.z || 0);
    const endV = end instanceof Vector3 ? end : new Vector3(end?.x || 0, end?.y || 0, end?.z || 0);
    const startTri = this._findContainingOrNearestTriangle(startV);
    const endTri = this._findContainingOrNearestTriangle(endV);
    if (startTri < 0 || endTri < 0) return [];
		const triPath = this._aStarTriangles(startTri, endTri, endV);
    if (triPath.length === 0) return [];
    // Build waypoints: at minimum, triangle centroids; optionally funnel to portals
    const smooth = (opts && typeof opts.smooth === "boolean") ? opts.smooth : (this.options?.smooth !== false);
    if (!smooth) {
      const pts = [startV.clone()];
      for (const ti of triPath) pts.push(this.triangleCentroids[ti].clone());
      pts.push(endV.clone());
      return pts;
    }
    return this._funnelPath(startV, endV, triPath);
  }

  _findContainingOrNearestTriangle(p) {
    let bestIdx = -1;
    let bestDist = Infinity;
    const tmp = new Vector3();
    for (let t = 0; t < this.triangles.length; t++) {
      const [a, b, c] = this.triangles[t];
      const va = this.vertices[a], vb = this.vertices[b], vc = this.vertices[c];
      if (pointInTriangle2D(p, va, vb, vc)) return t;
      // distance to centroid as fallback
      const d = tmp.copy(this.triangleCentroids[t]).sub(p).lengthSq();
      if (d < bestDist) { bestDist = d; bestIdx = t; }
    }
    return bestIdx;
  }

  _aStarTriangles(startTri, endTri, endPoint) {
    const open = new MinQueue();
    const cameFrom = new Map(); // tri -> prev tri
    const gScore = new Map();
    const fScore = new Map();
    const h = (t) => this.triangleCentroids[t].distanceTo(endPoint);
    gScore.set(startTri, 0);
    fScore.set(startTri, h(startTri));
    open.push(startTri, fScore.get(startTri));
    const closed = new Set();
    while (!open.isEmpty()) {
      const current = open.pop();
      if (current === endTri) {
        // reconstruct
        const path = [current];
        let cur = current;
        while (cameFrom.has(cur)) {
          cur = cameFrom.get(cur);
          path.push(cur);
        }
        path.reverse();
        return path;
      }
      closed.add(current);
      const neighbors = this.neighbors[current] || [];
      for (const nb of neighbors) {
        if (closed.has(nb)) continue;
				// base edge length
				let step = this.triangleCentroids[current].distanceTo(this.triangleCentroids[nb]);
				// apply area cost multiplier (average of current and neighbor)
				const c0 = this._areaCost[current] || 1.0;
				const c1 = this._areaCost[nb] || 1.0;
				step *= 0.5 * (c0 + c1);
				// if this neighbor comes from an off-mesh link, add its additional cost
				for (const l of this._links) {
					if ((l.aTri === current && l.bTri === nb) || (l.bidirectional !== false && l.bTri === current && l.aTri === nb)) {
						step *= l.cost || 1.0;
						break;
					}
				}
				const tentative = (gScore.get(current) || Infinity) + step;
        if (tentative < (gScore.get(nb) || Infinity)) {
          cameFrom.set(nb, current);
          gScore.set(nb, tentative);
          const f = tentative + h(nb);
          fScore.set(nb, f);
          open.push(nb, f);
        }
      }
    }
    return [];
  }

  _funnelPath(startV, endV, triPath) {
    // Build portals between consecutive triangles as shared edges
    const portals = [];
    const edgeKey = (i0, i1) => i0 < i1 ? `${i0}_${i1}` : `${i1}_${i0}`;
    for (let i = 0; i + 1 < triPath.length; i++) {
      const t0 = triPath[i], t1 = triPath[i + 1];
      const [a0, b0, c0] = this.triangles[t0];
      const [a1, b1, c1] = this.triangles[t1];
      const set0 = new Set([a0, b0, c0]);
      const shared = [a1, b1, c1].filter(i => set0.has(i));
      if (shared.length !== 2) continue;
      const v0 = this.vertices[shared[0]];
      const v1 = this.vertices[shared[1]];
      portals.push([v0, v1]);
    }
    // Insert start and end as degenerate portals
    portals.unshift([startV.clone(), startV.clone()]);
    portals.push([endV.clone(), endV.clone()]);
    // String pulling (funnel)
    const pts = [];
    let apex = startV.clone();
    let left = portals[1][0].clone();
    let right = portals[1][1].clone();
    let apexIndex = 0, leftIndex = 1, rightIndex = 1;
    pts.push(apex.clone());
    for (let i = 2; i < portals.length; i++) {
      const pLeft = portals[i][0];
      const pRight = portals[i][1];
      // Update right
      if (triarea2(apex, right, pRight) <= 0.0) {
        if (apex.equals(right) || triarea2(apex, left, pRight) > 0.0) {
          right = pRight.clone();
          rightIndex = i;
        } else {
          pts.push(left.clone());
          apex = left.clone();
          apexIndex = leftIndex;
          left = apex.clone();
          right = apex.clone();
          i = apexIndex;
          leftIndex = apexIndex;
          rightIndex = apexIndex;
          continue;
        }
      }
      // Update left
      if (triarea2(apex, left, pLeft) >= 0.0) {
        if (apex.equals(left) || triarea2(apex, right, pLeft) < 0.0) {
          left = pLeft.clone();
          leftIndex = i;
        } else {
          pts.push(right.clone());
          apex = right.clone();
          apexIndex = rightIndex;
          left = apex.clone();
          right = apex.clone();
          i = apexIndex;
          leftIndex = apexIndex;
          rightIndex = apexIndex;
          continue;
        }
      }
    }
    pts.push(endV.clone());
    return pts;
  }
}

// Helpers
function pointInTriangle2D(p, a, b, c) {
  // Project to XZ plane (Three uses Y-up)
  const px = p.x, pz = p.z;
  const ax = a.x, az = a.z;
  const bx = b.x, bz = b.z;
  const cx = c.x, cz = c.z;
  const v0x = cx - ax, v0z = cz - az;
  const v1x = bx - ax, v1z = bz - az;
  const v2x = px - ax, v2z = pz - az;
  const dot00 = v0x * v0x + v0z * v0z;
  const dot01 = v0x * v1x + v0z * v1z;
  const dot02 = v0x * v2x + v0z * v2z;
  const dot11 = v1x * v1x + v1z * v1z;
  const dot12 = v1x * v2x + v1z * v2z;
  const invDenom = 1 / (dot00 * dot11 - dot01 * dot01 + 1e-12);
  const u = (dot11 * dot02 - dot01 * dot12) * invDenom;
  const v = (dot00 * dot12 - dot01 * dot02) * invDenom;
  return u >= -1e-6 && v >= -1e-6 && (u + v) <= 1 + 1e-6;
}

function triarea2(a, b, c) {
  // 2D signed area on XZ plane
  const abx = b.x - a.x, abz = b.z - a.z;
  const acx = c.x - a.x, acz = c.z - a.z;
  return acx * abz - abx * acz;
}

class MinQueue {
  constructor() { this._arr = []; }
  push(item, priority) {
    this._arr.push({ item, priority });
    let i = this._arr.length - 1;
    while (i > 0 && this._arr[i].priority < this._arr[i - 1].priority) {
      const tmp = this._arr[i]; this._arr[i] = this._arr[i - 1]; this._arr[i - 1] = tmp;
      i--;
    }
  }
  pop() {
    const v = this._arr.shift();
    return v ? v.item : undefined;
  }
  isEmpty() { return this._arr.length === 0; }
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


