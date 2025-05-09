import {
  AdditiveBlending,
  DataTexture,
  WebGLRenderer,
  Scene,
  OrthographicCamera,
  WebGLRenderTarget,
  Mesh,
  Points,
  BufferGeometry,
  BufferAttribute,
  ShaderMaterial,
  NearestFilter,
  RGBAFormat,
  FloatType,
  PerspectiveCamera,
  type RenderTargetOptions,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import libheif from "./libheif/index.js";

const helpBtn = document.getElementById("helpBtn")!;
const helpBtn2 = document.getElementById("helpBtn2")!;
const modal = document.getElementById("modal")!;
const errorModal = document.getElementById("errorModal")!;
const closeErrorModal = document.getElementById("closeErrorModal")!;
const closeModal = document.getElementById("closeModal")!;
const tabButtons = document.querySelectorAll(".tab-button")!;
const tabPanels = document.querySelectorAll(".tab-panel")!;
const form = document.getElementById("form")!;
const arrow = document.querySelector(".arrow")!;
const shareBtn = document.getElementById("shareBtn")!;
const canvasEl = document.getElementById("canvas")!;

arrow.addEventListener("click", () => {
  form.classList.toggle("folded");
});

helpBtn.addEventListener("click", () => {
  modal.classList.remove("hidden");
});

helpBtn2.addEventListener("click", () => {
  modal.classList.remove("hidden");
});

closeModal.addEventListener("click", () => {
  modal.classList.add("hidden");
});

closeErrorModal.addEventListener("click", () => {
  errorModal.classList.add("hidden");
});

// @ts-ignore
if (
  navigator.canShare &&
  navigator.canShare({
    files: [new File(["test"], "image.png", { type: "image/png" })],
  })
) {
  shareBtn.classList.remove("hidden");
}

tabButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const targetTab = button.getAttribute("data-tab");

    tabButtons.forEach((btn) => {
      btn.classList.remove("text-blue-600", "border-blue-600");
      btn.classList.add("text-gray-600");
    });

    button.classList.add("text-blue-600", "border-b-2", "border-blue-600");

    tabPanels.forEach((panel) => {
      panel.classList.toggle(
        "hidden",
        panel.getAttribute("data-tab") !== targetTab
      );
    });
  });
});

const depthInput = document.querySelector("#depthInput")!;

let fileDefined = false;
let fileDefinedTimestamp = 0;

export class FBO {
  #scene: Scene;
  #camera: OrthographicCamera;

  #rtt1: WebGLRenderTarget;
  #rtt2: WebGLRenderTarget;
  #currentRtt: WebGLRenderTarget;

  #mesh: Mesh<BufferGeometry, ShaderMaterial>;
  #renderer: WebGLRenderer;

  particles: Points<BufferGeometry, ShaderMaterial>;

