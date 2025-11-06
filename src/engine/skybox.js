import * as THREE from "https://unpkg.com/three@0.161.0/build/three.module.js";

export function createSkybox(camera, {
  size = 200,
  topColor = 0x6fb6ff,
  bottomColor = 0xded7b0,
  offset = 0.0,
  exponent = 0.6,
} = {}) {
  const geometry = new THREE.BoxGeometry(size, size, size);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      topColor: { value: new THREE.Color(topColor) },
      bottomColor: { value: new THREE.Color(bottomColor) },
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
    side: THREE.BackSide,
    depthWrite: false,
  });

  const sky = new THREE.Mesh(geometry, material);
  sky.frustumCulled = false;
  sky.position.copy(camera.position);
  return sky;
}


