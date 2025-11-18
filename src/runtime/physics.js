'use strict';
import { Group, Raycaster, Vector3, MeshBasicMaterial, Mesh, BufferGeometry, Float32BufferAttribute } from "three";
import { ConvexGeometry } from "three/examples/jsm/geometries/ConvexGeometry.js";
import AmmoFactory from "ammo.js";

// Minimal physics: static convex colliders, simple raycasts, gravity, and slide.
export class PhysicsWorld {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.debug = options.debug === true;
    this.colliders = [];
    this.colliderGroup = new Group();
    this.colliderGroup.name = "PhysicsColliders";
    this.scene.add(this.colliderGroup);

    this.raycaster = new Raycaster();
    this.raycaster.firstHitOnly = true;

    // Optional infinite ground plane at y=0
    this.groundY = options.groundY ?? 0;
    this.enableGroundPlane = options.enableGroundPlane !== false;
    // Ammo.js world (lazy loaded)
    this.ammoReady = false;
    this.Ammo = null;
    this.dynamicsWorld = null;
    this._ammo = null; // subsystems
    this._rigidBodies = [];
		// Collision filter defaults (bit masks)
		this._defaultLayer = 1;   // group
		this._defaultMask = 0xffff; // collides with all by default
		// Map Three.js object -> Ammo body for lookups/joints
		this._objectToBody = new Map();
		// Track created joints/constraints for cleanup
		this._joints = []; // { constraint, type, a, b }
    // Track Three.js objects bound to Ammo bodies for simulation sync
    this._entities = []; // { object, body, shape, type: 'dynamic'|'kinematic'|'static' }
    this._initAmmo(options);
  }

  // Build a static convex collider from an Object3D's meshes (world baked).
  addConvexColliderForObject(object3D, { mergeChildren = true, visible = false, material = null } = {}) {
    const worldPoints = [];
    object3D.updateWorldMatrix(true, true);
    object3D.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      const geom = o.geometry;
      const pos = geom.getAttribute("position");
      if (!pos) return;
      const m = o.matrixWorld;
      const v = new Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m);
        worldPoints.push(v.clone());
      }
      if (!mergeChildren) {
        // Create per-mesh convex for fine control
        this._addConvexFromPoints(worldPoints.splice(0, worldPoints.length), { visible, material });
      }
    });
    if (mergeChildren && worldPoints.length) {
      this._addConvexFromPoints(worldPoints, { visible, material });
    }
  }

  // Build a static mesh collider that follows the original triangle mesh (world baked).
  addMeshColliderForObject(object3D, { mergeChildren = true, visible = false, material = null } = {}) {
    const triPositions = []; // flat array [x,y,z,...]
    object3D.updateWorldMatrix(true, true);
    const emitMeshTriangles = (o, outArr) => {
      if (!o.isMesh || !o.geometry) return;
      const geom = o.geometry;
      const pos = geom.getAttribute("position");
      if (!pos) return;
      const index = geom.getIndex();
      const m = o.matrixWorld;
      const v = new Vector3();
      const addVertex = (i) => {
        v.fromBufferAttribute(pos, i).applyMatrix4(m);
        outArr.push(v.x, v.y, v.z);
      };
      if (index) {
        for (let i = 0; i < index.count; i += 3) {
          addVertex(index.getX(i));
          addVertex(index.getX(i + 1));
          addVertex(index.getX(i + 2));
        }
      } else {
        for (let i = 0; i < pos.count; i += 3) {
          addVertex(i + 0);
          addVertex(i + 1);
          addVertex(i + 2);
        }
      }
    };
    if (mergeChildren) {
      object3D.traverse((o) => emitMeshTriangles(o, triPositions));
      this._addMeshFromPositions(triPositions, { visible, material });
    } else {
      // Per-mesh triangle colliders (do not merge children)
      object3D.traverse((o) => {
        if (!o.isMesh) return;
        const arr = [];
        emitMeshTriangles(o, arr);
        if (arr.length >= 9) this._addMeshFromPositions(arr, { visible, material });
      });
    }
  }

  // Build a static axis-aligned box collider from world bounds
  addBoxColliderForObject(object3D, { visible = false, material = null } = {}) {
    const { min, max } = this._boundsForObject(object3D);
    if (!isFinite(min.x) || !isFinite(max.x)) return;
    // Compute center and half extents
    const hx = Math.max(1e-4, (max.x - min.x) / 2);
    const hy = Math.max(1e-4, (max.y - min.y) / 2);
    const hz = Math.max(1e-4, (max.z - min.z) / 2);
    const cx = (min.x + max.x) / 2;
    const cy = (min.y + max.y) / 2;
    const cz = (min.z + max.z) / 2;
    // Build world-space triangles for debug/raycast fallback
    const P = [
      [cx - hx, cy - hy, cz - hz],
      [cx + hx, cy - hy, cz - hz],
      [cx + hx, cy + hy, cz - hz],
      [cx - hx, cy + hy, cz - hz],
      [cx - hx, cy - hy, cz + hz],
      [cx + hx, cy - hy, cz + hz],
      [cx + hx, cy + hy, cz + hz],
      [cx - hx, cy + hy, cz + hz],
    ];
    const faces = [
      [0, 1, 2], [0, 2, 3], // -Z
      [4, 6, 5], [4, 7, 6], // +Z
      [0, 4, 5], [0, 5, 1], // -Y
      [3, 2, 6], [3, 6, 7], // +Y
      [0, 3, 7], [0, 7, 4], // -X
      [1, 5, 6], [1, 6, 2], // +X
    ];
    const flat = [];
    for (let i = 0; i < faces.length; i++) {
      const f = faces[i];
      for (let j = 0; j < 3; j++) {
        const v = P[f[j]];
        flat.push(v[0], v[1], v[2]);
      }
    }
    this._addDebugMeshFromPositions(flat, { visible, material });
    if (this.ammoReady && this.Ammo && this.dynamicsWorld) {
      this._createAmmoStaticBox({ hx, hy, hz, center: { x: cx, y: cy, z: cz } });
    }
  }

  // Build a static sphere collider from world bounds (max of half-axes)
  addSphereColliderForObject(object3D, { visible = false, material = null } = {}) {
    const { min, max } = this._boundsForObject(object3D);
    if (!isFinite(min.x) || !isFinite(max.x)) return;
    const cx = (min.x + max.x) / 2;
    const cy = (min.y + max.y) / 2;
    const cz = (min.z + max.z) / 2;
    const rx = Math.max(1e-4, (max.x - min.x) / 2);
    const ry = Math.max(1e-4, (max.y - min.y) / 2);
    const rz = Math.max(1e-4, (max.z - min.z) / 2);
    const r = Math.max(rx, ry, rz);
    // Debug mesh: low-poly octahedron
    const verts = [
      [cx, cy + r, cz], // top
      [cx + r, cy, cz],
      [cx, cy, cz + r],
      [cx - r, cy, cz],
      [cx, cy, cz - r],
      [cx, cy - r, cz], // bottom
    ];
    const faces = [
      [0, 1, 2], [0, 2, 3], [0, 3, 4], [0, 4, 1],
      [5, 2, 1], [5, 3, 2], [5, 4, 3], [5, 1, 4],
    ];
    const flat = [];
    for (let i = 0; i < faces.length; i++) {
      const f = faces[i];
      for (let j = 0; j < 3; j++) {
        const v = verts[f[j]];
        flat.push(v[0], v[1], v[2]);
      }
    }
    this._addDebugMeshFromPositions(flat, { visible, material });
    if (this.ammoReady && this.Ammo && this.dynamicsWorld) {
      this._createAmmoStaticSphere({ r, center: { x: cx, y: cy, z: cz } });
    }
  }

  // Build a static capsule collider from world bounds (Y-up). Height is cylinder part.
  addCapsuleColliderForObject(object3D, { visible = false, material = null } = {}) {
    const { min, max } = this._boundsForObject(object3D);
    if (!isFinite(min.x) || !isFinite(max.x)) return;
    const cx = (min.x + max.x) / 2;
    const cy = (min.y + max.y) / 2;
    const cz = (min.z + max.z) / 2;
    const sx = (max.x - min.x);
    const sy = (max.y - min.y);
    const sz = (max.z - min.z);
    const r = Math.max(1e-4, Math.min(sx, sz) * 0.5);
    const h = Math.max(1e-4, sy - 2 * r);
    const yTop = cy + h * 0.5;
    const yBot = cy - h * 0.5;
    // Coarse debug mesh: two caps + 4-sided cylinder
    const pTop = [cx, yTop + r, cz];
    const pBot = [cx, yBot - r, cz];
    const ringTop = [
      [cx + r, yTop, cz],
      [cx, yTop, cz + r],
      [cx - r, yTop, cz],
      [cx, yTop, cz - r],
    ];
    const ringBot = [
      [cx + r, yBot, cz],
      [cx, yBot, cz + r],
      [cx - r, yBot, cz],
      [cx, yBot, cz - r],
    ];
    const tri = [];
    // top cap
    for (let i = 0; i < 4; i++) {
      const a = ringTop[i];
      const b = ringTop[(i + 1) % 4];
      tri.push(...pTop, ...a, ...b);
    }
    // cylinder sides
    for (let i = 0; i < 4; i++) {
      const aTop = ringTop[i];
      const bTop = ringTop[(i + 1) % 4];
      const aBot = ringBot[i];
      const bBot = ringBot[(i + 1) % 4];
      tri.push(...aTop, ...aBot, ...bBot);
      tri.push(...aTop, ...bBot, ...bTop);
    }
    // bottom cap
    for (let i = 0; i < 4; i++) {
      const a = ringBot[i];
      const b = ringBot[(i + 1) % 4];
      tri.push(...pBot, ...b, ...a);
    }
    this._addDebugMeshFromPositions(tri, { visible, material });
    if (this.ammoReady && this.Ammo && this.dynamicsWorld) {
      this._createAmmoStaticCapsule({ r, h, center: { x: cx, y: cy, z: cz } });
    }
  }

  _addConvexFromPoints(points, { visible, material }) {
    if (!points || points.length < 4) return; // Need at least a tetrahedron
    const geom = new ConvexGeometry(points);
    geom.computeVertexNormals();
    const mat = material || new MeshBasicMaterial({ color: 0x00ffff, wireframe: true, transparent: true, opacity: 0.15 });
    const mesh = new Mesh(geom, mat);
    mesh.matrixAutoUpdate = false; // baked in world space
    mesh.visible = this.debug || visible === true;
    this.colliderGroup.add(mesh);
    this.colliders.push(mesh);
    // Build Ammo static convex body as well when ready
    if (this.ammoReady && this.Ammo && this.dynamicsWorld) {
      this._createAmmoStaticConvex(points);
    }
  }

  _addMeshFromPositions(flatPositions, { visible, material }) {
    if (!Array.isArray(flatPositions) || flatPositions.length < 9) return;
    // Build BufferGeometry from provided world-space triangle positions
    const geom = new BufferGeometry();
    const posAttr = new Float32BufferAttribute(flatPositions, 3);
    geom.setAttribute("position", posAttr);
    geom.computeVertexNormals();
    const mat = material || new MeshBasicMaterial({ color: 0x00ff00, wireframe: true, transparent: true, opacity: 0.15 });
    const mesh = new Mesh(geom, mat);
    mesh.matrixAutoUpdate = false;
    mesh.visible = this.debug || visible === true;
    this.colliderGroup.add(mesh);
    this.colliders.push(mesh);
    // Build Ammo static triangle mesh when available
    if (this.ammoReady && this.Ammo && this.dynamicsWorld) {
      this._createAmmoStaticTriangleMesh(flatPositions);
    }
  }

  _addDebugMeshFromPositions(flatPositions, { visible, material }) {
    if (!Array.isArray(flatPositions) || flatPositions.length < 9) return;
    const geom = new BufferGeometry();
    const posAttr = new Float32BufferAttribute(flatPositions, 3);
    geom.setAttribute("position", posAttr);
    geom.computeVertexNormals();
    const mat = material || new MeshBasicMaterial({ color: 0x00ff00, wireframe: true, transparent: true, opacity: 0.15 });
    const mesh = new Mesh(geom, mat);
    mesh.matrixAutoUpdate = false;
    mesh.visible = this.debug || visible === true;
    this.colliderGroup.add(mesh);
    this.colliders.push(mesh);
  }

  // Simple raycast against colliders and optional ground plane at y=0.
  raycast(origin, direction, maxDistance = 100) {
    // Prefer Ammo ray test when available
    const ammoHit = this._ammoRaycast(origin, direction, maxDistance);
    let closest = ammoHit;
    const dir = direction.clone().normalize();
    if (!closest) {
      this.raycaster.set(origin, dir);
      this.raycaster.far = maxDistance;
      const hits = this.raycaster.intersectObjects(this.colliders, false);
      if (hits.length > 0) closest = hits[0];
    }

    // Ground plane hit
    if (this.enableGroundPlane) {
      if (Math.abs(dir.y) > 1e-5) {
        const t = (this.groundY - origin.y) / dir.y;
        if (t >= 0 && t <= maxDistance) {
          const p = origin.clone().addScaledVector(dir, t);
          const groundHit = {
            distance: t,
            point: p,
            face: { normal: new Vector3(0, 1, 0) },
            object: null,
          };
          if (!closest || groundHit.distance < closest.distance) closest = groundHit;
        }
      }
    }
    return closest;
  }

  // Step Ammo world if ready
  step(dt) {
    if (!this.ammoReady || !this.dynamicsWorld || !this.Ammo) return;
    const Ammo = this.Ammo;

    // Push kinematic objects' transforms into Ammo before stepping
    for (let i = 0; i < this._entities.length; i++) {
      const ent = this._entities[i];
      if (!ent || ent.type !== "kinematic") continue;
      try {
        const tr = new Ammo.btTransform();
        tr.setIdentity();
        ent.object.updateWorldMatrix(true, false);
        const m = ent.object.matrixWorld;
        // Extract pos and rot
        const px = m.elements[12], py = m.elements[13], pz = m.elements[14];
        // Approximate rotation via object quaternion (preferred) to avoid matrix decomposition here
        const q = ent.object.getWorldQuaternion?.({ x:0,y:0,z:0,w:1 }) || null;
        if (q && typeof q.x === "number") {
          tr.setOrigin(new Ammo.btVector3(px, py, pz));
          tr.setRotation(new Ammo.btQuaternion(q.x, q.y, q.z, q.w));
        } else {
          tr.setOrigin(new Ammo.btVector3(px, py, pz));
        }
        ent.body.setWorldTransform(tr);
      } catch {}
    }

    const maxSubSteps = 2;
    const fixedTimeStep = 1 / 60;
    this.dynamicsWorld.stepSimulation(dt, maxSubSteps, fixedTimeStep);

    // Pull dynamic objects' transforms back into Three after stepping
    for (let i = 0; i < this._entities.length; i++) {
      const ent = this._entities[i];
      if (!ent || ent.type !== "dynamic") continue;
      try {
        const ms = ent.body.getMotionState?.();
        const trans = new Ammo.btTransform();
        if (ms && ms.getWorldTransform) {
          ms.getWorldTransform(trans);
        } else {
          ent.body.getWorldTransform?.(trans);
        }
        const o = trans.getOrigin?.();
        const r = trans.getRotation?.();
        if (o && r) {
          ent.object.position.set(o.x(), o.y(), o.z());
          ent.object.quaternion.set(r.x(), r.y(), r.z(), r.w());
        }
      } catch {}
    }
  }

  async _initAmmo(options) {
    try {
      // Dynamic import for code-splitting with robust handling of different module shapes
      let Ammo = null;
      try {
        const mod = await import('ammo.js');
        const MaybeFactory = (mod && (mod.default ?? mod)) || null;
        if (typeof MaybeFactory === "function") {
          Ammo = await MaybeFactory();
        } else if (MaybeFactory && typeof MaybeFactory.then === "function") {
          Ammo = await MaybeFactory;
        }
      } catch {}
      // Fallback to static import form if available
      if (!Ammo && typeof AmmoFactory === "function") {
        Ammo = await AmmoFactory();
      } else if (!Ammo && AmmoFactory && typeof AmmoFactory.then === "function") {
        Ammo = await AmmoFactory;
      }
      if (!Ammo) throw new Error("Ammo module could not be initialized");
      this.Ammo = Ammo;
      const collisionConfiguration = new Ammo.btDefaultCollisionConfiguration();
      const dispatcher = new Ammo.btCollisionDispatcher(collisionConfiguration);
      const broadphase = new Ammo.btDbvtBroadphase();
      const solver = new Ammo.btSequentialImpulseConstraintSolver();
      const dynamicsWorld = new Ammo.btDiscreteDynamicsWorld(dispatcher, broadphase, solver, collisionConfiguration);
      const g = options && typeof options.gravity === "number" ? options.gravity : 9.8;
      dynamicsWorld.setGravity(new Ammo.btVector3(0, -g, 0));
      this._ammo = { collisionConfiguration, dispatcher, broadphase, solver };
      this.dynamicsWorld = dynamicsWorld;
      this.ammoReady = true;
    } catch (e) {
      console.warn("Ammo.js initialization failed; falling back to Three-only collisions.", e);
      this.ammoReady = false;
    }
  }

  _createAmmoStaticConvex(points) {
    const Ammo = this.Ammo;
    if (!Ammo || !this.dynamicsWorld) return;
    const shape = new Ammo.btConvexHullShape();
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const v = new Ammo.btVector3(p.x, p.y, p.z);
      shape.addPoint(v, true);
    }
    if (shape.optimizeConvexHull) shape.optimizeConvexHull();
    if (shape.initializePolyhedralFeatures) shape.initializePolyhedralFeatures();
    const transform = new Ammo.btTransform();
    transform.setIdentity();
    transform.setOrigin(new Ammo.btVector3(0, 0, 0));
    const motionState = new Ammo.btDefaultMotionState(transform);
    const mass = 0;
    const localInertia = new Ammo.btVector3(0, 0, 0);
    const rbInfo = new Ammo.btRigidBodyConstructionInfo(mass, motionState, shape, localInertia);
    const body = new Ammo.btRigidBody(rbInfo);
    this.dynamicsWorld.addRigidBody(body);
    this._rigidBodies.push(body);
  }

  _createAmmoStaticBox({ hx, hy, hz, center }) {
    const Ammo = this.Ammo;
    if (!Ammo || !this.dynamicsWorld) return;
    try {
      const shape = new Ammo.btBoxShape(new Ammo.btVector3(hx, hy, hz));
      const transform = new Ammo.btTransform();
      transform.setIdentity();
      transform.setOrigin(new Ammo.btVector3(center.x, center.y, center.z));
      const motionState = new Ammo.btDefaultMotionState(transform);
      const mass = 0;
      const localInertia = new Ammo.btVector3(0, 0, 0);
      const rbInfo = new Ammo.btRigidBodyConstructionInfo(mass, motionState, shape, localInertia);
      const body = new Ammo.btRigidBody(rbInfo);
      this.dynamicsWorld.addRigidBody(body);
      this._rigidBodies.push(body);
    } catch {}
  }

  _createAmmoStaticSphere({ r, center }) {
    const Ammo = this.Ammo;
    if (!Ammo || !this.dynamicsWorld) return;
    try {
      const shape = new Ammo.btSphereShape(Math.max(1e-4, r));
      const transform = new Ammo.btTransform();
      transform.setIdentity();
      transform.setOrigin(new Ammo.btVector3(center.x, center.y, center.z));
      const motionState = new Ammo.btDefaultMotionState(transform);
      const mass = 0;
      const localInertia = new Ammo.btVector3(0, 0, 0);
      const rbInfo = new Ammo.btRigidBodyConstructionInfo(mass, motionState, shape, localInertia);
      const body = new Ammo.btRigidBody(rbInfo);
      this.dynamicsWorld.addRigidBody(body);
      this._rigidBodies.push(body);
    } catch {}
  }

  _createAmmoStaticCapsule({ r, h, center }) {
    const Ammo = this.Ammo;
    if (!Ammo || !this.dynamicsWorld) return;
    try {
      const shape = new Ammo.btCapsuleShape(Math.max(1e-4, r), Math.max(0, h));
      const transform = new Ammo.btTransform();
      transform.setIdentity();
      transform.setOrigin(new Ammo.btVector3(center.x, center.y, center.z));
      const motionState = new Ammo.btDefaultMotionState(transform);
      const mass = 0;
      const localInertia = new Ammo.btVector3(0, 0, 0);
      const rbInfo = new Ammo.btRigidBodyConstructionInfo(mass, motionState, shape, localInertia);
      const body = new Ammo.btRigidBody(rbInfo);
      this.dynamicsWorld.addRigidBody(body);
      this._rigidBodies.push(body);
    } catch {}
  }

  _createAmmoStaticTriangleMesh(flatPositions) {
    const Ammo = this.Ammo;
    if (!Ammo || !this.dynamicsWorld) return;
    try {
      const triMesh = new Ammo.btTriangleMesh(true, true);
      for (let i = 0; i < flatPositions.length - 8; i += 9) {
        const v0 = new Ammo.btVector3(flatPositions[i + 0], flatPositions[i + 1], flatPositions[i + 2]);
        const v1 = new Ammo.btVector3(flatPositions[i + 3], flatPositions[i + 4], flatPositions[i + 5]);
        const v2 = new Ammo.btVector3(flatPositions[i + 6], flatPositions[i + 7], flatPositions[i + 8]);
        triMesh.addTriangle(v0, v1, v2, true);
      }
      const useQuantizedAabbCompression = true;
      const buildBvh = true;
      const shape = new Ammo.btBvhTriangleMeshShape(triMesh, useQuantizedAabbCompression, buildBvh);
      const transform = new Ammo.btTransform();
      transform.setIdentity();
      transform.setOrigin(new Ammo.btVector3(0, 0, 0));
      const motionState = new Ammo.btDefaultMotionState(transform);
      const mass = 0;
      const localInertia = new Ammo.btVector3(0, 0, 0);
      const rbInfo = new Ammo.btRigidBodyConstructionInfo(mass, motionState, shape, localInertia);
      const body = new Ammo.btRigidBody(rbInfo);
      this.dynamicsWorld.addRigidBody(body);
      this._rigidBodies.push(body);
    } catch {}
  }

  // --------------------------
  // Rigid bodies (dynamic/kinematic/static from objects)
  // --------------------------
	addRigidBodyForObject(object3D, {
    shape = "box",
    type = "dynamic",
    mass = undefined,
    friction = undefined,
    restitution = undefined,
    linearDamping = undefined,
    angularDamping = undefined,
    mergeChildren = true,
		// collision filters
		layer = undefined,
		mask = undefined,
		// shape-specific overrides
		size = undefined,       // [x,y,z] for box
		radius = undefined,     // sphere/capsule radius
		height = undefined,     // capsule height (cylinder part)
		center = undefined,     // local center offset [x,y,z]
  } = {}) {
    if (!this.ammoReady || !this.dynamicsWorld || !this.Ammo) return null;
    const Ammo = this.Ammo;

    const shapeLower = String(shape || "box").toLowerCase();
    const typeLower = String(type || "dynamic").toLowerCase();

		const shapeObj = this._buildAmmoShapeForObject(object3D, shapeLower, {
			mergeChildren,
			size,
			radius,
			height,
			center,
		});
    if (!shapeObj) return null;

    // Determine mass: 0 for static and kinematic; positive for dynamic (default 1)
    let rbMass = (typeof mass === "number" ? mass : (typeLower === "dynamic" ? 1 : 0));
    if (typeLower === "kinematic" && rbMass !== 0) rbMass = 0;

    // Transform from object's world matrix
    object3D.updateWorldMatrix(true, true);
    const tr = new Ammo.btTransform();
    tr.setIdentity();
    const e = object3D.matrixWorld.elements;
    const pos = new Ammo.btVector3(e[12], e[13], e[14]);
    tr.setOrigin(pos);
    // Use object's quaternion
    const q = object3D.getWorldQuaternion?.({ x:0,y:0,z:0,w:1 }) || null;
    if (q && typeof q.x === "number") {
      tr.setRotation(new Ammo.btQuaternion(q.x, q.y, q.z, q.w));
    }
    const motionState = new Ammo.btDefaultMotionState(tr);

    const localInertia = new Ammo.btVector3(0, 0, 0);
    if (rbMass > 0 && shapeObj.calculateLocalInertia) {
      shapeObj.calculateLocalInertia(rbMass, localInertia);
    }
    const rbInfo = new Ammo.btRigidBodyConstructionInfo(rbMass, motionState, shapeObj, localInertia);
    const body = new Ammo.btRigidBody(rbInfo);

    if (typeof friction === "number") body.setFriction(friction);
    if (typeof restitution === "number") body.setRestitution(restitution);
    if (typeof linearDamping === "number" || typeof angularDamping === "number") {
      body.setDamping(linearDamping || 0, angularDamping || 0);
    }

    if (typeLower === "kinematic") {
      // CF_KINEMATIC_OBJECT = 2, DISABLE_DEACTIVATION = 4
      body.setCollisionFlags(body.getCollisionFlags() | 2);
      body.setActivationState(4);
    }

		// Collision filters: Ammo supports group/mask when adding the body
		const group = (typeof layer === "number" && layer > 0) ? layer : this._defaultLayer;
		let maskBits;
		if (Array.isArray(mask)) {
			maskBits = 0;
			for (let i = 0; i < mask.length; i++) {
				const bit = Number(mask[i]) | 0;
				if (bit > 0) maskBits |= bit;
			}
			if (maskBits === 0) maskBits = this._defaultMask;
		} else if (typeof mask === "number") {
			maskBits = mask;
		} else {
			maskBits = this._defaultMask;
		}
		// Use addRigidBody with filters when available
		try {
			this.dynamicsWorld.addRigidBody(body, group, maskBits);
		} catch {
			this.dynamicsWorld.addRigidBody(body);
		}
    this._entities.push({ object: object3D, body, shape: shapeObj, type: typeLower });
		this._objectToBody.set(object3D, body);
    return body;
  }

  removeRigidBody(body) {
    if (!this.ammoReady || !this.dynamicsWorld || !body) return;
    try {
      this.dynamicsWorld.removeRigidBody(body);
    } catch (e) {
      console.warn("Failed to remove rigid body:", e);
    }
    // Cleanup references
    const idx = this._rigidBodies.indexOf(body);
    if (idx >= 0) this._rigidBodies.splice(idx, 1);

    for (let i = this._entities.length - 1; i >= 0; i--) {
      if (this._entities[i].body === body) {
        const obj = this._entities[i].object;
        if (obj) this._objectToBody.delete(obj);
        this._entities.splice(i, 1);
      }
    }
  }

	_buildAmmoShapeForObject(object3D, shape, { mergeChildren, size, radius, height, center }) {
    const Ammo = this.Ammo;
    try {
      if (shape === "box") {
				let hx, hy, hz;
				if (Array.isArray(size) && size.length >= 3) {
					hx = Math.max(1e-4, Number(size[0]) / 2);
					hy = Math.max(1e-4, Number(size[1]) / 2);
					hz = Math.max(1e-4, Number(size[2]) / 2);
				} else {
					const { min, max } = this._boundsForObject(object3D);
					hx = Math.max(1e-4, (max.x - min.x) / 2);
					hy = Math.max(1e-4, (max.y - min.y) / 2);
					hz = Math.max(1e-4, (max.z - min.z) / 2);
				}
				const shapeObj = new Ammo.btBoxShape(new Ammo.btVector3(hx, hy, hz));
				return shapeObj;
      }
      if (shape === "sphere") {
				let r = undefined;
				if (typeof radius === "number") r = radius;
				if (r == null) {
					const { min, max } = this._boundsForObject(object3D);
					const rx = (max.x - min.x) / 2, ry = (max.y - min.y) / 2, rz = (max.z - min.z) / 2;
					r = Math.max(1e-4, Math.max(rx, ry, rz));
				}
				return new Ammo.btSphereShape(Math.max(1e-4, r));
      }
      if (shape === "capsule") {
				let r = typeof radius === "number" ? radius : undefined;
				let h = typeof height === "number" ? height : undefined;
				if (r == null || h == null) {
					const { min, max } = this._boundsForObject(object3D);
					const sx = (max.x - min.x), sy = (max.y - min.y), sz = (max.z - min.z);
					if (r == null) r = Math.max(1e-4, Math.min(sx, sz) * 0.5);
					if (h == null) h = Math.max(1e-4, sy - 2 * r);
				}
        // Y-up capsule
				return new Ammo.btCapsuleShape(Math.max(1e-4, r), Math.max(0, h));
      }
      // default or explicit convex
      if (shape === "convex" || !shape) {
        const points = this._collectWorldPoints(object3D, { mergeChildren });
        if (!points || points.length < 4) return null;
        const hull = new Ammo.btConvexHullShape();
        for (let i = 0; i < points.length; i++) {
          const p = points[i];
          hull.addPoint(new Ammo.btVector3(p.x, p.y, p.z), true);
        }
        if (hull.optimizeConvexHull) hull.optimizeConvexHull();
        if (hull.initializePolyhedralFeatures) hull.initializePolyhedralFeatures();
        return hull;
      }
    } catch {}
    return null;
  }

	// --------------------------
	// Joint helpers
	// --------------------------
	addPointToPointJoint(objectA, objectB, { anchorA = [0, 0, 0], anchorB = [0, 0, 0] } = {}) {
		if (!this.ammoReady || !this.dynamicsWorld || !this.Ammo) return null;
		const Ammo = this.Ammo;
		const bodyA = this._objectToBody.get(objectA);
		const bodyB = this._objectToBody.get(objectB);
		if (!bodyA || !bodyB) return null;
		const pa = new Ammo.btVector3(anchorA[0] || 0, anchorA[1] || 0, anchorA[2] || 0);
		const pb = new Ammo.btVector3(anchorB[0] || 0, anchorB[1] || 0, anchorB[2] || 0);
		const c = new Ammo.btPoint2PointConstraint(bodyA, bodyB, pa, pb);
		this.dynamicsWorld.addConstraint(c, true);
		this._joints.push({ constraint: c, type: "p2p", a: objectA, b: objectB });
		return c;
	}

	addHingeJoint(objectA, objectB, {
		anchorA = [0, 0, 0],
		anchorB = [0, 0, 0],
		axisA = [0, 1, 0],
		axisB = [0, 1, 0],
		limits = undefined, // [min, max] in radians
	} = {}) {
		if (!this.ammoReady || !this.dynamicsWorld || !this.Ammo) return null;
		const Ammo = this.Ammo;
		const bodyA = this._objectToBody.get(objectA);
		const bodyB = this._objectToBody.get(objectB);
		if (!bodyA || !bodyB) return null;
		const pa = new Ammo.btVector3(anchorA[0] || 0, anchorA[1] || 0, anchorA[2] || 0);
		const pb = new Ammo.btVector3(anchorB[0] || 0, anchorB[1] || 0, anchorB[2] || 0);
		const axA = new Ammo.btVector3(axisA[0] || 0, axisA[1] || 0, axisA[2] || 0);
		const axB = new Ammo.btVector3(axisB[0] || 0, axisB[1] || 0, axisB[2] || 0);
		const c = new Ammo.btHingeConstraint(bodyA, bodyB, pa, pb, axA, axB, false);
		if (Array.isArray(limits) && limits.length >= 2) {
			try { c.setLimit(Number(limits[0]) || 0, Number(limits[1]) || 0); } catch {}
		}
		this.dynamicsWorld.addConstraint(c, true);
		this._joints.push({ constraint: c, type: "hinge", a: objectA, b: objectB });
		return c;
	}

	addFixedJoint(objectA, objectB) {
		if (!this.ammoReady || !this.dynamicsWorld || !this.Ammo) return null;
		const Ammo = this.Ammo;
		const bodyA = this._objectToBody.get(objectA);
		const bodyB = this._objectToBody.get(objectB);
		if (!bodyA || !bodyB) return null;
		const trA = new Ammo.btTransform(); trA.setIdentity();
		const trB = new Ammo.btTransform(); trB.setIdentity();
		const c = new Ammo.btFixedConstraint(bodyA, bodyB, trA, trB);
		this.dynamicsWorld.addConstraint(c, true);
		this._joints.push({ constraint: c, type: "fixed", a: objectA, b: objectB });
		return c;
	}

	addSliderJoint(objectA, objectB, {
		frameA = { origin: [0, 0, 0], axisX: [1, 0, 0], axisZ: [0, 0, 1] },
		frameB = { origin: [0, 0, 0], axisX: [1, 0, 0], axisZ: [0, 0, 1] },
		linearLimits = undefined,  // [min, max]
		angularLimits = undefined, // [min, max]
	} = {}) {
		if (!this.ammoReady || !this.dynamicsWorld || !this.Ammo) return null;
		const Ammo = this.Ammo;
		const bodyA = this._objectToBody.get(objectA);
		const bodyB = this._objectToBody.get(objectB);
		if (!bodyA || !bodyB) return null;
		const trA = new Ammo.btTransform(); trA.setIdentity();
		const trB = new Ammo.btTransform(); trB.setIdentity();
		const setFrame = (tr, f) => {
			const o = f.origin || [0, 0, 0];
			tr.setOrigin(new Ammo.btVector3(o[0] || 0, o[1] || 0, o[2] || 0));
			// Build basis from X/Z and derive Y
			const x = f.axisX || [1, 0, 0];
			const z = f.axisZ || [0, 0, 1];
			const basis = new Ammo.btMatrix3x3(
				x[0] || 1, x[1] || 0, x[2] || 0,
				0, 1, 0,
				z[0] || 0, z[1] || 0, z[2] || 1
			);
			tr.setBasis(basis);
		};
		setFrame(trA, frameA || {});
		setFrame(trB, frameB || {});
		const c = new Ammo.btSliderConstraint(bodyA, bodyB, trA, trB, true);
		if (Array.isArray(linearLimits) && linearLimits.length >= 2) {
			try { c.setLowerLinLimit(Number(linearLimits[0]) || 0); c.setUpperLinLimit(Number(linearLimits[1]) || 0); } catch {}
		}
		if (Array.isArray(angularLimits) && angularLimits.length >= 2) {
			try { c.setLowerAngLimit(Number(angularLimits[0]) || 0); c.setUpperAngLimit(Number(angularLimits[1]) || 0); } catch {}
		}
		this.dynamicsWorld.addConstraint(c, true);
		this._joints.push({ constraint: c, type: "slider", a: objectA, b: objectB });
		return c;
	}

	addConeTwistJoint(objectA, objectB, {
		frameA = { origin: [0, 0, 0] },
		frameB = { origin: [0, 0, 0] },
		limits = { swingSpan1: Math.PI / 4, swingSpan2: Math.PI / 4, twistSpan: Math.PI / 6 },
	} = {}) {
		if (!this.ammoReady || !this.dynamicsWorld || !this.Ammo) return null;
		const Ammo = this.Ammo;
		const bodyA = this._objectToBody.get(objectA);
		const bodyB = this._objectToBody.get(objectB);
		if (!bodyA || !bodyB) return null;
		const trA = new Ammo.btTransform(); trA.setIdentity();
		const trB = new Ammo.btTransform(); trB.setIdentity();
		const oA = frameA.origin || [0, 0, 0];
		const oB = frameB.origin || [0, 0, 0];
		trA.setOrigin(new Ammo.btVector3(oA[0] || 0, oA[1] || 0, oA[2] || 0));
		trB.setOrigin(new Ammo.btVector3(oB[0] || 0, oB[1] || 0, oB[2] || 0));
		const c = new Ammo.btConeTwistConstraint(bodyA, bodyB, trA, trB);
		if (limits) {
			try {
				c.setLimit(
					typeof limits.swingSpan1 === "number" ? limits.swingSpan1 : Math.PI / 4,
					typeof limits.swingSpan2 === "number" ? limits.swingSpan2 : Math.PI / 4,
					typeof limits.twistSpan === "number" ? limits.twistSpan : Math.PI / 6
				);
			} catch {}
		}
		this.dynamicsWorld.addConstraint(c, true);
		this._joints.push({ constraint: c, type: "cone", a: objectA, b: objectB });
		return c;
	}
	removeJoint(constraint) {
		if (!constraint || !this.dynamicsWorld) return;
		try { this.dynamicsWorld.removeConstraint(constraint); } catch {}
		this._joints = this._joints.filter(j => j.constraint !== constraint);
	}

  _collectWorldPoints(object3D, { mergeChildren = true } = {}) {
    const pts = [];
    object3D.updateWorldMatrix(true, true);
    object3D.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      const pos = o.geometry.getAttribute("position");
      if (!pos) return;
      const m = o.matrixWorld;
      const v = new Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m);
        pts.push(v.clone());
      }
      if (!mergeChildren) {
        // no-op here; caller will treat as single hull; we keep all points
      }
    });
    return pts;
  }

  _boundsForObject(object3D) {
    const pts = this._collectWorldPoints(object3D, { mergeChildren: true });
    const min = new Vector3(+Infinity, +Infinity, +Infinity);
    const max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (p.x < min.x) min.x = p.x; if (p.y < min.y) min.y = p.y; if (p.z < min.z) min.z = p.z;
      if (p.x > max.x) max.x = p.x; if (p.y > max.y) max.y = p.y; if (p.z > max.z) max.z = p.z;
    }
    if (!isFinite(min.x)) {
      // fallback 1x1x1 at origin
      return { min: new Vector3(-0.5, -0.5, -0.5), max: new Vector3(0.5, 0.5, 0.5) };
    }
    return { min, max };
  }

  _ammoRaycast(origin, direction, maxDistance) {
    if (!this.ammoReady || !this.dynamicsWorld || !this.Ammo) return null;
    const Ammo = this.Ammo;
    try {
      const dir = direction.clone().normalize();
      const from = new Ammo.btVector3(origin.x, origin.y, origin.z);
      const toP = origin.clone().addScaledVector(dir, maxDistance);
      const to = new Ammo.btVector3(toP.x, toP.y, toP.z);
      const cb = new Ammo.ClosestRayResultCallback(from, to);
      this.dynamicsWorld.rayTest(from, to, cb);
      if (cb.hasHit && cb.hasHit()) {
        const hp = cb.get_m_hitPointWorld();
        const hn = cb.get_m_hitNormalWorld();
        const point = new Vector3(hp.x(), hp.y(), hp.z());
        const normal = new Vector3(hn.x(), hn.y(), hn.z()).normalize();
        const frac = cb.get_m_closestHitFraction ? cb.get_m_closestHitFraction() : origin.distanceTo(point) / maxDistance;
        const distance = Math.max(0, Math.min(maxDistance, maxDistance * frac));
        return { distance, point, face: { normal }, object: null };
      }
      return null;
    } catch (_e) {
      return null;
    }
  }
}

