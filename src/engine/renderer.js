import { getInternalResolution } from "./engine.js";

// three.js via CDN ESM
import * as THREE from "https://unpkg.com/three@0.161.0/build/three.module.js";

export class RendererCore {
  constructor(canvas) {
    const { width, height } = getInternalResolution();
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height, false);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);

    const aspect = width / height;
    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 1000);
    this.camera.position.set(0, 0, 3);

    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshBasicMaterial({ color: 0x22cc88, wireframe: true });
    this.cube = new THREE.Mesh(geo, mat);
    this.scene.add(this.cube);

    // Render targets and post-process
    const rtParams = { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, format: THREE.RGBAFormat }; 
    this.colorTarget = new THREE.WebGLRenderTarget(width, height, rtParams);
    this.reducePass = new ColorReducePass(width, height);
  }

  getTriangleCount() {
    // Box: 12 triangles
    return 12;
  }

  update(dtSeconds) {
    this.cube.rotation.x += 0.5 * dtSeconds;
    this.cube.rotation.y += 0.7 * dtSeconds;
  }

  render() {
    // Render scene to offscreen target
    this.renderer.setRenderTarget(this.colorTarget);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);

    // Post: color reduce to default framebuffer
    this.renderer.setRenderTarget(null);
    this.reducePass.setInputTexture(this.colorTarget.texture);
    this.reducePass.render(this.renderer);
  }
}

// Inlined post-process pass
class ColorReducePass {
  constructor(width, height) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const geometry = new THREE.PlaneGeometry(2, 2);
    this.uniforms = {
      tDiffuse: { value: null },
      resolution: { value: new THREE.Vector2(width, height) },
    };

    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: `
        precision mediump float;
        varying vec2 vUv;
        uniform sampler2D tDiffuse;
        uniform vec2 resolution;

        float bayer4x4(vec2 p) {
          int x = int(mod(p.x, 4.0));
          int y = int(mod(p.y, 4.0));
          int idx = y * 4 + x;
          int m[16];
          m[0]=0; m[1]=8; m[2]=2; m[3]=10;
          m[4]=12; m[5]=4; m[6]=14; m[7]=6;
          m[8]=3; m[9]=11; m[10]=1; m[11]=9;
          m[12]=15; m[13]=7; m[14]=13; m[15]=5;
          return float(m[idx]) / 16.0;
        }

        vec3 quantize565(vec3 c, vec2 fragCoord) {
          float d = bayer4x4(fragCoord);
          vec3 dscale = vec3(1.0/32.0, 1.0/64.0, 1.0/32.0);
          vec3 cd = clamp(c + (d - 0.5) * dscale, 0.0, 1.0);
          float r = floor(cd.r * 31.0 + 0.5) / 31.0;
          float g = floor(cd.g * 63.0 + 0.5) / 63.0;
          float b = floor(cd.b * 31.0 + 0.5) / 31.0;
          return vec3(r, g, b);
        }

        void main() {
          vec2 uv = vUv;
          vec3 color = texture2D(tDiffuse, uv).rgb;
          vec2 fragCoord = gl_FragCoord.xy;
          vec3 q = quantize565(color, fragCoord);
          gl_FragColor = vec4(q, 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });

    this.quad = new THREE.Mesh(geometry, material);
    this.scene.add(this.quad);
  }

  setSize(width, height) {
    this.uniforms.resolution.value.set(width, height);
  }

  setInputTexture(tex) {
    this.uniforms.tDiffuse.value = tex || null;
  }

  render(renderer) {
    renderer.render(this.scene, this.camera);
  }
}
