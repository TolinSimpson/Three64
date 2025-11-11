'use strict';
import {
  Vector3,
  CylinderGeometry,
  MeshLambertMaterial,
  PlaneGeometry,
  BoxGeometry,
  Mesh,
  Color,
} from "three";
import { ParticleSystem } from "../particleSystem.js";
import { Component, ComponentRegistry } from "../component.js";

class FeatureShowcase extends Component {
  constructor(ctx) {
    super(ctx);
  }

  Initialize() {
    const app = this.game;
    const { scene, camera } = app.rendererCore;

    const pos = new Vector3();
    this.object.getWorldPosition(pos);
    const baseX = pos.x || 0;
    const baseZ = pos.z || 0;

    const width = 30, depth = 12;
    const room = new Mesh(
      new PlaneGeometry(width, depth, 1, 1),
      new MeshLambertMaterial({ color: 0xf0f0f0 })
    );
    room.rotation.x = -Math.PI / 2;
    room.position.set(baseX, 0, baseZ);
    scene.add(room);
    const wallMat = new MeshLambertMaterial({ color: 0xffffff });
    const wallGeo = new BoxGeometry(width, 3, 0.25);
    const backWall = new Mesh(wallGeo, wallMat);
    backWall.position.set(baseX, 1.5, baseZ - depth / 2);
    scene.add(backWall);

    const padSpacing = 8;
    const zones = {
      geometry: { x: baseX - padSpacing },
      particles: { x: baseX + 0 },
      audio: { x: baseX + padSpacing },
    };
    const addMarkerX = (x, color) => {
      const post = new Mesh(
        new CylinderGeometry(0.05, 0.05, 1.2, 8),
        new MeshLambertMaterial({ color })
      );
      post.position.set(x, 0.6, baseZ - 3.2);
      scene.add(post);
      const post2 = post.clone();
      post2.position.set(x, 0.6, baseZ - 0.8);
      scene.add(post2);
    };
    addMarkerX(zones.geometry.x, new Color(0x22cc88));
    addMarkerX(zones.particles.x, new Color(0xccaa22));
    addMarkerX(zones.audio.x, new Color(0xaa2244));

    const cube = new Mesh(
      new BoxGeometry(1, 1, 1),
      new MeshLambertMaterial({ color: 0x22cc88 })
    );
    cube.position.set(zones.geometry.x, 0.75, baseZ - 2);
    scene.add(cube);
    app.onUpdate((dt) => {
      cube.rotation.y += 0.8 * dt;
      cube.rotation.x += 0.3 * dt;
    });

    const particles = new ParticleSystem({});
    particles.addToScene(scene);
    particles.setCamera(camera);
    // Prime some particles so they are visible immediately
    for (let i = 0; i < 48; i++) {
      const x = zones.particles.x + (Math.random() - 0.5) * 2.0;
      const y = 1 + Math.random() * 0.5;
      const z = baseZ - 2 + (Math.random() - 0.5) * 2.0;
      particles.spawn(new Vector3(x, y, z), 0.2 + Math.random() * 0.3);
      app.budget.addParticles(1);
    }
    let spawnTimer = 0;
    app.onUpdate((dt) => {
      spawnTimer -= dt;
      if (spawnTimer <= 0) {
        spawnTimer = 0.05;
        const x = zones.particles.x + (Math.random() - 0.5) * 2.0;
        const y = 1 + Math.random() * 0.5;
        const z = baseZ - 2 + (Math.random() - 0.5) * 2.0;
        particles.spawn(new Vector3(x, y, z), 0.2 + Math.random() * 0.3);
        app.budget.addParticles(1);
      }
      particles.update(dt);
      app.budget.addTriangles(particles.getTriangleContribution());
    });
  }
}

export default FeatureShowcase;

// Register for registry-based userData components
ComponentRegistry.register("featureShowcase", FeatureShowcase);
ComponentRegistry.register("feature-showcase", FeatureShowcase);


