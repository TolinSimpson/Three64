'use strict';
import { Group, Raycaster, Vector3, MeshBasicMaterial, Mesh } from "three";
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

  // Resolve player movement with gravity and sliding along surfaces.
  // Controller must expose: position (Vector3), eyeHeight (number), velY (number), grounded (bool)
  resolvePlayer(controller, desiredMove, dt) {
    // Step world to keep queries in sync
    this.step(dt);
    const up = new Vector3(0, 1, 0);
    const pos = controller.position;
    const eyeHeight = controller.eyeHeight || 1.6;
    const radius = 0.4; // capsule radius for player rigid body
    const stepSnap = 0.3; // how far we snap to ground when falling
    const EPS = 1e-4;

    // Vertical: apply gravity then try to snap to ground
    controller.velY -= (controller.gravity ?? 9.8) * dt;

    // Downward ray from head to detect ground
    const head = pos.clone().addScaledVector(up, eyeHeight);
    const downHit = this.raycast(head, new Vector3(0, -1, 0), eyeHeight + 10);
    let groundY = null;
    if (downHit) groundY = downHit.point.y;

    // Predict vertical motion
    let newY = pos.y + controller.velY * dt;
    let grounded = false;
    if (groundY !== null) {
      const feetToGround = Math.max(0, pos.y - groundY);
      const nearGround = feetToGround <= stepSnap + 1e-3;
      const falling = controller.velY <= 0;
      // Only snap when close to ground AND falling; never while rising or high above
      if (nearGround && falling && head.y >= groundY) {
        newY = groundY;
        controller.velY = 0;
        grounded = true;
      }
    }
    pos.y = newY;
    controller.grounded = grounded;

    // Helper: closest hit among capsule samples (feet/mid/head)
    const sampleHeights = [Math.min(radius + 0.02, eyeHeight * 0.33), Math.min(eyeHeight * 0.5, 0.9), Math.max(eyeHeight - radius - 0.02, eyeHeight * 0.7)];
    const capsuleRaycast = (originBase, dir, dist) => {
      let best = null;
      for (let i = 0; i < sampleHeights.length; i++) {
        const o = originBase.clone().addScaledVector(up, sampleHeights[i]);
        const h = this.raycast(o, dir, dist);
        if (!h) continue;
        if (!best || h.distance < best.distance) best = h;
      }
      return best;
    };

    // Substep horizontal movement to avoid tunneling
    let remainingLen = desiredMove.length();
    if (remainingLen > EPS) {
      let dir = desiredMove.clone().multiplyScalar(1 / remainingLen);
      const maxStep = 0.25; // meters per substep
      let subRemaining = remainingLen;
      const originBase = pos.clone();
      while (subRemaining > EPS) {
        const stepLen = Math.min(maxStep, subRemaining);
        let stepRemaining = stepLen;
        let iterations = 0;
        // Iterate slide resolution a few times per substep
        while (stepRemaining > EPS && iterations < 3) {
          iterations++;
          const hit = capsuleRaycast(originBase, dir, stepRemaining + radius);
          if (hit && hit.distance < stepRemaining + radius - EPS) {
            const n = hit.face?.normal?.clone?.() || new Vector3(0, 1, 0);
            const forwardAllowed = Math.max(0, hit.distance - radius);
            if (forwardAllowed > EPS) {
              pos.addScaledVector(dir, forwardAllowed);
            }
            const consumed = forwardAllowed;
            stepRemaining -= consumed;
            subRemaining -= consumed;
            // Slide along plane for the rest of this substep
            if (stepRemaining > EPS) {
              if (dir.dot(n) > 0) n.multiplyScalar(-1);
              const slideDir = dir.clone().addScaledVector(n, -dir.dot(n));
              const sLen = slideDir.length();
              if (sLen > EPS) dir.copy(slideDir.multiplyScalar(1 / sLen)); else break;
            }
          } else {
            pos.addScaledVector(dir, stepRemaining);
            subRemaining -= stepRemaining;
            stepRemaining = 0;
          }
        }
        // Update origin base for next substep
        originBase.copy(pos);
        if (iterations >= 3) {
          // Prevent infinite attempts; stop this substep
          // Remaining distance will be tried in next substep with updated dir
        }
      }
    }

    // Ceiling check (prevent camera/eye clipping upward)
    if (controller.velY > 0) {
      const upHit = this.raycast(head, up, controller.velY * dt + 0.1);
      if (upHit) controller.velY = 0;
    }
  }

  // Step Ammo world if ready
  step(dt) {
    if (this.ammoReady && this.dynamicsWorld) {
      const maxSubSteps = 2;
      const fixedTimeStep = 1 / 60;
      this.dynamicsWorld.stepSimulation(dt, maxSubSteps, fixedTimeStep);
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
