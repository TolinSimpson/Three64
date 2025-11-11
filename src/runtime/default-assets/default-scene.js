'use strict';
import { DirectionalLight, AmbientLight } from "three";
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
    const light = new DirectionalLight(0xffffff, 0.8);
    light.position.set(1, 1, 1);
    scene.add(light);
    scene.add(new AmbientLight(0x404040, 0.5));

    const sky = createSkybox(camera);
    scene.add(sky);
    this.onUpdate(() => sky.position.copy(camera.position));
  }
}