  constructor(
    width: number,
    height: number,
    renderer: WebGLRenderer,
    simulationMaterial: ShaderMaterial,
    renderMaterial: ShaderMaterial
  ) {
    renderer.getContext().getExtension("EXT_float_blend");

    this.#scene = new Scene();
    this.#camera = new OrthographicCamera(-1, 1, 1, -1, 1 / Math.pow(2, 53), 1);

    const options: RenderTargetOptions = {
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      format: RGBAFormat,
      type: FloatType,
    };

    this.#rtt1 = new WebGLRenderTarget(width, height, options);
    this.#rtt2 = new WebGLRenderTarget(width, height, options);
    this.#currentRtt = this.#rtt1;
    this.#renderer = renderer;

    const bufferGeometry = new BufferGeometry();

    bufferGeometry.setAttribute(
      "position",
      new BufferAttribute(
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
      new BufferAttribute(
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

    this.#mesh = new Mesh(bufferGeometry, simulationMaterial);

    this.#scene.add(new Mesh(bufferGeometry, simulationMaterial));

    const l = width * height;
    const vertices = new Float32Array(l * 3);

    for (let i = 0; i < l; i++) {
      const i3 = i * 3;
      vertices[i3] = (i % width) / width;
      vertices[i3 + 1] = i / width / height;
    }

    const geometry = new BufferGeometry();

    geometry.setAttribute("position", new BufferAttribute(vertices, 3));

    this.particles = new Points(geometry, renderMaterial);

    depthInput.addEventListener("change", async (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) return;

      try {
        document.body.classList.add("loading");
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

        const data = new Float32Array(width * height * 4);

        for (let i = 0; i < data.length; i += 4) {
          const x = Math.floor(i / 4);

          const depthX = Math.floor(((x % width) / width) * depthWidth);
          const depthY = Math.floor((x / width / height) * depthHeight);

          const z = depthData.data[depthY * depthWidth * 4 + depthX * 4];

          data[i] = ((x % width) / width - 0.5) * 20;
          data[i + 1] = (1 - x / width / height - 0.5) * 20;
          data[i + 2] = Math.log2(z);

          if (Number.isNaN(data[i + 2])) {
            data[i + 2] = 0;
          }

          data[i + 3] =
            imageData.data[i] +
            (imageData.data[i + 1] << 8) +
            (imageData.data[i + 2] << 16);
        }

        fileDefined = true;
        fileDefinedTimestamp = performance.now();

        const positions = new DataTexture(
          data,
          width,
          height,
          RGBAFormat,
          FloatType
        );
        positions.needsUpdate = true;

        this.#mesh.material.uniforms.positions.value = positions;

        form.classList.add("folded");
      } catch {
        errorModal.classList.remove("hidden");
      } finally {
        document.body.classList.remove("loading");
      }
    });
  }

  update() {
    const nextRtt = this.#currentRtt === this.#rtt1 ? this.#rtt2 : this.#rtt1;
    let timestamp = fileDefined
      ? performance.now() - fileDefinedTimestamp
      : Math.sin(performance.now() * 0.001) * 500;
    this.#mesh.material.uniforms.timestamp.value = timestamp;

    this.#renderer.setRenderTarget(nextRtt);
    this.#renderer.render(this.#scene, this.#camera);
    this.#renderer.setRenderTarget(null);

    this.particles.material.uniforms.positions.value = nextRtt.texture;

    this.#currentRtt = nextRtt;
  }
}

function getSphereData(width: number, height: number, size: number) {
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
let scene: Scene;
let camera: PerspectiveCamera;
let renderer: WebGLRenderer;

function init() {
  const w = window.innerWidth;
  const h = window.innerHeight;

  scene = new Scene();
  camera = new PerspectiveCamera(60, w / h, 1, 10000);

  camera.position.set(0.5, -0.25, 25);
  camera.lookAt(0, 0, 0);

  renderer = new WebGLRenderer({
    canvas: canvasEl,
    preserveDrawingBuffer: true,
  });
  renderer.setSize(w, h);

  const width = 512;
  const height = 512;

  const data = getSphereData(width, height, 10);

  const positions = new DataTexture(data, width, height, RGBAFormat, FloatType);

  positions.needsUpdate = true;

  const simulationShader = new ShaderMaterial({
    uniforms: {
      positions: { value: positions },
      timestamp: { value: 0 },
    },
    vertexShader: `
      out vec2 vUv;

      void main() {
        vUv = vec2(uv.x, uv.y);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D positions;
      uniform float timestamp;
      in vec2 vUv;

      void main() {
        vec4 pos = texture2D(positions, vUv);
        float force = clamp(timestamp / 5000., 0., 1.);

        pos.x += sin(timestamp * 0.001 * pos.a / (float(2 << 20))) * (1. - force) * 5.0;
        pos.y += cos(timestamp * 0.001 * pos.a / (float(2 << 20))) * (1. - force) * 5.0;
        pos.z += sin(timestamp * 0.001 * pos.a / (float(2 << 20))) * (1. - force) * 5.0;
        gl_FragColor = pos;
      }
    `,
  });

  const renderShader = new ShaderMaterial({
    uniforms: {
      positions: { value: null },
      pointSize: { value: 1 },
    },
    vertexShader: `
      out vec3 vColor;

      uniform sampler2D positions;
      uniform float pointSize;

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
        gl_FragColor = vec4(vColor, 0.7);
      }
    `,
    transparent: true,
    blending: AdditiveBlending,
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

// Share image (read from context) and url with share API
async function shareImage() {
  const blob = await new Promise<Blob>((resolve) => {
    (renderer.getContext().canvas as HTMLCanvasElement).toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        console.error("Failed to create blob from canvas");
        resolve(new Blob());
      }
    });
  });

  if (!blob) return;

  const file = new File([blob], "image.png", { type: "image/png" });

  if (!navigator.canShare) {
    console.error("Share API not supported");
    return;
  }

  if (!navigator.canShare({ files: [file] })) {
    console.error("Cannot share this file");
    return;
  }

  navigator
    .share({
      files: [file],
    })
    .catch((error) => console.error("Error sharing:", error));
}

shareBtn.addEventListener("click", shareImage);

init();