// --------------------------
// Module-level Ammo singleton
// --------------------------
let __ammoReady = false;
let __Ammo = null;
let __dynamicsWorld = null;
let __subsystems = null;

export async function ensureAmmo(options = {}) {
  if (__ammoReady && __dynamicsWorld) return { Ammo: __Ammo, world: __dynamicsWorld };
  try {
    let Ammo = null;
    try {
      const mod = await import('ammo.js');
      const MaybeFactory = (mod && (mod.default ?? mod)) || null;
      if (typeof MaybeFactory === "function") {
        Ammo = await MaybeFactory();
      } else if (MaybeFactory && typeof MaybeFactory.then === "function") {
        Ammo = await MaybeFactory;
      }
    } catch {}
    if (!Ammo && typeof AmmoFactory === "function") {
      Ammo = await AmmoFactory();
    } else if (!Ammo && AmmoFactory && typeof AmmoFactory.then === "function") {
      Ammo = await AmmoFactory;
    }
    if (!Ammo) throw new Error("Ammo module could not be initialized");
    __Ammo = Ammo;
    const collisionConfiguration = new Ammo.btDefaultCollisionConfiguration();
    const dispatcher = new Ammo.btCollisionDispatcher(collisionConfiguration);
    const broadphase = new Ammo.btDbvtBroadphase();
    const solver = new Ammo.btSequentialImpulseConstraintSolver();
    const world = new Ammo.btDiscreteDynamicsWorld(dispatcher, broadphase, solver, collisionConfiguration);
    const g = options && typeof options.gravity === "number" ? options.gravity : 9.8;
    world.setGravity(new Ammo.btVector3(0, -g, 0));
    __subsystems = { collisionConfiguration, dispatcher, broadphase, solver };
    __dynamicsWorld = world;
    __ammoReady = true;
    return { Ammo: __Ammo, world: __dynamicsWorld };
  } catch (e) {
    console.warn("Ammo.js initialization failed (module singleton).", e);
    __ammoReady = false;
    return { Ammo: null, world: null };
  }
}

