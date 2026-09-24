import * as THREE from "../vendor/three.module.js";
import { RoomEnvironment } from "../vendor/RoomEnvironment.js";
import { EXRLoader } from "../vendor/EXRLoader.js";
import { choice, rand } from "./random.js";

export const HDRI_MANIFEST = Object.freeze({
  aircraft_workshop: "../HDRI/aircraft_workshop_01_1k.exr",
  empty_warehouse: "../HDRI/empty_warehouse_01_1k.exr",
  industrial_pipe_valve: "../HDRI/industrial_pipe_and_valve_01_1k (1).exr",
});

const environmentPromiseCache = new Map();

function createRoomEnvironmentTexture(rendererInstance) {
  const pmremGenerator = new THREE.PMREMGenerator(rendererInstance);
  const roomEnvironment = new RoomEnvironment();
  const environmentRenderTarget = pmremGenerator.fromScene(roomEnvironment);
  pmremGenerator.dispose();
  return environmentRenderTarget.texture;
}

function loadHdriEnvironment(rendererInstance, key) {
  const path = HDRI_MANIFEST[key];
  if (!path) return Promise.reject(new Error(`Unknown HDRI key: ${key}`));
  if (!environmentPromiseCache.has(path)) {
    environmentPromiseCache.set(path, (async () => {
      const sourceTexture = await new EXRLoader()
        .setDataType(THREE.HalfFloatType)
        .loadAsync(path);
      const pmremGenerator = new THREE.PMREMGenerator(rendererInstance);
      pmremGenerator.compileEquirectangularShader();
      try {
        return pmremGenerator.fromEquirectangular(sourceTexture).texture;
      } finally {
        sourceTexture.dispose();
        pmremGenerator.dispose();
      }
    })());
  }
  return environmentPromiseCache.get(path);
}

export async function createSceneEnvironment(rendererInstance, selection) {
  if (selection.selectedKey) {
    try {
      const texture = await loadHdriEnvironment(rendererInstance, selection.selectedKey);
      return {
        ...selection,
        texture,
        loaded: true,
        fallback: false,
      };
    } catch (error) {
      console.warn(`[water-meter] HDRI "${selection.selectedKey}" failed to load: ${error.message}. Falling back to RoomEnvironment.`);
    }
  }
  return {
    ...selection,
    selectedKey: null,
    texture: createRoomEnvironmentTexture(rendererInstance),
    loaded: false,
    fallback: selection.mode !== "room",
  };
}

export function addLights({ scene, config }) {
  const lightCfg = config.lighting;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x87909a, lightCfg.fillLightIntensity));
  const key = new THREE.DirectionalLight(0xffffff, lightCfg.keyLightIntensity);
  key.position.set(...lightCfg.keyLightPosition);
  key.castShadow = true;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xd9ecff, lightCfg.fillLightIntensity);
  fill.position.set(...lightCfg.fillLightPosition);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffffff, lightCfg.rimLightIntensity);
  rim.position.set(...lightCfg.rimLightPosition);
  scene.add(rim);
}

export function addStudioBackdrop({ root }) {
  const moods = [
    ["#151b23", "#334155", "#0b0d12"],
    ["#171a13", "#58683d", "#090b08"],
    ["#1c1711", "#6b5942", "#0c0906"],
    ["#102018", "#456b58", "#060907"],
    ["#202127", "#647089", "#0d0f14"],
  ];
  const [edge, glow, deep] = choice(moods);
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createRadialGradient(520, 430, 40, 512, 512, 670);
  grad.addColorStop(0, glow);
  grad.addColorStop(0.42, edge);
  grad.addColorStop(1, deep);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = "#000";
  for (let i = 0; i < 24; i++) {
    ctx.fillRect(rand(0, 1024), rand(0, 1024), rand(1, 3), rand(1, 3));
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(1300, 1300),
    new THREE.MeshBasicMaterial({ map: tex, depthWrite: false })
  );
  plane.position.z = -190;
  plane.userData.excludeFromMask = true;
  root.add(plane);
}
