'use strict';
import { BoxGeometry, ShaderMaterial, Color, BackSide, Mesh } from "three";

export function createSkybox(camera, {
  size = 200,
  topColor = 0x6fb6ff,
  bottomColor = 0xded7b0,
  offset = 0.0,
  exponent = 0.6,
} = {}) {
  const geometry = new BoxGeometry(size, size, size);
  const material = new ShaderMaterial({
    uniforms: {
      topColor: { value: new Color(topColor) },
      bottomColor: { value: new Color(bottomColor) },
      offset: { value: offset },
      exponent: { value: exponent },
    },
    vertexShader: `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 bottomColor;
      uniform float offset;
      uniform float exponent;
      varying vec3 vWorldPosition;
      void main() {
        float h = normalize(vWorldPosition + vec3(0.0, offset, 0.0)).y;
        float t = pow(max(h, 0.0), exponent);
        vec3 color = mix(bottomColor, topColor, t);
        gl_FragColor = vec4(color, 1.0);
      }
    `,
    side: BackSide,
    depthWrite: false,
  });

  const sky = new Mesh(geometry, material);
  sky.frustumCulled = false;
  sky.position.copy(camera.position);
  return sky;
}


