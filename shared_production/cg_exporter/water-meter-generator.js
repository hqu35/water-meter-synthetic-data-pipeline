import * as THREE from "./vendor/three.module.js";
import { hashString, mulberry32, rand, setRng } from "./renderer/random.js";
import { validateFinalLayout } from "./renderer/validation.js";
import { buildAnnotationMeta } from "./renderer/annotations.js";
import { addLights, addStudioBackdrop, createSceneEnvironment } from "./renderer/lighting.js";
import { buildOutputMetadata, installOutputAPI, renderFinalRgb } from "./renderer/output.js";
import {
  createRegisterGlyphDiagnosticCanvas,
  createRegisterState,
  placeDigitRegister,
} from "./renderer/register.js";
import {
  assertSingleCreation,
  createFaceLayout,
  createMeterIdentity,
  drawBackHousing,
  drawFamilyStructures,
  drawGlassCover,
  drawPipeAssembly,
  drawShell,
  faceHalfWidthAtY,
  makeShell,
  placeCenterElement,
  placeDials,
  placeLabels,
  placeScrews,
  roundedBox,
} from "./renderer/meter.js";
import {
  FAMILY_TEXTURE_POOLS,
  createMaterials,
  loadPbrTextureSet,
} from "./renderer/materials.js";
import {
  applyDigitCountParams,
  applyFacePlateVariation,
  applyLightingMode,
  applyLightingWithEnvironment,
  createMeterConfig,
  selectDigitCount,
  selectEnvironment,
  selectPbrTexture,
} from "./renderer/config.js";

const params = new URLSearchParams(window.location.search);
const WIDTH = Number(params.get("w") || 512);
const HEIGHT = Number(params.get("h") || 512);
const seedParam = params.get("seed");
const exportMode = params.get("export") === "1";
const presetParam = params.get("preset") || "random";
const familyParam = params.get("family");
const transparentParam = params.get("transparent");
const exactDigitsParam = params.get("digits");
const digitMinParam = params.get("digitMin");
const digitMaxParam = params.get("digitMax");
const registerGlyphDiagnosticParam = params.get("registerGlyphDiagnostic") === "1";
const textureModeParam = params.get("textureMode") || "random";
const textureKeyParam = params.get("textureKey");
const faceColorParam = params.get("faceColor");
const pbrRepeatParam = params.get("pbrRepeat");
const pbrRoughnessMapParam = params.get("pbrRoughnessMap");
const pbrMetalnessMapParam = params.get("pbrMetalnessMap");
const pbrRoughnessParam = params.get("pbrRoughness");
const pbrMetalnessParam = params.get("pbrMetalness");
const pbrNormalScaleParam = params.get("pbrNormalScale");
const normalizePbrExtrudeUVsParam = params.get("normalizePbrExtrudeUVs");
const normalizePbrExtrudeUVs = normalizePbrExtrudeUVsParam !== "0";
const lightingModeParam = params.get("lightingMode") || "reduced";
const environmentModeParam = params.get("environmentMode") || "random";
const environmentKeyParam = params.get("environmentKey");
const environmentIntensityParam = params.get("environmentIntensity");
const environmentRotationParam = params.get("environmentRotation");
const lightingWithEnvironmentParam = params.get("lightingWithEnvironment") || "current";
const rng = mulberry32(seedParam ? hashString(seedParam) : Date.now() ^ Math.floor(Math.random() * 1e9));
setRng(rng);
const meterConfig = createMeterConfig({
  seed: seedParam || "random",
  presetName: presetParam,
  familyParam,
  width: WIDTH,
  height: HEIGHT,
  rng,
});
if (transparentParam !== null) meterConfig.output.transparentBackground = transparentParam !== "0";
applyDigitCountParams(meterConfig, { exactDigitsParam, digitMinParam, digitMaxParam });
applyFacePlateVariation(meterConfig, seedParam || "random", faceColorParam);
applyLightingMode(meterConfig, seedParam || "random", lightingModeParam);
applyLightingWithEnvironment(meterConfig, lightingWithEnvironmentParam);
const pbrSelection = selectPbrTexture(seedParam || "random", meterConfig.family, textureModeParam, textureKeyParam);
const loadedPbrTextureSet = pbrSelection.textureKey ? await loadPbrTextureSet(pbrSelection.textureKey) : null;
meterConfig.pbr = {
  mode: pbrSelection.mode,
  requestedTextureKey: textureKeyParam || null,
  selectedTextureKey: loadedPbrTextureSet ? pbrSelection.textureKey : null,
  loaded: Boolean(loadedPbrTextureSet),
  familyPool: [...(FAMILY_TEXTURE_POOLS[meterConfig.family] || [])],
};
const environmentSelection = selectEnvironment(
  seedParam || "random",
  meterConfig.family,
  meterConfig.presetName,
  environmentModeParam,
  environmentKeyParam,
  environmentIntensityParam,
  environmentRotationParam
);

const scene = new THREE.Scene();
scene.background = meterConfig.output.transparentBackground ? null : new THREE.Color(0xffffff);

