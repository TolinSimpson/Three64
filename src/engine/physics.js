import * as THREE from "https://unpkg.com/three@0.161.0/build/three.module.js";
import { ConvexGeometry } from "https://unpkg.com/three@0.161.0/examples/jsm/geometries/ConvexGeometry.js";

// Minimal physics: static convex colliders, simple raycasts, gravity, and slide.
export class PhysicsWorld {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.debug = options.debug === true;
    this.colliders = [];
    this.colliderGroup = new THREE.Group();
    this.colliderGroup.name = "PhysicsColliders";
    this.scene.add(this.colliderGroup);

    this.raycaster = new THREE.Raycaster();
    this.raycaster.firstHitOnly = true;

    // Optional infinite ground plane at y=0 (classic N64 simple ground)
    this.groundY = options.groundY ?? 0;
    this.enableGroundPlane = options.enableGroundPlane !== false;
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
      const v = new THREE.Vector3();
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
    const mat = material || new THREE.MeshBasicMaterial({ color: 0x00ffff, wireframe: true, transparent: true, opacity: 0.15 });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.matrixAutoUpdate = false; // baked in world space
    mesh.visible = this.debug || visible === true;
    this.colliderGroup.add(mesh);
    this.colliders.push(mesh);
  }

  // Simple raycast against colliders and optional ground plane at y=0.
  raycast(origin, direction, maxDistance = 100) {
    const dir = direction.clone().normalize();
    this.raycaster.set(origin, dir);
    this.raycaster.far = maxDistance;
    let closest = null;

    // Mesh hits
    const hits = this.raycaster.intersectObjects(this.colliders, false);
    if (hits.length > 0) closest = hits[0];

    // Ground plane hit
    if (this.enableGroundPlane) {
      if (Math.abs(dir.y) > 1e-5) {
        const t = (this.groundY - origin.y) / dir.y;
        if (t >= 0 && t <= maxDistance) {
          const p = origin.clone().addScaledVector(dir, t);
          const groundHit = {
            distance: t,
            point: p,
            face: { normal: new THREE.Vector3(0, 1, 0) },
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
    const up = new THREE.Vector3(0, 1, 0);
    const pos = controller.position;
    const eyeHeight = controller.eyeHeight || 1.6;
    const radius = 0.4; // capsule radius for player rigid body
    const stepSnap = 0.3; // how far we snap to ground when falling
    const EPS = 1e-4;

    // Vertical: apply gravity then try to snap to ground
    controller.velY -= (controller.gravity ?? 9.8) * dt;

    // Downward ray from head to detect ground
    const head = pos.clone().addScaledVector(up, eyeHeight);
    const downHit = this.raycast(head, new THREE.Vector3(0, -1, 0), eyeHeight + 10);
    let groundY = null;
    if (downHit) groundY = downHit.point.y;

    // Predict vertical motion
    let newY = pos.y + controller.velY * dt;
    let grounded = false;
    if (groundY !== null) {
      const feetToGround = Math.max(0, pos.y - groundY);
      const fallDist = pos.y - newY; // positive when falling
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
            const n = hit.face?.normal?.clone?.() || new THREE.Vector3(0, 1, 0);
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
}
