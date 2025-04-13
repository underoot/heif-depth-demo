import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import libheif from "./libheif/index.js";

const mouseCoordinates = new THREE.Vector2(0, 0);

const depthInput = document.querySelector("#depthInput")!;
const imageInput = document.querySelector("#imageInput")!;

let fileDefined = false;

window.addEventListener("mousemove", (event) => {
  mouseCoordinates.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouseCoordinates.y = -(event.clientY / window.innerHeight) * 2 + 1;
});

export class FBO {
  #scene: THREE.Scene;
  #camera: THREE.OrthographicCamera;
  #rtt: THREE.WebGLRenderTarget;
  #mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
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

    this.#mesh = new THREE.Mesh(bufferGeometry, simulationMaterial);

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

    depthInput.addEventListener("change", async (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const heicBuffer = await file.arrayBuffer();
      const decoder = new libheif.HeifDecoder();
      const [heifImage] = decoder.decode(heicBuffer);
      const auxImageIds =
        libheif.heif_js_image_handle_get_list_of_aux_image_IDs(
          heifImage.handle
        );

      let depthImage;

      let canvas = document.createElement("canvas");
      canvas.width = heifImage.get_width();
      canvas.height = heifImage.get_height();

      let ctx = canvas.getContext("2d")!;

      let imageData = ctx.createImageData(
        heifImage.get_width(),
        heifImage.get_height()
      );

      await new Promise<void>((resolve, reject) => {
        heifImage.display(imageData, (displayData) => {
          if (!displayData) {
            return reject(new Error("HEIF processing error"));
          }

          resolve();
        });
      });

      for (let auxID of auxImageIds) {
        const auxImage = new libheif.HeifImage(
          libheif.heif_js_context_get_image_handle(decoder.decoder, auxID)
        );

        if (
          libheif.heif_js_image_handle_get_auxiliary_type(auxImage.handle) ===
          "urn:mpeg:hevc:2015:auxid:2"
        ) {
          depthImage = auxImage;
          break;
        }
      }

      canvas = document.createElement("canvas");
      ctx = canvas.getContext("2d")!;

      canvas.width = depthImage.get_width();
      canvas.height = depthImage.get_height();
      const depthData = ctx.createImageData(
        depthImage.get_width(),
        depthImage.get_height()
      );

      await new Promise<void>((resolve, reject) => {
        depthImage.display(depthData, (displayData) => {
          if (!displayData) {
            return reject(new Error("HEIF processing error"));
          }

          resolve();
        });
      });

      const width = heifImage.get_width();
      const height = heifImage.get_height();
      const depthWidth = depthImage.get_width();
      const depthHeight = depthImage.get_height();

      console.log(width, height, depthWidth, depthHeight);

      const data = new Float32Array(width * height * 4);

      for (let i = 0; i < data.length; i += 4) {
        const x = Math.floor(i / 4);

        const depthX = Math.floor(((x % width) / width) * depthWidth);
        const depthY = Math.floor((x / width / height) * depthHeight);

        data[i] = (x % width) / width;
        data[i + 1] = 1 - x / width / height;
        data[i + 2] =
          depthData.data[depthY * depthWidth * 4 + depthX * 4] / 255;

        if (Number.isNaN(data[i + 2])) {
          data[i + 2] = 0;
        }

        data[i + 3] =
          imageData.data[i] +
          (imageData.data[i + 1] << 8) +
          (imageData.data[i + 2] << 16);
      }

      fileDefined = true;

      const positions = new THREE.DataTexture(
        data,
        width,
        height,
        THREE.RGBAFormat,
        THREE.FloatType
      );
      positions.needsUpdate = true;

      this.#mesh.material.uniforms.positions.value = positions;
    });
  }

  update() {
    this.#renderer.setRenderTarget(this.#rtt);
    this.#renderer.render(this.#scene, this.#camera);
    this.#renderer.setRenderTarget(null);

    if (!fileDefined) {
      this.particles.material.uniforms.positions.value = this.#rtt.texture;
    }

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

  camera.position.z = 5;

  renderer = new THREE.WebGLRenderer();
  renderer.setSize(w, h);
  document.body.appendChild(renderer.domElement);

  const width = 512;
  const height = 512;

  const data = getRandomData(width, height, 512);

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
      pointSize: { value: 1 },
      timestamp: { value: 0 },
      mouseCoordinates: { value: new THREE.Vector2(0, 0) },
    },
    vertexShader: `
      #define PI 3.1415926535897932384626433832795

      out vec3 vColor;

      uniform sampler2D positions;
      uniform float pointSize;
      uniform float timestamp;
      uniform vec2 mouseCoordinates;

      void main() {
        vec4 pos = texture2D(positions, position.xy);
        int color = int(pos.a);

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
        gl_FragColor = vec4(vColor, 1.0);
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
