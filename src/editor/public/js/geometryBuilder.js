/**
 * geometryBuilder.js - Creates Three.js geometries from parametric descriptions.
 * Used by the editor to preview Geometry component objects in real-time.
 */
import * as THREE from 'three';

// ============================================================
// Shape builders
// ============================================================

const SHAPE_BUILDERS = {
  box(p) {
    return new THREE.BoxGeometry(
      p.width ?? 1, p.height ?? 1, p.depth ?? 1,
      p.widthSegments ?? 1, p.heightSegments ?? 1, p.depthSegments ?? 1
    );
  },
  sphere(p) {
    return new THREE.SphereGeometry(
      p.radius ?? 0.5,
      p.widthSegments ?? 32, p.heightSegments ?? 16
    );
  },
  cylinder(p) {
    return new THREE.CylinderGeometry(
      p.radiusTop ?? 0.5, p.radiusBottom ?? 0.5, p.height ?? 1,
      p.radialSegments ?? 32, p.heightSegments ?? 1,
      p.openEnded ?? false
    );
  },
  cone(p) {
    return new THREE.ConeGeometry(
      p.radius ?? 0.5, p.height ?? 1,
      p.radialSegments ?? 32, p.heightSegments ?? 1,
      p.openEnded ?? false
    );
  },
  plane(p) {
    return new THREE.PlaneGeometry(
      p.width ?? 1, p.height ?? 1,
      p.widthSegments ?? 1, p.heightSegments ?? 1
    );
  },
  torus(p) {
    return new THREE.TorusGeometry(
      p.radius ?? 0.5, p.tube ?? 0.2,
      p.radialSegments ?? 16, p.tubularSegments ?? 48,
      p.arc ?? Math.PI * 2
    );
  },
  circle(p) {
    return new THREE.CircleGeometry(
      p.radius ?? 0.5, p.radialSegments ?? 32
    );
  },
  ring(p) {
    return new THREE.RingGeometry(
      p.innerRadius ?? 0.25, p.outerRadius ?? 0.5,
      p.radialSegments ?? 32, p.phiSegments ?? 1
    );
  },
  dodecahedron(p) {
    return new THREE.DodecahedronGeometry(p.radius ?? 0.5, p.detail ?? 0);
  },
  icosahedron(p) {
    return new THREE.IcosahedronGeometry(p.radius ?? 0.5, p.detail ?? 0);
  },
  octahedron(p) {
    return new THREE.OctahedronGeometry(p.radius ?? 0.5, p.detail ?? 0);
  },
  tetrahedron(p) {
    return new THREE.TetrahedronGeometry(p.radius ?? 0.5, p.detail ?? 0);
  },

  // --- Ramp (wedge / right-triangular prism) ---
  ramp(p) {
    const w = p.width ?? 1;
    const h = p.height ?? 1;
    const d = p.depth ?? 2;

    // Side profile in X-Y: triangle (0,0)→(d,0)→(d,h)
    // Extruded by width along Z, then rotated so width→X, height→Y, depth→Z.
    const profile = new THREE.Shape();
    profile.moveTo(0, 0);
    profile.lineTo(d, 0);
    profile.lineTo(d, h);
    profile.closePath();

    const geo = new THREE.ExtrudeGeometry(profile, {
      depth: w,
      bevelEnabled: false,
    });
    geo.rotateY(-Math.PI / 2);
    geo.center();
    return geo;
  },

  // --- Parametric wall (T / U / L / cross profiles) ---
  wall(p) {
    const w  = p.width     ?? 2;
    const h  = p.height    ?? 2;
    const d  = p.depth     ?? 2;
    const t  = p.thickness ?? 0.2;
    const ws = (p.wallShape ?? 'T').toUpperCase();

    let profile;
    switch (ws) {
      case 'U':     profile = _wallU(w, d, t);     break;
      case 'CROSS':
      case '+':     profile = _wallCross(w, d, t); break;
      case 'L':     profile = _wallL(w, d, t);     break;
      case 'T':
      default:      profile = _wallT(w, d, t);     break;
    }

    // Extrude the 2D cross-section (X-Y) along Z by wall height,
    // then rotate so Z→Y (up) and center.
    const geo = new THREE.ExtrudeGeometry(profile, {
      depth: h,
      bevelEnabled: false,
    });
    geo.rotateX(-Math.PI / 2);
    geo.center();
    return geo;
  },
};

// ============================================================
// Wall profile helpers  (cross-sections viewed from above)
// ============================================================

/**
 *  T-shape (top bar + downward stem)
 *   ___________
 *  |___________|
 *       |  |
 *       |__|
 */
function _wallT(w, d, t) {
  const hw = w / 2, hd = d / 2, ht = t / 2;
  const s = new THREE.Shape();
  s.moveTo(-hw,  hd);
  s.lineTo( hw,  hd);
  s.lineTo( hw,  hd - t);
  s.lineTo( ht,  hd - t);
  s.lineTo( ht, -hd);
  s.lineTo(-ht, -hd);
  s.lineTo(-ht,  hd - t);
  s.lineTo(-hw,  hd - t);
  s.closePath();
  return s;
}

/**
 *  U-shape (channel / doorway)
 *   __     __
 *  |  |   |  |
 *  |  |___|  |
 *  |_________|
 */