export function stepAmmo(dt) {
  if (__ammoReady && __dynamicsWorld) {
    const maxSubSteps = 2;
    const fixedTimeStep = 1 / 60;
    __dynamicsWorld.stepSimulation(dt, maxSubSteps, fixedTimeStep);
  }
}

export async function addStaticConvex(points) {
  await ensureAmmo();
  if (!__ammoReady || !__dynamicsWorld || !__Ammo) return null;
  const Ammo = __Ammo;
  const shape = new Ammo.btConvexHullShape();
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const v = new Ammo.btVector3(p.x, p.y, p.z);
    shape.addPoint(v, true);
  }
  if (shape.optimizeConvexHull) shape.optimizeConvexHull();
  if (shape.initializePolyhedralFeatures) shape.initializePolyhedralFeatures();
  const transform = new Ammo.btTransform();
  transform.setIdentity();
  transform.setOrigin(new Ammo.btVector3(0, 0, 0));
  const motionState = new Ammo.btDefaultMotionState(transform);
  const mass = 0;
  const localInertia = new Ammo.btVector3(0, 0, 0);
  const rbInfo = new Ammo.btRigidBodyConstructionInfo(mass, motionState, shape, localInertia);
  const body = new Ammo.btRigidBody(rbInfo);
  __dynamicsWorld.addRigidBody(body);
  return body;
}

export function ammoRaycast(origin, direction, maxDistance) {
  if (!__ammoReady || !__dynamicsWorld || !__Ammo) return null;
  const Ammo = __Ammo;
  try {
    const dir = direction.clone().normalize();
    const from = new Ammo.btVector3(origin.x, origin.y, origin.z);
    const toP = origin.clone().addScaledVector(dir, maxDistance);
    const to = new Ammo.btVector3(toP.x, toP.y, toP.z);
    const cb = new Ammo.ClosestRayResultCallback(from, to);
    __dynamicsWorld.rayTest(from, to, cb);
    if (cb.hasHit && cb.hasHit()) {
      const hp = cb.get_m_hitPointWorld();
      const hn = cb.get_m_hitNormalWorld();
      const point = new Vector3(hp.x(), hp.y(), hp.z());
      const normal = new Vector3(hn.x(), hn.y(), hn.z()).normalize();
      const frac = cb.get_m_closestHitFraction ? cb.get_m_closestHitFraction() : origin.distanceTo(point) / maxDistance;
      const distance = Math.max(0, Math.min(maxDistance, maxDistance * frac));
      return { distance, point, face: { normal }, object: null };
    }
    return null;
  } catch (_e) {
    return null;
  }
}
