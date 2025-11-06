import * as THREE from "https://unpkg.com/three@0.161.0/build/three.module.js";
import { createSkybox } from "../skybox.js";
import { Scene } from "../scene.js";

export default class DefaultScene extends Scene {
  static get assets() {
    return [
      {
        type: "gltf",
        url: "./default-scene.glb",
        physics: { collider: "convex", mergeChildren: true, visible: false }
      }
    ];
  }

  init() {
    const { scene, camera } = this.rendererCore;
    const light = new THREE.DirectionalLight(0xffffff, 0.8);
    light.position.set(1, 1, 1);
    scene.add(light);
    scene.add(new THREE.AmbientLight(0x404040, 0.5));

    const sky = createSkybox(camera);
    scene.add(sky);
    this.onUpdate(() => sky.position.copy(camera.position));
  }
}