// Changed section: perspective camera setup.
// Seeded small yaw/pitch offsets make the meter read like a slightly oblique product photo.
const cameraFov = rand(38, 48);
const cameraDistance = rand(1500, 1760);
const cameraYaw = THREE.MathUtils.degToRad(rand(-28, 28));
const cameraPitch = THREE.MathUtils.degToRad(rand(-18, 22));
const cameraRoll = THREE.MathUtils.degToRad(rand(-15, 15));
const camera = new THREE.PerspectiveCamera(cameraFov, WIDTH / HEIGHT, 1, 3000);
camera.position.set(
  Math.sin(cameraYaw) * Math.cos(cameraPitch) * cameraDistance,
  Math.sin(cameraPitch) * cameraDistance,
  Math.cos(cameraYaw) * Math.cos(cameraPitch) * cameraDistance
);
camera.lookAt(0, 0, 0);
camera.rotateZ(cameraRoll);

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: true,
  preserveDrawingBuffer: true,
});
renderer.setPixelRatio(1);
renderer.setSize(WIDTH, HEIGHT);
renderer.outputColorSpace = THREE.SRGBColorSpace;
if (THREE.ACESFilmicToneMapping !== undefined) renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = meterConfig.lighting.exposure;
renderer.setClearColor(0x000000, meterConfig.output.transparentBackground ? 0 : 1);
if (meterConfig.output.transparentBackground) {
  document.documentElement.style.background = "transparent";
  document.body.style.background = "transparent";
}
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const environmentState = await createSceneEnvironment(renderer, environmentSelection);
scene.environment = environmentState.texture;
scene.environmentIntensity = environmentState.intensity;
scene.environmentRotation.set(0, THREE.MathUtils.degToRad(environmentState.rotationDegrees), 0);
if (meterConfig.output.transparentBackground) scene.background = null;
document.body.appendChild(renderer.domElement);

const occupied = [];
const pbrUvNormalizationStats = [];
const root = new THREE.Group();
scene.add(root);
const annotationState = {
  wheel: null,
  digits: [],
  wheelReading: "",
};
const layoutState = {
  register: null,
  centerGear: null,
  dials: [],
  labels: {},
  faceLayout: null,
  mainFace: null,
  lid: null,
  modules: [],
  creation: {
    mainFace: 0,
    lid: 0,
    register: 0,
    centerGear: 0,
    brand: 0,
    bottomText: 0,
  },
  validation: null,
};

const registerState = createRegisterState();













const materialSystem = createMaterials({
  config: meterConfig,
  loadedPbrTextureSet,
  runtime: {
    pbrRepeatParam,
    pbrRoughnessMapParam,
    pbrMetalnessMapParam,
    pbrRoughnessParam,
    pbrMetalnessParam,
    pbrNormalScaleParam,
  },
});
const { materials, resolvePbrRepeat, metalRoleMaterial } = materialSystem;

const identity = createMeterIdentity();
const meterContext = {
  config: meterConfig,
  rng,
  root,
  materials,
  metalRoleMaterial,
  layoutState,
  annotationState,
  occupied,
  identity,
  normalizePbrExtrudeUVs,
  pbrUvNormalizationStats,
};
const shell = makeShell(meterContext);
const faceLayout = createFaceLayout(shell);
layoutState.faceLayout = faceLayout;

if (!meterConfig.output.transparentBackground) addStudioBackdrop({ root });
addLights({ scene, config: meterConfig });
drawPipeAssembly(meterContext, shell);
drawBackHousing(meterContext, shell);
drawFamilyStructures(meterContext, shell);
drawShell(meterContext, shell);
placeScrews(meterContext, shell);
const digitWindow = placeDigitRegister({
  config: meterConfig,
  rng,
  root,
  materials,
  annotationState,
  layoutState,
  occupied,
  registerState,
  roundedBox: (...args) => roundedBox(meterContext, ...args),
  faceHalfWidthAtY,
  assertSingleCreation: (key) => assertSingleCreation(meterContext, key),
  selectDigitCount,
}, shell, faceLayout);
const center = placeCenterElement(meterContext, shell, faceLayout, digitWindow);
placeDials(meterContext, shell, faceLayout, digitWindow, center);
placeLabels(meterContext, shell, faceLayout, digitWindow, center);
drawGlassCover(meterContext, shell);
layoutState.validation = validateFinalLayout({
  config: meterConfig,
  layoutState,
  annotationState,
  occupied,
  shell,
  digitWindow,
});

renderFinalRgb({ renderer, scene, camera });
const annotationMeta = buildAnnotationMeta({
  camera,
  width: WIDTH,
  height: HEIGHT,
  annotationState,
});
installOutputAPI({
  scene,
  camera,
  renderer,
  root,
  createMetadata: () => buildOutputMetadata({
    seedParam,
    config: meterConfig,
    width: WIDTH,
    height: HEIGHT,
    occupied,
    registerGlyphDiagnostics: registerState.glyphDiagnostics,
    layoutState,
    resolvePbrRepeat,
    normalizePbrExtrudeUVs,
    pbrUvNormalizationStats,
    environmentState,
    materials,
    annotationMeta,
  }),
  registerGlyphDiagnostic: registerGlyphDiagnosticParam,
  createRegisterGlyphDiagnosticCanvas: () => createRegisterGlyphDiagnosticCanvas(registerState),
  exportMode,
  width: WIDTH,
  height: HEIGHT,
});
