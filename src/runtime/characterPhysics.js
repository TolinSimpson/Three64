import { Vector3 } from "three";

export function resolveCharacterPhysics(physicsWorld, controller, desiredMove, dt) {
  // Step world to keep queries in sync
  physicsWorld.step(dt);
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
  const downHit = physicsWorld.raycast(head, new Vector3(0, -1, 0), eyeHeight + 10);
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
      const h = physicsWorld.raycast(o, dir, dist);
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
    const upHit = physicsWorld.raycast(head, up, controller.velY * dt + 0.1);
    if (upHit) controller.velY = 0;
  }
}

