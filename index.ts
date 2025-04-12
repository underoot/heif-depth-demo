import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export class FBO {
  #scene: THREE.Scene;
  #camera: THREE.OrthographicCamera;
  #rtt: THREE.WebGLRenderTarget;
  #renderer: THREE.WebGLRenderer;

  particles: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;

  constructor(
    width: number,
    height: number,
    renderer: THREE.WebGLRenderer,
    simulationMaterial: THREE.ShaderMaterial,
    renderMaterial: THREE.ShaderMaterial
  ) {
    renderer.getContext().getExtension("EXT_float_blend");

    this.#scene = new THREE.Scene();
    this.#camera = new THREE.OrthographicCamera(
      -1,
      1,
      1,
      -1,
      1 / Math.pow(2, 53),
      1
    );

    const options: THREE.RenderTargetOptions = {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: THREE.FloatType,
    };

    this.#rtt = new THREE.WebGLRenderTarget(width, height, options);
    this.#renderer = renderer;

    const bufferGeometry = new THREE.BufferGeometry();

    bufferGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(
        // prettier-ignore
        new Float32Array([
          -1, -1, 0, 
          1, -1, 0, 
          1, 1, 0,
          -1, -1, 0,
          1, 1, 0,
          -1, 1, 0
        ]),
        3
      )
    );

    bufferGeometry.setAttribute(
      "uv",
      new THREE.BufferAttribute(
        // prettier-ignore
        new Float32Array([
          0, 1,
          1, 1,
          1, 0,
          0, 1,
          1, 0,
          0, 0
        ]),
        2
      )
    );

    this.#scene.add(new THREE.Mesh(bufferGeometry, simulationMaterial));

    const l = width * height;
    const vertices = new Float32Array(l * 3);

    for (let i = 0; i < l; i++) {
      const i3 = i * 3;
      vertices[i3] = (i % width) / width;
      vertices[i3 + 1] = i / width / height;
    }

    const geometry = new THREE.BufferGeometry();

    geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));

    this.particles = new THREE.Points(geometry, renderMaterial);
  }

  update() {
    this.#renderer.setRenderTarget(this.#rtt);
    this.#renderer.render(this.#scene, this.#camera);
    this.#renderer.setRenderTarget(null);
    this.particles.material.uniforms.positions.value = this.#rtt.texture;
    this.particles.material.uniforms.timestamp.value = performance.now();
  }
}

function getRandomData(width: number, height: number, size: number) {
  let len = width * height * 4;
  const data = new Float32Array(len);

  while ((len -= 4)) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(Math.random() * 2 - 1);
    const x = size * Math.sin(phi) * Math.cos(theta);
    const y = size * Math.sin(phi) * Math.sin(theta);
    const z = size * Math.cos(phi);
    const i = len + 4;
    data[i] = x;
    data[i + 1] = y;
    data[i + 2] = z;
    data[i + 3] =
      Math.random() * 255 +
      ((Math.random() * 255) << 8) +
      ((Math.random() * 255) << 16);
  }

  return data;
}

let fbo: FBO;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let renderer: THREE.WebGLRenderer;

function init() {
  const w = window.innerWidth;
  const h = window.innerHeight;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(60, w / h, 1, 10000);

  camera.position.z = 600;

  renderer = new THREE.WebGLRenderer();
  renderer.setSize(w, h);
  document.body.appendChild(renderer.domElement);

  const width = 256;
  const height = 256;

  const data = getRandomData(width, height, 256);

  const positions = new THREE.DataTexture(
    data,
    width,
    height,
    THREE.RGBAFormat,
    THREE.FloatType
  );

  positions.needsUpdate = true;

  const simulationShader = new THREE.ShaderMaterial({
    uniforms: { positions: { value: positions } },
    vertexShader: `
      out vec2 vUv;

      void main() {
        vUv = vec2(uv.x, uv.y);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D positions;
      in vec2 vUv;

      void main() {
        gl_FragColor = texture2D(positions, vUv);
      }
    `,
  });

  const renderShader = new THREE.ShaderMaterial({
    uniforms: {
      positions: { value: null },
      pointSize: { value: 2 },
      timestamp: { value: 0 },
    },
    vertexShader: `
      #define PI 3.1415926535897932384626433832795

      out vec3 vColor;

      uniform sampler2D positions;
      uniform float pointSize;
      uniform float timestamp;

      vec2 cartesianToSpherical(vec3 v) {
        float r = length(v);                      // distance from origin
        float theta = atan(v.y, v.x);             // azimuthal angle (longitude)
        float phi = acos(clamp(v.z / r, -1.0, 1.0)); // polar angle (colatitude)
        return vec2(theta, phi);
    }

      void main() {
        vec4 pos = texture2D(positions, position.xy);
        int color = int(pos.a);

        // Make waves on sphere
        vec2 spherical = cartesianToSpherical(pos.xyz);
        float theta_n = spherical.x + PI;
        float phi_n = spherical.y;

        pos += sin(theta_n * 30.0 * sin(timestamp * 0.0001)) / cos(phi_n * 30.0) * 10.0;


        vColor = vec3(
          float(color & 255) / 255.,
          float(color >> 8 & 255) / 255.,
          float(color >> 16 & 255) / 255.
        );

        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos.rgb, 1.0);
        gl_PointSize = pointSize;
      }
    `,
    fragmentShader: `
      in vec3 vColor;

      void main() {
        gl_FragColor = vec4(vColor, .25);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
  });

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  controls.dampingFactor = 0.25;

  fbo = new FBO(width, height, renderer, simulationShader, renderShader);
  scene.add(fbo.particles);
  window.addEventListener("resize", onResize, false);
  update();
}

function update() {
  requestAnimationFrame(update);
  fbo.update();
  renderer.render(scene, camera);
}

function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;

  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

init();
