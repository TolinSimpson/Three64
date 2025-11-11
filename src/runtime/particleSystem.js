'use strict';
import {
  DataTexture,
  RGBAFormat,
  PlaneGeometry,
  InstancedBufferGeometry,
  InstancedMesh,
  MeshBasicMaterial,
  Vector3,
  TextureLoader,
  Matrix4,
  Quaternion,
  DynamicDrawUsage,
  NearestFilter,
  NormalBlending,
} from "three";
import { config } from "./engine.js";

export class ParticleSystem {
  constructor({ atlasTexture }) {
    this.atlas = atlasTexture || null;
    this.camera = null;
    this.maxParticles = config.expansionPak
      ? config.budgets.particles.maxActiveExpansion
      : config.budgets.particles.maxActiveBase;
    this.count = 0;
    this._positions = new Array(this.maxParticles);
    this._scales = new Array(this.maxParticles);

    const quadGeo = new PlaneGeometry(1, 1);
    this.geometry = new InstancedBufferGeometry().copy(quadGeo);
    this.geometry.instanceCount = this.maxParticles;

    const placeholder = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, RGBAFormat);
    placeholder.needsUpdate = true;
    const mat = new MeshBasicMaterial({
      map: this.atlas || placeholder,
      transparent: true,
      blending: NormalBlending,
      depthWrite: false,
    });
    this.mesh = new InstancedMesh(quadGeo, mat, this.maxParticles);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);

    // Load fallback atlas if none provided (dynamic import for asset URL)
    if (!this.atlas) {
      (async () => {
        try {
          const mod = await import('../assets/textures/default-particle.png');
          const url = (mod && mod.default) || mod;
          const loader = new TextureLoader();
          loader.load(
            url,
            (tex) => {
              tex.minFilter = NearestFilter;
              tex.magFilter = NearestFilter;
              tex.generateMipmaps = false;
              this.atlas = tex;
              if (this.mesh && this.mesh.material) {
                this.mesh.material.map = tex;
                this.mesh.material.needsUpdate = true;
              }
            },
            undefined,
            () => {}
          );
        } catch {}
      })();
    }
  }

  setCamera(camera) {
    this.camera = camera || null;
  }

  addToScene(scene) {
    scene.add(this.mesh);
  }

  spawn(position, scale = 1) {
    if (this.count >= this.maxParticles) return false;
    const idx = this.count++;
    this._positions[idx] = position.clone();
    this._scales[idx] = scale;
    const m = new Matrix4();
    const q = this.camera ? this.camera.quaternion : new Quaternion();
    m.compose(position, q, new Vector3(scale, scale, scale));
    this.mesh.setMatrixAt(idx, m);
    this.mesh.instanceMatrix.needsUpdate = true;
    return true;
  }

  update(dt) {
    // Billboard to camera each frame
    if (this.camera && this.count > 0) {
      const q = this.camera.quaternion;
      const m = new Matrix4();
      const s = new Vector3();
      for (let i = 0; i < this.count; i++) {
        const p = this._positions[i];
        const k = this._scales[i] ?? 1;
        s.set(k, k, k);
        m.compose(p, q, s);
        this.mesh.setMatrixAt(i, m);
      }
      this.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  getTriangleContribution() {
    return this.count * (config.budgets.particles.trisPerQuad || 0);
  }
}