function _wallU(w, d, t) {
  const hw = w / 2, hd = d / 2;
  const s = new THREE.Shape();
  s.moveTo(-hw, -hd);
  s.lineTo( hw, -hd);
  s.lineTo( hw,  hd);
  s.lineTo( hw - t,  hd);
  s.lineTo( hw - t, -hd + t);
  s.lineTo(-hw + t, -hd + t);
  s.lineTo(-hw + t,  hd);
  s.lineTo(-hw,  hd);
  s.closePath();
  return s;
}

/**
 *  Cross / + shape (4-way intersection)
 *       __
 *      |  |
 *   ___|  |___
 *  |          |
 *  |___    ___|
 *      |  |
 *      |__|
 */
function _wallCross(w, d, t) {
  const hw = w / 2, hd = d / 2, ht = t / 2;
  const s = new THREE.Shape();
  s.moveTo(-ht,  hd);
  s.lineTo( ht,  hd);
  s.lineTo( ht,  ht);
  s.lineTo( hw,  ht);
  s.lineTo( hw, -ht);
  s.lineTo( ht, -ht);
  s.lineTo( ht, -hd);
  s.lineTo(-ht, -hd);
  s.lineTo(-ht, -ht);
  s.lineTo(-hw, -ht);
  s.lineTo(-hw,  ht);
  s.lineTo(-ht,  ht);
  s.closePath();
  return s;
}

/**
 *  L-shape (corner wall)
 *   __
 *  |  |
 *  |  |______
 *  |_________|
 */
function _wallL(w, d, t) {
  const hw = w / 2, hd = d / 2;
  const s = new THREE.Shape();
  s.moveTo(-hw, -hd);
  s.lineTo( hw, -hd);
  s.lineTo( hw, -hd + t);
  s.lineTo(-hw + t, -hd + t);
  s.lineTo(-hw + t,  hd);
  s.lineTo(-hw,  hd);
  s.closePath();
  return s;
}

// ============================================================
// Public API
// ============================================================

/**
 * Build a Three.js BufferGeometry from parametric Geometry component params.
 * @param {object} params - Geometry component params (shape, width, height, etc.)
 * @returns {THREE.BufferGeometry}
 */
export function buildGeometry(params) {
  const shape = (params?.shape || 'box').toLowerCase();
  const builder = SHAPE_BUILDERS[shape];
  return builder ? builder(params) : SHAPE_BUILDERS.box(params);
}

/**
 * Create a default editor material for newly-created primitives.
 * Uses MeshStandardMaterial so it's compatible with GLTF export.
 * @returns {THREE.MeshStandardMaterial}
 */
export function createDefaultMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0x89b4fa,
    roughness: 0.7,
    metalness: 0.1,
  });
}

/**
 * Get the default Geometry component params for a given shape type.
 * Only includes params that are relevant to the specified shape.
 * @param {string} shape
 * @returns {object}
 */
export function getDefaultGeoParams(shape) {
  const s = (shape || 'box').toLowerCase();
  switch (s) {
    case 'box':
      return { shape: s, width: 1, height: 1, depth: 1, widthSegments: 1, heightSegments: 1, depthSegments: 1 };
    case 'sphere':
      return { shape: s, radius: 0.5, widthSegments: 32, heightSegments: 16 };
    case 'cylinder':
      return { shape: s, radiusTop: 0.5, radiusBottom: 0.5, height: 1, radialSegments: 32, heightSegments: 1, openEnded: false };
    case 'cone':
      return { shape: s, radius: 0.5, height: 1, radialSegments: 32, heightSegments: 1, openEnded: false };
    case 'plane':
      return { shape: s, width: 1, height: 1, widthSegments: 1, heightSegments: 1 };
    case 'torus':
      return { shape: s, radius: 0.5, tube: 0.2, radialSegments: 16, tubularSegments: 48, arc: 6.283185307179586 };
    case 'circle':
      return { shape: s, radius: 0.5, radialSegments: 32 };
    case 'ring':
      return { shape: s, innerRadius: 0.25, outerRadius: 0.5, radialSegments: 32, phiSegments: 1 };
    case 'dodecahedron':
    case 'icosahedron':
    case 'octahedron':
    case 'tetrahedron':
      return { shape: s, radius: 0.5, detail: 0 };
    case 'ramp':
      return { shape: s, width: 1, height: 1, depth: 2 };
    case 'wall':
      return { shape: s, wallShape: 'T', width: 2, height: 2, depth: 2, thickness: 0.2 };
    default:
      return { shape: s, width: 1, height: 1, depth: 1 };
  }
}

/**
 * Sync a Three.js object's mesh geometry to match its Geometry component params.
 * If the object is a Mesh, replaces its geometry.
 * If the object is a Group/Object3D, finds the first child mesh and updates it.
 * If no mesh exists, creates one as a child.
 *
 * @param {THREE.Object3D} obj - The object to update
 * @param {object} geoParams - Geometry component params
 */
export function syncGeometryPreview(obj, geoParams) {
  if (!obj || !geoParams) return;

  const newGeo = buildGeometry(geoParams);

  // Case 1: object itself is a mesh
  if (obj.isMesh) {
    obj.geometry?.dispose();
    obj.geometry = newGeo;
    return;
  }

  // Case 2: find first non-editor mesh child
  for (const child of obj.children) {
    if (child.isMesh && !child.name.startsWith('__')) {
      child.geometry?.dispose();
      child.geometry = newGeo;
      return;
    }
  }

  // Case 3: no mesh found — create one
  const mesh = new THREE.Mesh(newGeo, createDefaultMaterial());
  obj.add(mesh);
}
