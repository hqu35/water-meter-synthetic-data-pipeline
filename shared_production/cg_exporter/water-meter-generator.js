import * as THREE from "./vendor/three.module.js";
import { RoomEnvironment } from "./vendor/RoomEnvironment.js";
import { EXRLoader } from "./vendor/EXRLoader.js";
import { normalizeExtrudeGeometryUVs } from "./extrude-uv.js";

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
const DESIGN_FAMILIES = [
  "classic_round",
  "industrial_window",
  "protective_shell",
  "modular_industrial",
  "smart_housing",
];
const PBR_TEXTURE_MANIFEST = Object.freeze(Object.fromEntries(
  ["Metal021", "Metal034", "Metal048A", "Metal050C", "Metal053C", "Metal062C"].map((key) => [key, {
    color: `../assets/textures/pbr/${key}/${key}_1K-PNG_Color.png`,
    roughness: `../assets/textures/pbr/${key}/${key}_1K-PNG_Roughness.png`,
    metalness: `../assets/textures/pbr/${key}/${key}_1K-PNG_Metalness.png`,
    normal: `../assets/textures/pbr/${key}/${key}_1K-PNG_NormalGL.png`,
  }])
));
const PBR_TEXTURE_CALIBRATION = Object.freeze({
  Metal053C: { roughness: 0.65, metalness: 1, normalScale: 0.28 },
  Metal062C: { roughness: 0.65, metalness: 1, normalScale: 0.28 },
});
const FAMILY_TEXTURE_POOLS = Object.freeze({
  classic_round: ["Metal021", "Metal034", "Metal048A"],
  industrial_window: ["Metal021", "Metal034", "Metal048A", "Metal050C", "Metal053C", "Metal062C"],
  protective_shell: ["Metal034", "Metal050C"],
  modular_industrial: ["Metal021", "Metal048A", "Metal050C", "Metal053C", "Metal062C"],
  smart_housing: ["Metal034", "Metal048A", "Metal062C"],
});
const HDRI_MANIFEST = Object.freeze({
  aircraft_workshop: "../HDRI/aircraft_workshop_01_1k.exr",
  empty_warehouse: "../HDRI/empty_warehouse_01_1k.exr",
  industrial_pipe_valve: "../HDRI/industrial_pipe_and_valve_01_1k (1).exr",
});
const textureLoader = new THREE.TextureLoader();
const texturePromiseCache = new Map();
const environmentPromiseCache = new Map();
const rng = mulberry32(seedParam ? hashString(seedParam) : Date.now() ^ Math.floor(Math.random() * 1e9));
const meterConfig = createMeterConfig(seedParam || "random", presetParam);
if (transparentParam !== null) meterConfig.output.transparentBackground = transparentParam !== "0";
applyDigitCountParams(meterConfig);
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

const DIAL_SCALE = 1.35;
const DIAL_DIGIT_SCALE = 1.5;
const REGISTER_SCALE = 1.2;
const REGISTER_DIGIT_WEIGHT = "800";
const REGISTER_DIGIT_FAMILY = "Arial Black, Arial, Helvetica, sans-serif";
const registerGlyphStyleCache = new Map();
let registerGlyphDiagnostics = null;

function createMeterConfig(seed, presetName) {
  const base = {
    seed,
    presetName,
    output: { width: WIDTH, height: HEIGHT, transparentBackground: true },
    shape: {
      faceShape: "roundedSquare",
      width: 1,
      height: 1,
      ovalAspectRatio: 1.25,
      cornerRadius: 0.32,
      bodyDepth: 86,
      facePlateDepth: 10,
      bezelDepth: 38,
      outerRimHeight: 10,
      innerRimHeight: 6,
      outerRimThickness: 0.12,
      innerRimThickness: 0.06,
      edgeBevelSize: 4,
      edgeBevelSegments: 3,
    },
    facePlate: {
      color: 0xfffbf2,
      roughness: 0.48,
      metalness: 0,
      raisedCenter: false,
      raisedCenterHeight: 2.5,
      recessedDigitWindow: true,
      digitWindowRecessDepth: 3.5,
    },
    housing: {
      materialType: "paintedMetal",
      color: 0xe6e2d8,
      roughness: 0.46,
      metalness: 0.52,
      thicknessScale: 1,
      addOuterProtrusions: true,
      protrusionCount: 4,
      protrusionDepth: 12,
      protrusionWidth: 52,
    },
    trim: {
      style: "black",
      primaryTrimColor: 0x111111,
      secondaryTrimColor: 0x496f91,
      useGoldTrim: false,
      goldColor: 0xc69b3c,
      digitWindowBorderColor: 0x111111,
      dialBorderColor: 0x111111,
      innerOutlineColor: 0x111111,
    },
    glass: {
      enabled: true,
      curvature: 14,
      offsetZ: 96,
      thickness: 8,
      roughness: 0.04,
      transmission: 1,
      ior: 1.5,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
      opacity: 1,
      specularIntensity: 1,
      envMapIntensity: 1,
      tint: 0xffffff,
      useSubtleReflectionOverlay: true,
      reflectionOpacity: 0.16,
      reflectionAngle: 0.58,
      reflectionScaleX: 210,
      reflectionScaleY: 22,
      reflectionOffsetX: 86,
      reflectionOffsetY: 112,
    },
    digitRegister: {
      minDigits: 7,
      maxDigits: 8,
      exactDigits: null,
      selectedDigitCount: null,
      digitCountSource: "weighted",
      redDigitCount: null,
    },
    family: "classic_round",
    layoutPreset: "classic_a",
    registerLayout: {
      anchor: [0, 0.42],
      alternateAnchors: [[0, 0.34]],
      widthScale: 1,
      heightScale: 1,
      anchorJitter: 0.025,
    },
    dialLayout: {
      anchors: [[0, -0.4]],
      radiusRange: [46, 62],
      count: 1,
    },
    cover: { type: "none", side: "up" },
    modules: { type: "none", side: 1, count: 0 },
    connectors: { radiusRange: [27, 42], yRange: [-18, 26], length: 1040 },
    screws: { countRange: [3, 8] },
    trimStructure: { ringCountRange: [1, 3] },
    appearance: {
      addDust: false,
      dustAmount: 0,
      addWaterStains: false,
      waterStainAmount: 0,
      addMildOxidation: false,
      oxidationAmount: 0,
    },
    lighting: {
      keyLightIntensity: 1.54,
      fillLightIntensity: 0.6,
      rimLightIntensity: 0.39,
      keyLightPosition: [-300, 320, 650],
      fillLightPosition: [270, -190, 430],
      rimLightPosition: [0, 380, -260],
      environmentIntensity: 1,
      exposure: 0.95,
    },
  };

  const presets = {
    classic_white: {
      shape: { faceShape: "roundedSquare", cornerRadius: 0.34, bodyDepth: 86, bezelDepth: 38, outerRimHeight: 8 },
      housing: { materialType: "paintedMetal", color: 0xe6e2d8, roughness: 0.44, metalness: 0.48, thicknessScale: 1 },
      trim: { style: "black", primaryTrimColor: 0x111111, secondaryTrimColor: 0x496f91, digitWindowBorderColor: 0x111111 },
      glass: { curvature: 13, roughness: 0.04, reflectionOpacity: 0.14 },
    },
    industrial_brass: {
      shape: { faceShape: "roundedSquare", bodyDepth: 104, bezelDepth: 48, outerRimHeight: 12, outerRimThickness: 0.16 },
      housing: { materialType: "brass", color: 0x9a6d2f, roughness: 0.34, metalness: 0.84, thicknessScale: 1.18 },
      trim: { style: "bronze", primaryTrimColor: 0x2a2118, secondaryTrimColor: 0x8b6b38 },
      facePlate: { color: 0xf0eadb, roughness: 0.55 },
    },
    oval_modern: {
      shape: { faceShape: "oval", ovalAspectRatio: 1.22, bodyDepth: 76, bezelDepth: 30, outerRimHeight: 6, outerRimThickness: 0.08 },
      housing: { materialType: "paintedMetal", color: 0xd9dee0, roughness: 0.38, metalness: 0.45, addOuterProtrusions: false },
      trim: { style: "steel", primaryTrimColor: 0x8f979b, secondaryTrimColor: 0x5f7484, digitWindowBorderColor: 0x20272c },
      glass: { curvature: 11, roughness: 0.035, tint: 0xf4fbff, reflectionOpacity: 0.13 },
    },
    black_gold: {
      shape: { faceShape: rng() > 0.45 ? "roundedSquare" : "oval", ovalAspectRatio: 1.18, bodyDepth: 90, bezelDepth: 40 },
      housing: { materialType: "darkMetal", color: 0x26282b, roughness: 0.38, metalness: 0.75 },
      facePlate: { color: 0x262723, roughness: 0.46, metalness: 0.12 },
      trim: { style: "gold", useGoldTrim: true, primaryTrimColor: 0xc69b3c, secondaryTrimColor: 0xc69b3c, digitWindowBorderColor: 0xc69b3c },
      glass: { curvature: 14, tint: 0xf7f1e8, reflectionOpacity: 0.18 },
    },
    heavy_duty: {
      shape: { faceShape: "circle", bodyDepth: 118, bezelDepth: 56, outerRimHeight: 14, innerRimHeight: 9, outerRimThickness: 0.18 },
      housing: { materialType: "agedMetal", color: 0x756957, roughness: 0.64, metalness: 0.66, thicknessScale: 1.3, addOuterProtrusions: true, protrusionCount: 6 },
      trim: { style: "dark", primaryTrimColor: 0x17191b, secondaryTrimColor: 0x5e676b },
      glass: { curvature: 18, thickness: 9, roughness: 0.055, reflectionOpacity: 0.18 },
    },
    minimal_flat: {
      shape: { faceShape: "roundedSquare", bodyDepth: 64, bezelDepth: 24, outerRimHeight: 4, innerRimHeight: 3, outerRimThickness: 0.06 },
      housing: { materialType: "plastic", color: 0xdedfdc, roughness: 0.48, metalness: 0, thicknessScale: 0.78, addOuterProtrusions: false },
      trim: { style: "gray", primaryTrimColor: 0x2f3438, secondaryTrimColor: 0x9aa2a6 },
      glass: { curvature: 8, roughness: 0.04, reflectionOpacity: 0.11 },
    },
  };

  const legacyFamilyMap = {
    classic_white: "classic_round",
    industrial_brass: "industrial_window",
    oval_modern: "smart_housing",
    black_gold: "modular_industrial",
    heavy_duty: "industrial_window",
    minimal_flat: "smart_housing",
  };
  const requestedFamily = DESIGN_FAMILIES.includes(familyParam)
    ? familyParam
    : DESIGN_FAMILIES.includes(presetName)
      ? presetName
      : null;
  const selectedFamily = requestedFamily || legacyFamilyMap[presetName] || choice(DESIGN_FAMILIES);
  const selectedName = presets[presetName] ? presetName : null;
  const randomized = randomizeMeterConfig();
  deepMerge(base, randomized);
  deepMerge(base, createFamilyProfile(selectedFamily, seed));
  if (presets[selectedName]) deepMerge(base, presets[selectedName]);
  base.family = selectedFamily;
  base.presetName = selectedName || selectedFamily;
  applyTrimStyle(base.trim);
  return base;
}

function createFamilyProfile(family, seed) {
  const layouts = {
    classic_round: [
      { name: "classic_a", register: [0, 0.43], dials: [[0, -0.4]] },
      { name: "classic_b", register: [0, 0.42], dials: [[0.31, -0.34]] },
      { name: "classic_c", register: [0, 0.44], dials: [[-0.28, -0.38], [0.28, -0.38]] },
      { name: "classic_d", register: [-0.03, 0.2], dials: [[-0.34, -0.39]] },
      { name: "classic_e", register: [0.02, 0.48], dials: [[0, -0.28]] },
    ],
    industrial_window: [
      { name: "industrial_a", register: [0, 0.32], dials: [[0, -0.36]] },
      { name: "industrial_b", register: [0, 0.16], dials: [[-0.32, -0.39]] },
      { name: "industrial_c", register: [0.04, 0.4], dials: [[0.3, -0.33]] },
      { name: "industrial_d", register: [-0.03, 0.28], dials: [[-0.32, -0.37], [0.32, -0.37]] },
      { name: "industrial_e", register: [0, 0.1], dials: [[0, -0.4]] },
    ],
    protective_shell: [
      { name: "protective_a", register: [-0.14, 0.4], dials: [[-0.24, -0.35]] },
      { name: "protective_b", register: [0, 0.42], dials: [[0, -0.37]] },
      { name: "protective_c", register: [-0.13, 0.39], dials: [[0.28, -0.34]] },
      { name: "protective_d", register: [0.06, 0.18], dials: [[-0.31, -0.4]] },
      { name: "protective_e", register: [0, 0.44], dials: [[0.18, -0.3]] },
    ],
    modular_industrial: [
      { name: "modular_a", register: [0, 0.43], dials: [[0, -0.36]] },
      { name: "modular_b", register: [-0.12, 0.4], dials: [[0.3, -0.34]] },
      { name: "modular_c", register: [0, 0.34], dials: [[-0.28, -0.4], [0.28, -0.4]] },
      { name: "modular_d", register: [0.02, 0.48], dials: [[0, -0.28]] },
      { name: "modular_e", register: [0.12, 0.34], dials: [[-0.31, -0.35]] },
    ],
    smart_housing: [
      { name: "smart_a", register: [0, 0.38], dials: [[0, -0.36]] },
      { name: "smart_b", register: [-0.13, 0.38], dials: [[-0.26, -0.34]] },
      { name: "smart_c", register: [0.02, 0.4], dials: [[0.29, -0.32]] },
      { name: "smart_d", register: [0, 0.15], dials: [[-0.32, -0.38]] },
      { name: "smart_e", register: [0, 0.43], dials: [[0.18, -0.29]] },
    ],
  };
  const layout = choice(layouts[family] || layouts.classic_round);
  // Select 1-3 dials independently from the layout anchor count. A dedicated
  // seeded stream keeps the result reproducible and stable across other RNG changes.
  const dialCountRng = mulberry32(hashString(`${seed}|${family}|${layout.name}|dial-count`));
  const dialCount = 1 + Math.floor(dialCountRng() * 3);
  const common = {
    family,
    layoutPreset: layout.name,
    registerLayout: {
      anchor: layout.register,
      alternateAnchors: [[0, 0.36], [0, 0.24]],
      anchorJitter: 0.018,
      redDigitCount: randInt(0, 3),
    },
    dialLayout: {
      anchors: layout.dials,
      count: dialCount,
    },
  };

  const profiles = {
    classic_round: {
      shape: { faceShape: "circle", width: 1, height: 1, outerRange: [398, 438], rimRange: [34, 52], bodyDepth: rand(72, 112) },
      housing: { materialType: "paintedMetal", color: choice([0xe8e5dc, 0xd8dde0, 0xf0eee6]), addOuterProtrusions: rng() > 0.42 },
      registerLayout: { widthScale: rand(0.9, 1.02), heightScale: rand(0.94, 1.04) },
      dialLayout: { radiusRange: [46, 62] },
      cover: { type: choice(["none", "hinged_lid"]), side: choice(["up", "left", "right"]) },
      modules: { type: "none", side: 1, count: 0 },
      connectors: { radiusRange: [27, 37], yRange: [-12, 18], length: 1020 },
      screws: { countRange: [3, 6] },
      trimStructure: { ringCountRange: [2, 3] },
      trim: { style: choice(["black", "blueGray", "steel"]) },
    },
    industrial_window: {
      shape: { faceShape: choice(["roundedSquare", "circle"]), width: rand(1.02, 1.1), height: rand(0.84, 0.94), outerRange: [405, 442], rimRange: [46, 64], bodyDepth: rand(104, 132), bezelDepth: rand(44, 60) },
      housing: { materialType: choice(["agedMetal", "paintedMetal", "brass"]), color: choice([0x777b78, 0x66717a, 0x8b7552]), thicknessScale: rand(1.12, 1.34), addOuterProtrusions: true },
      registerLayout: { widthScale: rand(1.02, 1.12), heightScale: rand(0.88, 0.98) },
      dialLayout: { radiusRange: [42, 56] },
      cover: { type: "window_lip", side: "up" },
      modules: { type: "industrial_plate", side: choice([-1, 1]), count: 1 },
      connectors: { radiusRange: [34, 45], yRange: [-8, 16], length: 1080 },
      screws: { countRange: [2, 5] },
      trimStructure: { ringCountRange: [1, 2] },
      trim: { style: choice(["dark", "steel", "bronze"]) },
    },
    protective_shell: {
      shape: { faceShape: "roundedSquare", width: rand(1.06, 1.14), height: rand(0.88, 0.98), cornerRadius: rand(0.3, 0.42), outerRange: [395, 430], rimRange: [44, 60], bodyDepth: rand(86, 116) },
      housing: { materialType: "plastic", color: choice([0xe5e8e8, 0xd7e0e5, 0xf0eee8]), metalness: 0, thicknessScale: rand(1.02, 1.2), addOuterProtrusions: false },
      registerLayout: { widthScale: rand(0.9, 1), heightScale: rand(0.92, 1.02) },
      dialLayout: { radiusRange: [44, 59] },
      cover: { type: "molded_shell", side: choice([-1, 1]) },
      modules: { type: "side_cap", side: choice([-1, 1]), count: 1 },
      connectors: { radiusRange: [28, 39], yRange: [-14, 18], length: 1040 },
      screws: { countRange: [2, 4] },
      trimStructure: { ringCountRange: [1, 2] },
      trim: { style: choice(["blueGray", "gray", "black"]) },
    },
    modular_industrial: {
      shape: { faceShape: choice(["circle", "roundedSquare"]), width: rand(1, 1.08), height: rand(0.92, 1.02), outerRange: [400, 440], rimRange: [42, 60], bodyDepth: rand(98, 128) },
      housing: { materialType: choice(["paintedMetal", "darkMetal"]), color: choice([0x73787b, 0xddd8cc, 0x3f4549]), thicknessScale: rand(1.08, 1.3), addOuterProtrusions: true },
      registerLayout: { widthScale: rand(0.92, 1.05), heightScale: rand(0.92, 1.04) },
      dialLayout: { radiusRange: [44, 60] },
      cover: { type: "partial_lower", side: choice([-1, 1]) },
      modules: { type: "lower_module", side: choice([-1, 1]), count: randInt(1, 2) },
      connectors: { radiusRange: [31, 42], yRange: [-12, 20], length: 1060 },
      screws: { countRange: [3, 6] },
      trimStructure: { ringCountRange: [2, 3] },
      trim: { style: choice(["dark", "bronze", "black"]) },
    },
    smart_housing: {
      shape: { faceShape: "roundedSquare", width: rand(1.08, 1.16), height: rand(0.82, 0.94), cornerRadius: rand(0.28, 0.4), outerRange: [390, 425], rimRange: [38, 54], bodyDepth: rand(72, 102) },
      housing: { materialType: "plastic", color: choice([0xe7e9e8, 0xd9e2e7, 0xf2f1eb]), metalness: 0, thicknessScale: rand(0.92, 1.12), addOuterProtrusions: false },
      registerLayout: { widthScale: rand(0.84, 0.96), heightScale: rand(0.9, 1) },
      dialLayout: { radiusRange: [42, 56] },
      cover: { type: "modern_panel", side: choice([-1, 1]) },
      modules: { type: "communication", side: choice([-1, 1]), count: randInt(1, 2) },
      connectors: { radiusRange: [25, 34], yRange: [-12, 16], length: 1020 },
      screws: { countRange: [2, 4] },
      trimStructure: { ringCountRange: [1, 2] },
      trim: { style: choice(["gray", "blueGray", "whiteEnamel"]) },
    },
  };
  return deepMerge(common, profiles[family] || profiles.classic_round);
}

function randomizeMeterConfig() {
  const faceShape = choice(["roundedSquare", "circle", "oval"]);
  const trimStyle = choice(["black", "steel", "gold", "bronze", "blueGray", "whiteEnamel"]);
  return {
    shape: {
      faceShape,
      ovalAspectRatio: rand(1.12, 1.32),
      cornerRadius: rand(0.24, 0.42),
      bodyDepth: rand(68, 112),
      facePlateDepth: rand(7, 13),
      bezelDepth: rand(28, 52),
      outerRimHeight: rand(4, 14),
      innerRimHeight: rand(3, 9),
      outerRimThickness: rand(0.07, 0.18),
      innerRimThickness: rand(0.045, 0.09),
      edgeBevelSize: rand(2.5, 6),
    },
    housing: {
      materialType: choice(["paintedMetal", "brass", "darkMetal", "plastic", "agedMetal"]),
      thicknessScale: rand(0.82, 1.24),
      addOuterProtrusions: rng() > 0.28,
      protrusionCount: randInt(3, 6),
      protrusionDepth: rand(7, 16),
      protrusionWidth: rand(42, 70),
    },
    trim: { style: trimStyle },
    glass: {
      curvature: rand(8, 18),
      roughness: rand(0.025, 0.065),
      opacity: 1,
      tint: choice([0xffffff, 0xf4fbff, 0xf7f1e8]),
      reflectionOpacity: rand(0.1, 0.19),
      reflectionAngle: rand(0.36, 0.78),
      reflectionOffsetX: rand(55, 125),
      reflectionOffsetY: rand(70, 155),
    },
    lighting: { exposure: rand(0.95, 1.12) },
  };
}

function deepMerge(target, source) {
  for (const [key, value] of Object.entries(source || {})) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      target[key] ||= {};
      deepMerge(target[key], value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

function getFacePlatePalettes() {
  return {
    industrial_window: [
      { key: "gold", color: 0xb58a45, roughness: 0.6, metalness: 0.24 },
      { key: "bronze", color: 0x8b7552, roughness: 0.64, metalness: 0.2 },
      { key: "gray", color: 0x85898a, roughness: 0.68, metalness: 0.08 },
      { key: "silver", color: 0xb9bec1, roughness: 0.62, metalness: 0.1 },
      { key: "off-white", color: 0xe8e5dc, roughness: 0.72, metalness: 0.02 },
      { key: "white", color: 0xf0f1ee, roughness: 0.7, metalness: 0 },
      { key: "charcoal", color: 0x34383a, roughness: 0.62, metalness: 0.12 },
      { key: "black", color: 0x1f2224, roughness: 0.58, metalness: 0.14 },
    ],
    classic_round: [
      { key: "off-white", color: 0xe8e5dc, roughness: 0.72, metalness: 0.02 },
      { key: "white", color: 0xf0f1ee, roughness: 0.7, metalness: 0 },
      { key: "silver", color: 0xb9bec1, roughness: 0.66, metalness: 0.08 },
      { key: "gray", color: 0x85898a, roughness: 0.7, metalness: 0.06 },
    ],
    protective_shell: [
      { key: "off-white", color: 0xe8e5dc, roughness: 0.74, metalness: 0 },
      { key: "white", color: 0xf0f1ee, roughness: 0.72, metalness: 0 },
      { key: "silver", color: 0xb9bec1, roughness: 0.7, metalness: 0.04 },
    ],
    modular_industrial: [
      { key: "silver", color: 0xb9bec1, roughness: 0.64, metalness: 0.1 },
      { key: "gray", color: 0x85898a, roughness: 0.68, metalness: 0.08 },
      { key: "charcoal", color: 0x34383a, roughness: 0.6, metalness: 0.14 },
      { key: "off-white", color: 0xe8e5dc, roughness: 0.72, metalness: 0.02 },
    ],
    smart_housing: [
      { key: "white", color: 0xf0f1ee, roughness: 0.72, metalness: 0 },
      { key: "off-white", color: 0xe8e5dc, roughness: 0.74, metalness: 0 },
      { key: "silver", color: 0xb9bec1, roughness: 0.7, metalness: 0.04 },
      { key: "gray", color: 0x85898a, roughness: 0.72, metalness: 0.04 },
    ],
  };
}

function applyFacePlateVariation(config, seed, overrideKey) {
  const palettes = getFacePlatePalettes();
  const palette = palettes[config.family] || palettes.classic_round;
  const aliases = { "silver-gray": "silver", "cool-white": "white", "near-black": "black", "neutral-gray": "gray" };
  const requestedKey = aliases[overrideKey] || overrideKey;
  const override = requestedKey ? palette.find((entry) => entry.key === requestedKey) : null;
  const faceRng = mulberry32(hashString(`${seed}|${config.family}|face-plate`));
  const selected = override || palette[Math.floor(faceRng() * palette.length)];
  const color = new THREE.Color(selected.color);
  const luminance = color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
  const dark = luminance < 0.28;
  Object.assign(config.facePlate, selected, {
    selectionSource: override ? "override" : "seeded",
    dark,
    primaryLabelColor: dark ? "#f2f3ef" : "#111820",
    secondaryLabelColor: dark ? "#d8e7f2" : "#145faf",
  });
}

function applyLightingMode(config, seed, mode) {
  if (mode === "old") {
    Object.assign(config.lighting, {
      keyLightIntensity: 2.2,
      fillLightIntensity: 0.85,
      rimLightIntensity: 0.55,
      exposure: 1.05,
      mode: "old",
    });
    return;
  }
  const lightingRng = mulberry32(hashString(`${seed}|lighting-reduced`));
  Object.assign(config.lighting, {
    keyLightIntensity: 1.54,
    fillLightIntensity: 0.6,
    rimLightIntensity: 0.39,
    exposure: 0.92 + lightingRng() * 0.06,
    mode: "reduced",
  });
}

function applyLightingWithEnvironment(config, requestedMode) {
  const mode = ["current", "weak", "off"].includes(requestedMode) ? requestedMode : "current";
  const scale = mode === "weak" ? 0.45 : mode === "off" ? 0 : 1;
  config.lighting.keyLightIntensity *= scale;
  config.lighting.fillLightIntensity *= scale;
  config.lighting.rimLightIntensity *= scale;
  config.lighting.withEnvironment = mode;
}

function selectEnvironment(seed, family, preset, requestedMode, requestedKey, intensityValue, rotationValue) {
  const mode = ["room", "single", "random"].includes(requestedMode) ? requestedMode : "room";
  const keys = Object.keys(HDRI_MANIFEST);
  let selectedKey = null;
  if (mode === "single") {
    if (requestedKey && HDRI_MANIFEST[requestedKey]) {
      selectedKey = requestedKey;
    } else {
      console.warn(`[water-meter] Invalid environment key "${requestedKey || ""}"; falling back to RoomEnvironment.`);
    }
  } else if (mode === "random") {
    const environmentRng = mulberry32(hashString(`${seed}|${family}|${preset}|environment`));
    selectedKey = keys[Math.floor(environmentRng() * keys.length)];
  }

  const hasIntensityOverride = intensityValue !== null && intensityValue !== "";
  const intensityNumber = Number(intensityValue);
  const intensityRng = mulberry32(hashString(`${seed}|${family}|environment-intensity`));
  const intensity = hasIntensityOverride && Number.isFinite(intensityNumber)
    ? THREE.MathUtils.clamp(intensityNumber, 0.5, 1.4)
    : selectedKey ? 0.65 + intensityRng() * 0.3 : 1;

  const hasRotationOverride = rotationValue !== null && rotationValue !== "";
  const rotationNumber = Number(rotationValue);
  const rotations = [0, 45];
  const rotationRng = mulberry32(hashString(`${seed}|${family}|environment-rotation`));
  const rotationDegrees = hasRotationOverride && Number.isFinite(rotationNumber)
    ? THREE.MathUtils.clamp(rotationNumber, -180, 180)
    : rotations[Math.floor(rotationRng() * rotations.length)];

  return {
    mode,
    requestedKey: requestedKey || null,
    selectedKey,
    intensity,
    rotationDegrees,
  };
}

function applyDigitCountParams(config) {
  const clampDigit = (value) => Math.max(7, Math.min(8, Math.round(value)));
  if (exactDigitsParam !== null && Number.isFinite(Number(exactDigitsParam))) {
    config.digitRegister.exactDigits = clampDigit(Number(exactDigitsParam));
    config.digitRegister.minDigits = config.digitRegister.exactDigits;
    config.digitRegister.maxDigits = config.digitRegister.exactDigits;
    config.digitRegister.selectedDigitCount = config.digitRegister.exactDigits;
    config.digitRegister.digitCountSource = "url_override";
    return;
  }
  if (digitMinParam !== null && Number.isFinite(Number(digitMinParam))) {
    config.digitRegister.minDigits = clampDigit(Number(digitMinParam));
  }
  if (digitMaxParam !== null && Number.isFinite(Number(digitMaxParam))) {
    config.digitRegister.maxDigits = clampDigit(Number(digitMaxParam));
  }
  if (config.digitRegister.minDigits > config.digitRegister.maxDigits) {
    [config.digitRegister.minDigits, config.digitRegister.maxDigits] = [config.digitRegister.maxDigits, config.digitRegister.minDigits];
  }
}

function selectDigitCount() {
  const digitCfg = meterConfig.digitRegister;
  if (digitCfg.exactDigits) {
    digitCfg.selectedDigitCount = digitCfg.exactDigits;
    digitCfg.digitCountSource = "url_override";
    return digitCfg.exactDigits;
  }

  const r = rng();
  let count = r < 0.7 ? 8 : 7;

  count = Math.max(digitCfg.minDigits, Math.min(digitCfg.maxDigits, count));
  digitCfg.selectedDigitCount = count;
  digitCfg.digitCountSource = "seeded_weighted_70_30";
  return count;
}

function selectPbrTexture(seed, family, requestedMode, requestedKey) {
  const mode = ["off", "single", "random"].includes(requestedMode) ? requestedMode : "off";
  if (mode === "off") return { mode, textureKey: null };
  if (mode === "single") {
    if (requestedKey && PBR_TEXTURE_MANIFEST[requestedKey]) return { mode, textureKey: requestedKey };
    console.warn(`[water-meter] unknown PBR texture key ${requestedKey || "<missing>"}; using plain fallback`);
    return { mode, textureKey: null };
  }
  const pool = FAMILY_TEXTURE_POOLS[family] || [];
  if (!pool.length) return { mode, textureKey: null };
  const textureRng = mulberry32(hashString(`${seed}|${family}|pbr-texture`));
  return { mode, textureKey: pool[Math.floor(textureRng() * pool.length)] };
}

function loadTextureCached(url) {
  if (!texturePromiseCache.has(url)) {
    texturePromiseCache.set(url, new Promise((resolve, reject) => {
      textureLoader.load(url, resolve, undefined, (error) => reject(new Error(`${url}: ${error?.message || "load failed"}`)));
    }));
  }
  return texturePromiseCache.get(url);
}

async function loadPbrTextureSet(textureKey) {
  const entry = PBR_TEXTURE_MANIFEST[textureKey];
  if (!entry) return null;
  try {
    const [map, roughnessMap, metalnessMap, normalMap] = await Promise.all([
      loadTextureCached(entry.color),
      loadTextureCached(entry.roughness),
      loadTextureCached(entry.metalness),
      loadTextureCached(entry.normal),
    ]);
    map.colorSpace = THREE.SRGBColorSpace;
    return { map, roughnessMap, metalnessMap, normalMap };
  } catch (error) {
    console.error(`[water-meter] PBR texture load failed for ${textureKey}: ${error.message}`);
    return null;
  }
}

function clonePbrMap(texture, repeat, colorMap = false) {
  const clone = texture.clone();
  clone.wrapS = THREE.RepeatWrapping;
  clone.wrapT = THREE.RepeatWrapping;
  clone.repeat.set(repeat[0], repeat[1]);
  if (colorMap) clone.colorSpace = THREE.SRGBColorSpace;
  clone.needsUpdate = true;
  return clone;
}

function createTexturedMetalMaterial(textureKey, options = {}) {
  if (!loadedPbrTextureSet || textureKey !== meterConfig.pbr.selectedTextureKey) return null;
  const repeat = options.repeat || [2, 2];
  const calibration = PBR_TEXTURE_CALIBRATION[textureKey] || {};
  const diagnosticRoughness = pbrRoughnessParam !== null && pbrRoughnessParam !== ""
    ? Number(pbrRoughnessParam)
    : Number.NaN;
  const diagnosticMetalness = pbrMetalnessParam !== null && pbrMetalnessParam !== ""
    ? Number(pbrMetalnessParam)
    : Number.NaN;
  const diagnosticNormalScale = pbrNormalScaleParam !== null && pbrNormalScaleParam !== ""
    ? Number(pbrNormalScaleParam)
    : Number.NaN;
  const normalScale = Number.isFinite(diagnosticNormalScale)
    ? diagnosticNormalScale
    : (options.normalScale ?? 0.7);
  const material = new THREE.MeshStandardMaterial({
    color: options.color || 0xffffff,
    map: clonePbrMap(loadedPbrTextureSet.map, repeat, true),
    roughnessMap: pbrRoughnessMapParam === "off"
      ? null
      : clonePbrMap(loadedPbrTextureSet.roughnessMap, repeat),
    metalnessMap: pbrMetalnessMapParam === "off"
      ? null
      : clonePbrMap(loadedPbrTextureSet.metalnessMap, repeat),
    normalMap: clonePbrMap(loadedPbrTextureSet.normalMap, repeat),
    roughness: Number.isFinite(diagnosticRoughness)
      ? diagnosticRoughness
      : (options.roughness ?? 1),
    metalness: Number.isFinite(diagnosticMetalness)
      ? diagnosticMetalness
      : (options.metalness ?? 1),
    normalScale: new THREE.Vector2(normalScale, normalScale),
    side: THREE.DoubleSide,
  });
  material.userData.pbrRole = options.role || "metalPbr";
  material.userData.normalizeExtrudeUVs = true;
  material.userData.extrudeCalibration = {
    roughness: Number.isFinite(diagnosticRoughness)
      ? diagnosticRoughness
      : (calibration.roughness ?? material.roughness),
    metalness: Number.isFinite(diagnosticMetalness)
      ? diagnosticMetalness
      : (calibration.metalness ?? material.metalness),
    normalScale: Number.isFinite(diagnosticNormalScale)
      ? diagnosticNormalScale
      : (calibration.normalScale ?? material.normalScale.x),
  };
  return material;
}

function resolvePbrRepeat(role) {
  const diagnosticRepeat = Number(pbrRepeatParam);
  if (Number.isFinite(diagnosticRepeat) && diagnosticRepeat > 0) {
    return role === "metalConnector" ? [diagnosticRepeat, 1] : [diagnosticRepeat, diagnosticRepeat];
  }
  return role === "metalConnector" ? [2, 1] : [1, 1];
}

function familyAllowsTexturedRole(family, role) {
  const allowed = {
    classic_round: ["metalHousing", "metalBezel", "metalConnector"],
    industrial_window: ["metalHousing", "metalBezel", "metalConnector", "metalMechanical"],
    protective_shell: ["metalBezel", "metalConnector", "metalMechanical"],
    modular_industrial: ["metalHousing", "metalBezel", "metalConnector", "metalMechanical"],
    smart_housing: ["metalBezel", "metalConnector", "metalMechanical"],
  };
  return Boolean(meterConfig.pbr.loaded && allowed[family]?.includes(role));
}

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

async function createSceneEnvironment(rendererInstance, selection) {
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

function applyTrimStyle(trim) {
  const styles = {
    black: [0x111111, 0x496f91],
    dark: [0x17191b, 0x5e676b],
    gray: [0x2f3438, 0x9aa2a6],
    steel: [0x8f979b, 0x5f7484],
    gold: [trim.goldColor || 0xc69b3c, 0xc69b3c],
    bronze: [0x4a3422, 0x8b6b38],
    blueGray: [0x263947, 0x5f7d8f],
    whiteEnamel: [0xf2f0e7, 0x9ba2a0],
  };
  const [primary, secondary] = styles[trim.style] || styles.black;
  trim.primaryTrimColor = primary;
  trim.secondaryTrimColor = secondary;
  if (trim.style === "gold") trim.useGoldTrim = true;
  if (trim.useGoldTrim) {
    trim.primaryTrimColor = trim.goldColor;
    trim.secondaryTrimColor = trim.goldColor;
  }
  trim.digitWindowBorderColor = trim.primaryTrimColor;
  trim.dialBorderColor = trim.primaryTrimColor;
  trim.innerOutlineColor = trim.primaryTrimColor;
}

function createHousingMaterial(config) {
  switch (config.materialType) {
    case "brass":
      return mat(0x9a6d2f, 0.32, 0.85);
    case "darkMetal":
      return mat(0x303236, 0.38, 0.75);
    case "plastic":
      return new THREE.MeshPhysicalMaterial({
        color: config.color,
        metalness: 0,
        roughness: config.roughness,
        clearcoat: 0.18,
        clearcoatRoughness: 0.22,
        side: THREE.DoubleSide,
      });
    case "agedMetal":
      return mat(0x756957, 0.62, 0.65);
    default:
      return mat(config.color, config.roughness, config.metalness);
  }
}

function createFacePlateMaterial(config) {
  return mat(config.color, config.roughness, config.metalness);
}

function createTrimMaterial(config, key = "primaryTrimColor") {
  const color = config.useGoldTrim ? config.goldColor : config[key] || config.primaryTrimColor;
  const metalness = config.useGoldTrim || config.style === "steel" || config.style === "bronze" ? 0.78 : 0.38;
  const roughness = config.useGoldTrim ? 0.28 : config.style === "steel" ? 0.34 : 0.5;
  return mat(color, roughness, metalness);
}

function createGlassMaterial(config) {
  const material = new THREE.MeshPhysicalMaterial({
    color: config.tint,
    metalness: 0,
    roughness: config.roughness,
    transmission: config.transmission,
    thickness: config.thickness,
    ior: config.ior,
    transparent: true,
    opacity: 1,
    clearcoat: config.clearcoat,
    clearcoatRoughness: config.clearcoatRoughness,
    specularIntensity: config.specularIntensity,
    envMapIntensity: config.envMapIntensity,
    side: THREE.FrontSide,
    depthWrite: false,
  });
  return material;
}

const materials = {
  white: createHousingMaterial(meterConfig.housing),
  warmWhite: mat(0xfffbf2, 0.36, 0.58),
  facePlate: createFacePlateMaterial(meterConfig.facePlate),
  dark: mat(0x20272c, 0.5, 0.45),
  black: createTrimMaterial(meterConfig.trim, "digitWindowBorderColor"),
  rubber: mat(0x15191c, 0.78, 0.28),
  blue: mat(0x1268b4, 0.38, 0.55),
  red: mat(0xc41f25, 0.42, 0.55),
  gray: createTrimMaterial(meterConfig.trim, "secondaryTrimColor"),
  metal: mat(0x8d9290, 0.55, 0.7),
  brass: mat(0xa0743c, 0.5, 0.72),
  glass: createGlassMaterial(meterConfig.glass),
  glassEdge: createTrimMaterial(meterConfig.trim, "secondaryTrimColor"),
};
const selectedTextureKey = meterConfig.pbr.selectedTextureKey;
materials.metalHousing = familyAllowsTexturedRole(meterConfig.family, "metalHousing")
  ? createTexturedMetalMaterial(selectedTextureKey, { role: "metalHousing", repeat: resolvePbrRepeat("metalHousing"), normalScale: 0.55 })
  : null;
materials.metalBezel = familyAllowsTexturedRole(meterConfig.family, "metalBezel")
  ? createTexturedMetalMaterial(selectedTextureKey, { role: "metalBezel", repeat: resolvePbrRepeat("metalBezel"), normalScale: 0.48 })
  : null;
materials.metalConnector = familyAllowsTexturedRole(meterConfig.family, "metalConnector")
  ? createTexturedMetalMaterial(selectedTextureKey, { role: "metalConnector", repeat: resolvePbrRepeat("metalConnector"), normalScale: 0.62 })
  : null;
materials.metalMechanical = familyAllowsTexturedRole(meterConfig.family, "metalMechanical")
  ? createTexturedMetalMaterial(selectedTextureKey, { role: "metalMechanical", repeat: resolvePbrRepeat("metalMechanical"), normalScale: 0.52 })
  : null;
materials.metalDetail = meterConfig.pbr.loaded
  ? createTexturedMetalMaterial(selectedTextureKey, { role: "metalDetail", repeat: [1, 1], normalScale: 0.58 })
  : null;

function metalRoleMaterial(role, fallback) {
  return materials[role] || fallback;
}

const brands = ["elster", "HYDROMAX", "AQUOR", "METRON", "SENSUS", "KENSUI", "ZENNER"];
const models = ["J20", "B-H A-V", "LX", "Qn", "TRP", "WM", "MS"];
const brandName = choice(brands);
const serial = `${choice(["J20MU", "B89", "SN", "MTR"])}${randInt(100000, 999999)}${choice(["", " L", "A", "B"])}`;
const shell = makeShell();
const faceLayout = createFaceLayout(shell);
layoutState.faceLayout = faceLayout;

if (!meterConfig.output.transparentBackground) addStudioBackdrop();
addLights();
drawPipeAssembly(shell);
drawBackHousing(shell);
drawFamilyStructures(shell);
drawShell(shell);
placeScrews(shell);
const digitWindow = placeDigitRegister(shell, faceLayout);
const center = placeCenterElement(shell, faceLayout, digitWindow);
placeDials(shell, faceLayout, digitWindow, center);
placeLabels(shell, faceLayout, digitWindow, center);
drawGlassCover(shell);
layoutState.validation = validateFinalLayout(shell, digitWindow);

renderer.render(scene, camera);
const annotationMeta = buildAnnotationMeta();
const maskMaterial = new THREE.MeshBasicMaterial({
  color: 0x000000,
  transparent: false,
  opacity: 1,
  toneMapped: false,
  vertexColors: false,
  side: THREE.DoubleSide,
  depthTest: true,
  depthWrite: true,
});
let maskRenderState = null;

function renderWaterMeterMask() {
  if (maskRenderState) return;

  const hiddenObjects = [];
  root.traverse((object) => {
    if (object.userData.excludeFromMask && object.visible) {
      hiddenObjects.push(object);
      object.visible = false;
    }
  });

  maskRenderState = {
    background: scene.background,
    environment: scene.environment,
    environmentIntensity: scene.environmentIntensity,
    environmentRotation: scene.environmentRotation.clone(),
    fog: scene.fog,
    overrideMaterial: scene.overrideMaterial,
    clearColor: renderer.getClearColor(new THREE.Color()).clone(),
    clearAlpha: renderer.getClearAlpha(),
    toneMapping: renderer.toneMapping,
    toneMappingExposure: renderer.toneMappingExposure,
    shadowMapEnabled: renderer.shadowMap.enabled,
    hiddenObjects,
  };

  scene.background = new THREE.Color(0xffffff);
  scene.environment = null;
  scene.environmentIntensity = 0;
  scene.environmentRotation.set(0, 0, 0);
  scene.fog = null;
  scene.overrideMaterial = maskMaterial;
  renderer.setClearColor(0xffffff, 1);
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = false;
  renderer.render(scene, camera);
  window.__waterMeterMaskReady = true;
}

function restoreWaterMeterRender() {
  if (!maskRenderState) return;
  const state = maskRenderState;
  maskRenderState = null;

  scene.background = state.background;
  scene.environment = state.environment;
  scene.environmentIntensity = state.environmentIntensity;
  scene.environmentRotation.copy(state.environmentRotation);
  scene.fog = state.fog;
  scene.overrideMaterial = state.overrideMaterial;
  renderer.setClearColor(state.clearColor, state.clearAlpha);
  renderer.toneMapping = state.toneMapping;
  renderer.toneMappingExposure = state.toneMappingExposure;
  renderer.shadowMap.enabled = state.shadowMapEnabled;
  state.hiddenObjects.forEach((object) => {
    object.visible = true;
  });
  renderer.render(scene, camera);
  window.__waterMeterMaskReady = false;
}

if (registerGlyphDiagnosticParam) {
  const diagnosticCanvas = createRegisterGlyphDiagnosticCanvas();
  renderer.domElement.replaceWith(diagnosticCanvas);
  window.__registerGlyphDiagnosticCanvas = diagnosticCanvas;
}

window.__waterMeterReady = true;
window.__waterMeterMaskReady = false;
window.__renderWaterMeterMask = renderWaterMeterMask;
window.__restoreWaterMeterRender = restoreWaterMeterRender;
window.__waterMeterMeta = {
  seed: seedParam || "random",
  preset: meterConfig.presetName,
  family: meterConfig.family,
  layout_preset: meterConfig.layoutPreset,
  size: [WIDTH, HEIGHT],
  mode: "three-js-3d-front-view",
  occupied: occupied.length,
  digit_count: meterConfig.digitRegister.selectedDigitCount,
  digit_count_source: meterConfig.digitRegister.digitCountSource,
  red_digit_count: meterConfig.digitRegister.redDigitCount,
  register_glyph_diagnostics: registerGlyphDiagnostics,
  dial_count: layoutState.dials.length,
  texture_mode: meterConfig.pbr.mode,
  texture_set: meterConfig.pbr.selectedTextureKey,
  texture_loaded: meterConfig.pbr.loaded,
  pbr_repeat: {
    metalHousing: resolvePbrRepeat("metalHousing"),
    metalBezel: resolvePbrRepeat("metalBezel"),
    metalConnector: resolvePbrRepeat("metalConnector"),
    metalMechanical: resolvePbrRepeat("metalMechanical"),
  },
  pbr_extrude_uv_normalized: normalizePbrExtrudeUVs,
  pbr_extrude_uv_stats: pbrUvNormalizationStats,
  face_plate: {
    key: meterConfig.facePlate.key,
    color: meterConfig.facePlate.color,
    dark: meterConfig.facePlate.dark,
    selection_source: meterConfig.facePlate.selectionSource,
  },
  lighting_mode: meterConfig.lighting.mode,
  environmentMode: environmentState.mode,
  requestedEnvironmentKey: environmentState.requestedKey,
  selectedEnvironmentKey: environmentState.selectedKey,
  environmentLoaded: environmentState.loaded,
  environmentFallback: environmentState.fallback,
  environmentIntensity: environmentState.intensity,
  environmentRotation: environmentState.rotationDegrees,
  lightingWithEnvironment: meterConfig.lighting.withEnvironment,
  textured_roles: ["metalHousing", "metalBezel", "metalConnector", "metalMechanical"]
    .filter((role) => Boolean(materials[role])),
  textured_components: materials.metalDetail ? ["center_gear", "screws"] : [],
  metal_detail_texture: materials.metalDetail ? meterConfig.pbr.selectedTextureKey : null,
  layout_validation: layoutState.validation,
  finalized_configuration: JSON.parse(JSON.stringify(meterConfig)),
  ...annotationMeta,
};

if (!exportMode) {
  window.addEventListener("click", () => {
    const next = new URLSearchParams(window.location.search);
    next.set("seed", String(Date.now()));
    next.set("w", String(WIDTH));
    next.set("h", String(HEIGHT));
    window.location.search = `?${next.toString()}`;
  });
}

function addLights() {
  const lightCfg = meterConfig.lighting;
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

function addStudioBackdrop() {
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

function makeShell() {
  const faceShape = meterConfig.shape.faceShape;
  const shape = faceShape === "roundedSquare" ? "roundedRect" : faceShape === "oval" ? "ellipse" : "circle";
  let scaleX = rand(0.92, 1.05);
  let scaleY = rand(0.88, 1.02);
  if (shape === "circle") {
    scaleX = 1;
    scaleY = 1;
  } else if (shape === "ellipse") {
    const aspect = meterConfig.shape.ovalAspectRatio;
    if (rng() > 0.22) {
      scaleX = aspect;
      scaleY = 1 / rand(1.02, 1.12);
    } else {
      scaleX = 1 / rand(1.02, 1.12);
      scaleY = aspect;
    }
  } else {
    scaleX *= meterConfig.shape.width;
    scaleY *= meterConfig.shape.height;
  }
  const outerRange = meterConfig.shape.outerRange || [404, 452];
  const rimRange = meterConfig.shape.rimRange || [34, 54];
  const outer = rand(outerRange[0], outerRange[1]);
  const rim = rand(rimRange[0], rimRange[1]);
  const inner = outer - rim - rand(10, 24);
  return { shape, scaleX, scaleY, outer, rim, inner };
}

function createFaceLayout(s) {
  const halfWidth = (s.inner - 48) * s.scaleX;
  const halfHeight = (s.inner - 48) * s.scaleY;
  const band = (bottom, top) => ({
    x: -halfWidth,
    y: bottom * halfHeight,
    w: halfWidth * 2,
    h: (top - bottom) * halfHeight,
  });
  return {
    halfWidth,
    halfHeight,
    brand: band(0.62, 0.8),
    register: band(0.29, 0.56),
    gear: band(-0.08, 0.23),
    dial: band(-0.65, -0.19),
    bottomText: band(-0.82, -0.68),
  };
}

function faceHalfWidthAtY(s, y, margin = 20) {
  const rx = Math.max(1, (s.inner - margin) * s.scaleX);
  const ry = Math.max(1, (s.inner - margin) * s.scaleY);
  if (s.shape === "roundedRect" || s.shape === "squircle") return rx;
  const normalizedY = THREE.MathUtils.clamp(y / ry, -0.999, 0.999);
  return rx * Math.sqrt(Math.max(0, 1 - normalizedY * normalizedY));
}

function assertSingleCreation(key) {
  layoutState.creation[key] += 1;
  if (layoutState.creation[key] !== 1) {
    throw new Error(`Duplicate semantic component: ${key}`);
  }
}

function drawPipeAssembly(s) {
  const pipeKind = choice(["brass", "steel", "white"]);
  const plainPipeMat = pipeKind === "brass" ? materials.brass : pipeKind === "steel" ? materials.metal : materials.white;
  const pipeMat = metalRoleMaterial("metalConnector", plainPipeMat);
  const pipeY = rand(meterConfig.connectors.yRange[0], meterConfig.connectors.yRange[1]);
  const pipeRadius = rand(meterConfig.connectors.radiusRange[0], meterConfig.connectors.radiusRange[1]);
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(pipeRadius, pipeRadius, meterConfig.connectors.length, 64), pipeMat);
  pipe.rotation.z = Math.PI / 2;
  pipe.position.set(0, pipeY, -68);
  pipe.castShadow = true;
  pipe.receiveShadow = true;
  root.add(pipe);

  for (const side of [-1, 1]) {
    const nut = new THREE.Mesh(new THREE.CylinderGeometry(pipeRadius * 1.65, pipeRadius * 1.65, rand(58, 88), 6), pipeMat);
    nut.rotation.z = Math.PI / 2;
    nut.position.set(side * rand(410, 460), pipeY, -56);
    nut.castShadow = true;
    root.add(nut);
    drawThreadRidges(side * rand(505, 540), pipeY, pipeRadius * 0.88, side, pipeMat);
  }
}

function drawThreadRidges(x, y, radius, side, pipeMat) {
  const count = randInt(5, 9);
  for (let i = 0; i < count; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 2.4, 8, 48), pipeMat);
    ring.rotation.y = Math.PI / 2;
    ring.position.set(x + side * i * 9, y, -48);
    root.add(ring);
  }
}

// Changed section: 3D base/body addition.
// A thick rear housing sits behind the existing face details so perspective views reveal real depth.
function drawBackHousing(s) {
  const depth = meterConfig.shape.bodyDepth * meterConfig.housing.thicknessScale;
  const z = -112;
  // Keep the broad backing plain so transmissive glass cannot project a rear PBR texture onto the face.
  const bodyMat = materials.facePlate;
  const plainSideMat = createHousingMaterial({ ...meterConfig.housing, roughness: Math.min(0.85, meterConfig.housing.roughness + 0.12) });
  const sideMat = metalRoleMaterial("metalHousing", plainSideMat);

  if (s.shape === "circle" || s.shape === "ellipse") {
    const r = s.outer + rand(18, 30);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.98, depth, 144), bodyMat);
    body.rotation.x = Math.PI / 2;
    body.scale.y = s.scaleY / s.scaleX;
    body.scale.x = s.scaleX;
    body.position.z = z + depth / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    root.add(body);

    const rearRim = new THREE.Mesh(new THREE.TorusGeometry(r, 7.5, 14, 144), sideMat);
    rearRim.scale.x = s.scaleX;
    rearRim.scale.y = s.scaleY;
    rearRim.position.z = z + 4;
    root.add(rearRim);
    drawOuterProtrusions(s, r, z + depth * 0.52, sideMat);
    return;
  }

  const bodyShape = shellShape(s.shape, (s.outer + 24) * s.scaleX, (s.outer + 24) * s.scaleY, shellCornerRadius(s, 1.1));
  root.add(extruded(bodyShape, bodyMat, 0, 0, z, depth, meterConfig.shape.edgeBevelSize));
  const rearShape = shellShape(s.shape, (s.outer + 16) * s.scaleX, (s.outer + 16) * s.scaleY, shellCornerRadius(s, 1.0));
  root.add(extruded(rearShape, sideMat, 0, 0, z - 8, 12, meterConfig.shape.edgeBevelSize * 0.75));
  drawOuterProtrusions(s, s.outer + 20, z + depth * 0.52, sideMat);
}

function drawFamilyStructures(s) {
  const family = meterConfig.family;
  const side = meterConfig.modules.side || 1;
  const addModule = (w, h, depth, x, y, z, material = materials.white, radius = 28) => {
    const module = roundedBox(w, h, depth, Math.min(radius, w * 0.22, h * 0.22), material, x, y, z);
    module.castShadow = true;
    module.receiveShadow = true;
    root.add(module);
    layoutState.modules.push({ type: meterConfig.modules.type, x, y, w, h });
    return module;
  };

  if (family === "classic_round" && meterConfig.cover.type === "hinged_lid") {
    assertSingleCreation("lid");
    const direction = meterConfig.cover.side;
    const lidR = s.outer * 0.44;
    const offset = s.outer + lidR + 36;
    const x = direction === "left" ? -offset * s.scaleX : direction === "right" ? offset * s.scaleX : 0;
    const y = direction === "up" ? offset * s.scaleY : 0;
    layoutState.lid = { x, y, r: lidR };
    root.add(cylinderDisc(x, y, lidR, 20, materials.white, -116, 120));
    root.add(cylinderRing(x, y, lidR * 0.78, lidR * 0.94, 10, metalRoleMaterial("metalBezel", materials.gray), -92));
    addModule(72, 38, 28, x * 0.42, y * 0.42, -36, metalRoleMaterial("metalConnector", materials.metal), 12);
  } else if (family === "industrial_window") {
    addModule(s.outer * 1.28 * s.scaleX, 72, 34, 0, s.outer * 0.7 * s.scaleY, -12, metalRoleMaterial("metalHousing", materials.white), 20);
    addModule(s.outer * 0.94 * s.scaleX, 58, 30, side * s.outer * 0.08, -s.outer * 0.74 * s.scaleY, -8, metalRoleMaterial("metalMechanical", materials.gray), 18);
  } else if (family === "protective_shell") {
    addModule(s.outer * 0.42, s.outer * 1.08 * s.scaleY, 68, side * s.outer * 0.83 * s.scaleX, -24, -46, materials.white, 42);
    root.add(cylinderDisc(side * s.outer * 1.01 * s.scaleX, -s.outer * 0.12, 42, 44, metalRoleMaterial("metalConnector", materials.gray), -8));
  } else if (family === "modular_industrial") {
    addModule(s.outer * 0.92 * s.scaleX, s.outer * 0.34, 46, side * s.outer * 0.12, -s.outer * 0.77 * s.scaleY, -18, metalRoleMaterial("metalMechanical", materials.gray), 34);
    addModule(s.outer * 0.3, s.outer * 0.58, 52, -side * s.outer * 0.82 * s.scaleX, -s.outer * 0.08, -36, metalRoleMaterial("metalHousing", materials.white), 30);
  } else if (family === "smart_housing") {
    addModule(s.outer * 0.38, s.outer * 0.76 * s.scaleY, 58, side * s.outer * 0.87 * s.scaleX, -26, -28, materials.white, 38);
    if (meterConfig.modules.count > 1) {
      addModule(s.outer * 0.24, s.outer * 0.48 * s.scaleY, 42, -side * s.outer * 0.88 * s.scaleX, -s.outer * 0.08, -34, materials.gray, 28);
    }
    root.add(cylinderDisc(side * s.outer * 0.96 * s.scaleX, s.outer * 0.12, 24, 12, metalRoleMaterial("metalMechanical", materials.dark), 24));
  }
}

function drawShell(s) {
  const outer = shellShape(s.shape, s.outer * s.scaleX, s.outer * s.scaleY, shellCornerRadius(s, 1));
  const innerHole = shellShape(s.shape, s.inner * s.scaleX, s.inner * s.scaleY, shellCornerRadius(s, 0.72));
  outer.holes.push(innerHole);
  root.add(extruded(outer, metalRoleMaterial("metalBezel", materials.white), 0, 0, -2, meterConfig.shape.bezelDepth, meterConfig.shape.edgeBevelSize));

  const outerRimWidth = Math.max(10, s.inner * meterConfig.shape.outerRimThickness);
  const innerRimWidth = Math.max(5, s.inner * meterConfig.shape.innerRimThickness);
  const gasket = shellShape(s.shape, (s.inner + outerRimWidth) * s.scaleX, (s.inner + outerRimWidth) * s.scaleY, shellCornerRadius(s, 0.68));
  const faceHole = shellShape(s.shape, (s.inner - innerRimWidth) * s.scaleX, (s.inner - innerRimWidth) * s.scaleY, shellCornerRadius(s, 0.6));
  gasket.holes.push(faceHole);
  root.add(extruded(gasket, materials.rubber, 0, 0, 18, meterConfig.shape.outerRimHeight, 2));

  const face = shellShape(s.shape, (s.inner - 22) * s.scaleX, (s.inner - 22) * s.scaleY, shellCornerRadius(s, 0.56));
  assertSingleCreation("mainFace");
  layoutState.mainFace = {
    x: 0,
    y: 0,
    rx: (s.inner - 22) * s.scaleX,
    ry: (s.inner - 22) * s.scaleY,
  };
  root.add(extruded(face, materials.facePlate, 0, 0, 19, meterConfig.shape.facePlateDepth, 2));

  const ringRange = meterConfig.trimStructure.ringCountRange;
  const trimCount = randInt(ringRange[0], ringRange[1]);
  for (let i = 0; i < trimCount; i++) {
    const r = s.inner - 42 - i * rand(16, 24);
    const line = tubePolyline(shellPoints(s.shape, r * s.scaleX, r * s.scaleY, 110), i === 0 ? createTrimMaterial(meterConfig.trim, "innerOutlineColor") : materials.gray, rand(1.2, 2.8), 30 + i * 2);
    root.add(line);
  }

  if (rng() > 0.35) {
    const notchCount = randInt(3, 6);
    for (let i = 0; i < notchCount; i++) {
      const a = (i / notchCount) * Math.PI * 2 + rand(-0.12, 0.12);
      const x = Math.cos(a) * (s.outer + 5) * s.scaleX;
      const y = Math.sin(a) * (s.outer + 5) * s.scaleY;
      const latch = roundedBox(rand(42, 70), rand(22, 32), 16, 7, materials.white);
      latch.position.set(x, y, 34);
      latch.rotation.z = a;
      root.add(latch);
    }
  }
}

function shellCornerRadius(s, multiplier = 1) {
  const base = Math.min(s.outer * s.scaleX, s.outer * s.scaleY) * meterConfig.shape.cornerRadius;
  return base * multiplier;
}

function drawOuterProtrusions(s, radius, z, material) {
  if (!meterConfig.housing.addOuterProtrusions) return;
  const count = meterConfig.housing.protrusionCount;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + Math.PI / count;
    const x = Math.cos(a) * radius * s.scaleX;
    const y = Math.sin(a) * radius * s.scaleY;
    const protrusion = roundedBox(
      meterConfig.housing.protrusionWidth,
      28 + meterConfig.housing.protrusionDepth,
      18,
      12,
      material
    );
    protrusion.position.set(x, y, z);
    protrusion.rotation.z = a;
    root.add(protrusion);
  }
}

function drawGlassCover(s) {
  if (!meterConfig.glass.enabled) return;
  const glassR = s.inner + rand(8, 18);
  const cover = new THREE.Mesh(makeGlassDomeGeometry(s, glassR), materials.glass);
  cover.position.z = meterConfig.glass.offsetZ;
  cover.renderOrder = 120;
  root.add(cover);

  const rimDepth = Math.max(4, meterConfig.glass.thickness);
  const rim = shapeRingMesh(
    s,
    glassR + 7,
    glassR - 2,
    rimDepth,
    materials.glassEdge,
    meterConfig.glass.offsetZ - 2
  );
  rim.renderOrder = 118;
  root.add(rim);

  if (meterConfig.glass.useSubtleReflectionOverlay) drawReflectionOverlay(s, glassR);
}

function makeGlassDomeGeometry(s, radius) {
  const rx = radius * s.scaleX;
  const ry = radius * s.scaleY;
  const curvature = meterConfig.glass.curvature;
  const radialSegments = 14;
  const angularSegments = 160;
  const vertices = [0, 0, curvature];
  const indices = [];

  for (let ring = 1; ring <= radialSegments; ring++) {
    const t = ring / radialSegments;
    const z = curvature * (1 - t * t);
    for (let i = 0; i < angularSegments; i++) {
      const a = (i / angularSegments) * Math.PI * 2;
      const p = glassProfilePoint(s, rx, ry, a, t);
      vertices.push(p.x, p.y, z);
    }
  }

  for (let i = 0; i < angularSegments; i++) {
    indices.push(0, 1 + ((i + 1) % angularSegments), 1 + i);
  }
  for (let ring = 1; ring < radialSegments; ring++) {
    const prev = 1 + (ring - 1) * angularSegments;
    const next = 1 + ring * angularSegments;
    for (let i = 0; i < angularSegments; i++) {
      const a = prev + i;
      const b = prev + ((i + 1) % angularSegments);
      const c = next + i;
      const d = next + ((i + 1) % angularSegments);
      indices.push(a, d, b, a, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function glassProfilePoint(s, rx, ry, angle, scale) {
  if (s.shape === "roundedRect" || s.shape === "squircle") {
    const exponent = 4.2;
    const c = Math.cos(angle);
    const sn = Math.sin(angle);
    const denom = Math.pow(Math.pow(Math.abs(c), exponent) + Math.pow(Math.abs(sn), exponent), 1 / exponent) || 1;
    return {
      x: (rx * c * scale) / denom,
      y: (ry * sn * scale) / denom,
    };
  }
  return {
    x: Math.cos(angle) * rx * scale,
    y: Math.sin(angle) * ry * scale,
  };
}

function shapeRingMesh(s, outerR, innerR, depth, material, z) {
  const outer = shellShape(s.shape, outerR * s.scaleX, outerR * s.scaleY, shellCornerRadius(s, 0.56));
  const inner = shellShape(s.shape, innerR * s.scaleX, innerR * s.scaleY, shellCornerRadius(s, 0.5));
  outer.holes.push(inner);
  return extruded(outer, material, 0, 0, z, depth, 1.5);
}

function drawReflectionOverlay(s, radius) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(meterConfig.glass.reflectionAngle);
  const grad = ctx.createLinearGradient(-220, 0, 220, 0);
  grad.addColorStop(0, "rgba(255,255,255,0)");
  grad.addColorStop(0.45, `rgba(255,255,255,${meterConfig.glass.reflectionOpacity})`);
  grad.addColorStop(0.55, `rgba(255,255,255,${meterConfig.glass.reflectionOpacity * 0.75})`);
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  roundRectPath(ctx, -210, -18, 420, 36, 18);
  ctx.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    depthTest: false,
  });
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(meterConfig.glass.reflectionScaleX, meterConfig.glass.reflectionScaleY),
    material
  );
  plane.position.set(meterConfig.glass.reflectionOffsetX, meterConfig.glass.reflectionOffsetY, meterConfig.glass.offsetZ + meterConfig.glass.curvature + 4);
  plane.rotation.z = meterConfig.glass.reflectionAngle;
  plane.renderOrder = 130;
  root.add(plane);
}

function placeScrews(s) {
  const count = randInt(meterConfig.screws.countRange[0], meterConfig.screws.countRange[1]);
  const start = rand(0, Math.PI * 2);
  const radiusX = (s.inner + 14) * s.scaleX;
  const radiusY = (s.inner + 14) * s.scaleY;
  const screwMaterial = materials.metalDetail || materials.metal;
  for (let i = 0; i < count; i++) {
    const a = start + (i / count) * Math.PI * 2 + rand(-0.12, 0.12);
    const x = Math.cos(a) * radiusX;
    const y = Math.sin(a) * radiusY;
    const r = rand(12, 18);
    const screw = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.92, 8, 48), screwMaterial);
    screw.rotation.x = Math.PI / 2;
    screw.position.set(x, y, 45);
    root.add(screw);

    const slot = roundedBox(r * 1.4, r * 0.23, 3, 1.5, materials.dark);
    slot.position.set(x, y, 51);
    slot.rotation.z = a + rand(-0.5, 0.5);
    root.add(slot);
    occupied.push(padRect({ x: x - r, y: y - r, w: r * 2, h: r * 2 }, 9));
  }
}

function placeDigitRegister(s, faceLayout) {
  assertSingleCreation("register");
  const digits = selectDigitCount();
  const registerCfg = meterConfig.registerLayout;
  // Preserve the original three RNG draws so downstream seeded layout remains unchanged.
  const cellShapeSample = rng();
  const frameShapeSample = rng();
  const heightSample = rng();
  const familyScale = REGISTER_SCALE * Math.sqrt(registerCfg.widthScale * registerCfg.heightScale);
  const targetCellAspect = 0.76 + cellShapeSample * 0.1;
  const designWheelH = (44 + heightSample * 8) * familyScale;
  const designRegisterH = designWheelH + (7 + heightSample * 3) * familyScale;
  const targetRegisterAspect = 8.05 + frameShapeSample * 0.4;
  const designRegisterW = designRegisterH * targetRegisterAspect;
  const band = faceLayout.register;
  const registerCy = band.y + band.h / 2 + rand(-band.h * 0.025, band.h * 0.025);
  const maxH = band.h * 0.82;
  const provisionalH = Math.min(designRegisterH, maxH);
  const availableHalfWidth = Math.min(
    faceHalfWidthAtY(s, registerCy - provisionalH / 2, 42),
    faceHalfWidthAtY(s, registerCy + provisionalH / 2, 42)
  ) - 22;
  const maxW = Math.max(1, availableHalfWidth * 2);
  const fitScale = Math.min(1, maxH / designRegisterH, maxW / designRegisterW);
  const w = designRegisterW * fitScale;
  const h = designRegisterH * fitScale;
  const box = { x: -w / 2, y: registerCy - h / 2, w, h };
  if (!insideShell(box, s)) {
    throw new Error(`Register band does not fit ${meterConfig.family}/${meterConfig.layoutPreset}`);
  }
  occupied.push(padRect(box, 20));
  layoutState.register = { ...box };

  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const frameGap = 4 * fitScale;
  const apertureLip = 2 * fitScale;
  const digitInset = 3 * fitScale;
  const apertureW = box.w - 2 * (frameGap + apertureLip);
  const apertureH = box.h - 2 * (frameGap + apertureLip);
  const slotGap = 1.8 * fitScale;
  const slotW = (apertureW - slotGap * (digits - 1)) / digits;
  const wheelH = apertureH;
  const wheelW = Math.min(slotW - 4 * fitScale, wheelH * targetCellAspect);
  const digitPlaneW = slotW - digitInset;
  const digitPlaneH = wheelH - digitInset;
  root.add(roundedBox(box.w, box.h, 16, 9 * fitScale, materials.dark, cx, cy, 46));
  root.add(roundedBox(box.w - 2 * frameGap, box.h - 2 * frameGap, 8, 6 * fitScale, materials.black, cx, cy, 55));
  root.add(roundedBox(apertureW, apertureH, 4, 3 * fitScale, materials.gray, cx, cy, 58));

  const number = Array.from({ length: digits }, () => randInt(0, 9));
  const redDigitCount = Math.min(digits - 1, Math.max(0, registerCfg.redDigitCount));
  meterConfig.digitRegister.redDigitCount = redDigitCount;
  const startX = cx - ((digits - 1) * (slotW + slotGap)) / 2;
  annotationState.wheelReading = "";
  annotationState.digits = [];
  annotationState.wheel = { cx, cy, w: apertureW, h: apertureH, z: 70 };
  for (let i = 0; i < digits; i++) {
    const wheelCenterX = startX + i * (slotW + slotGap);
    const wheelCenterY = cy;
    const red = redDigitCount > 0 && i >= digits - redDigitCount;
    const wheel = roundedBox(slotW, wheelH, 9, 2.5 * fitScale, red ? materials.red : materials.warmWhite, wheelCenterX, wheelCenterY, 63);
    root.add(wheel);
    const currentDigit = number[i];
    const isRollingWheel = i === digits - 1 || rng() > 0.62;
    const rollProgress = isRollingWheel ? rand(0.55, 0.86) : 0;
    const theta = rollProgress * Math.PI * 2;
    const wheelTexture = makeRollingDigitTexture(currentDigit, theta, red, slotW, wheelH, wheelW);
    const digitPlane = texturePlane(wheelTexture, digitPlaneW, digitPlaneH, wheelCenterX, wheelCenterY, 70);
    digitPlane.renderOrder = 50 + i;
    root.add(digitPlane);
    if (i > 0) root.add(roundedBox(1.8 * fitScale, wheelH, 2, fitScale, materials.gray, wheelCenterX - (slotW + slotGap) / 2, wheelCenterY, 66));
    const gtFloat = currentDigit + rollProgress;
    annotationState.wheelReading += String(Math.floor(gtFloat) % 10);
    annotationState.digits.push({
      pos: i,
      gt_float: Number(gtFloat.toFixed(6)),
      value: currentDigit,
      is_decimal: red,
      cx: wheelCenterX,
      cy: wheelCenterY,
      w: digitPlaneW,
      h: digitPlaneH,
      z: 70,
    });
  }
  return box;
}

function placeCenterElement(s, faceLayout, digitWindow) {
  assertSingleCreation("centerGear");
  const compactFamily = meterConfig.family === "industrial_window" || meterConfig.family === "smart_housing" || meterConfig.family === "protective_shell";
  const band = faceLayout.gear;
  const maxSizeFromBand = Math.max(30, band.h * 0.45 / 1.05);
  const sampledSize = compactFamily ? rand(34, 48) : rand(38, 52);
  const size = Math.min(sampledSize, maxSizeFromBand);
  const radius = size * 1.05;
  const y = band.y + band.h / 2;
  const xLimit = Math.max(0, faceHalfWidthAtY(s, y, 40) - radius - 24);
  const x = rand(-0.42, 0.42) * xLimit;
  const rect = { x: x - radius, y: y - radius, w: radius * 2, h: radius * 2 };
  if (!insideFaceCircle({ x, y, r: radius }, s) || circleIntersectsRect({ x, y, r: radius }, digitWindow, 16)) {
    throw new Error(`Center gear band does not fit ${meterConfig.family}/${meterConfig.layoutPreset}`);
  }
  occupied.push(padRect(rect, 15));
  layoutState.centerGear = { x, y, r: radius, box: { ...rect } };

  root.add(cylinderDisc(x, y, radius, 12, materials.metalDetail || materials.gray, 43));
  root.add(cylinderRing(x, y, size * 0.72, size * 0.98, 8, materials.dark, 53));
  const blades = randInt(6, 10);
  drawGear(x, y, size * 0.78, blades + randInt(7, 10), 61);
  return rect;
}

function placeDials(s, faceLayout, digitWindow) {
  const dialCfg = meterConfig.dialLayout;
  const count = Math.max(1, Math.min(3, dialCfg.count));
  const multipliers = shuffle(["x0.1", "x0.01", "x0.001", "x0.0001", "x10"]);
  const placed = [];
  const band = faceLayout.dial;
  const y = band.y + band.h / 2;
  const slotFractions = count === 1
    ? [choice([-0.28, 0, 0.28])]
    : count === 2
      ? [-0.36, 0.36]
      : [-0.48, 0, 0.48];
  const slotHalfWidth = faceHalfWidthAtY(s, y, 42);
  const countScale = count === 1 ? 1 : count === 2 ? 0.78 : 0.62;
  const maxBandRadius = Math.max(38, band.h * 0.43);

  for (let index = 0; index < slotFractions.length; index++) {
    const slotX = slotFractions[index] * slotHalfWidth;
    const sampledRadius = Math.min(
      maxBandRadius,
      rand(dialCfg.radiusRange[0], dialCfg.radiusRange[1]) * DIAL_SCALE * countScale
    );
    let dial = null;
    for (const scale of [1, 0.92, 0.84, 0.76, 0.68]) {
      const r = sampledRadius * scale;
      const x = slotX;
      const circle = { x, y, r: r + 5 };
      if (!insideFaceCircle(circle, s)) continue;
      if (circleIntersectsRect(circle, digitWindow, 14)) continue;
      if (circlesOverlap(circle, layoutState.centerGear, 14)) continue;
      if (placed.some((other) => circlesOverlap(circle, { x: other.x, y: other.y, r: other.r + 5 }, 14))) continue;
      const box = { x: x - r - 10, y: y - r - 30, w: 2 * (r + 10), h: 2 * r + 36 };
      dial = { x, y, r, multiplier: multipliers[index % multipliers.length], box };
      break;
    }
    if (!dial) {
      const r = Math.min(42, maxBandRadius * 0.7);
      const circle = { x: slotX, y, r: r + 5 };
      if (!insideFaceCircle(circle, s)
        || circleIntersectsRect(circle, digitWindow, 8)
        || circlesOverlap(circle, layoutState.centerGear, 8)
        || placed.some((other) => circlesOverlap(circle, { x: other.x, y: other.y, r: other.r + 5 }, 8))) {
        throw new Error(`Known-valid dial slot failed for ${meterConfig.family}/${meterConfig.layoutPreset}/slot_${index}`);
      }
      dial = {
        x: slotX,
        y,
        r,
        multiplier: multipliers[index % multipliers.length],
        box: { x: slotX - r - 10, y: y - r - 30, w: 2 * (r + 10), h: 2 * r + 36 },
      };
    }
    placed.push(dial);
    occupied.push(padRect(dial.box, 8));
  }

  layoutState.dials = placed.map(({ x, y, r, multiplier, box }) => ({ x, y, r, multiplier, box: { ...box } }));
  for (const dial of placed) drawDial(dial);
}

function drawDial({ x, y, r, multiplier }) {
  root.add(cylinderDisc(x, y, r + 5, 8, materials.dark, 47));
  root.add(cylinderDisc(x, y, r, 7, materials.warmWhite, 55));
  root.add(cylinderRing(x, y, r * 0.82, r * 0.88, 3, materials.gray, 63));
  const ticks = 100;
  for (let i = 0; i < ticks; i++) {
    const a = dialAngle(i / ticks);
    const major = i % 10 === 0;
    const len = major ? r * 0.18 : r * 0.075;
    const w = major ? Math.max(1.7, r * 0.023) : Math.max(0.75, r * 0.011);
    const tick = roundedBox(w, len, 1.8, 0.6, materials.black);
    tick.position.set(x + Math.cos(a) * (r - 8 - len / 2), y + Math.sin(a) * (r - 8 - len / 2), 68);
    tick.rotation.z = a - Math.PI / 2;
    root.add(tick);
  }
  for (let n = 0; n < 10; n++) {
    const a = dialAngle(n / 10);
    addText(String(n), x + Math.cos(a) * r * 0.56, y + Math.sin(a) * r * 0.56, {
      size: r * 0.145 * DIAL_DIGIT_SCALE,
      color: "#20272d",
      width: r * 0.34,
      height: r * 0.3,
      z: 70,
      weight: choice(["400", "500", "600", "700", "800", "900"]),
      strokeWidth: rand(0, 1.2),
      renderOrder: 88,
    });
  }
  const handTick = randInt(0, 99);
  const handAngle = dialAngle(handTick / 100);
  const pointerLength = r * rand(0.72, 0.82);
  const pointerWidth = r * rand(0.12, 0.18);
  root.add(taperedPointer(x, y, pointerLength, pointerWidth, handAngle, 75));
  root.add(cylinderDisc(x, y, r * 0.12, 8, materials.red, 80));
  addText(multiplier, x, y - r - 15, { size: 16, color: "#0e4f9a", width: r * 1.4, height: 24, z: 72, weight: "700" });
}

function dialAngle(unit) {
  return -Math.PI / 2 + unit * Math.PI * 2;
}

function taperedPointer(x, y, length, maxWidth, angle, z) {
  const baseW = maxWidth;
  const neckW = maxWidth * 0.46;
  const tipW = Math.max(1.2, maxWidth * 0.12);
  const tail = maxWidth * 0.22;
  const shape = new THREE.Shape();
  shape.moveTo(-baseW * 0.5, -tail);
  shape.bezierCurveTo(-baseW * 0.55, length * 0.14, -neckW * 0.75, length * 0.46, -tipW * 0.5, length * 0.88);
  shape.lineTo(0, length);
  shape.lineTo(tipW * 0.5, length * 0.88);
  shape.bezierCurveTo(neckW * 0.75, length * 0.46, baseW * 0.55, length * 0.14, baseW * 0.5, -tail);
  shape.quadraticCurveTo(0, -tail * 1.25, -baseW * 0.5, -tail);
  const pointer = extruded(shape, materials.red, x, y, z, 6, 1.2);
  pointer.rotation.z = angle - Math.PI / 2;
  pointer.castShadow = true;
  return pointer;
}

function placeLabels(s, faceLayout, digitWindow) {
  const primaryLabelColor = meterConfig.facePlate.primaryLabelColor;
  const secondaryLabelColor = meterConfig.facePlate.secondaryLabelColor;
  const majorBounds = [
    padRect(digitWindow, 10),
    padRect(layoutState.centerGear.box, 10),
    ...layoutState.dials.map((dial) => padRect(dial.box, 6)),
  ];

  function drawFaceLabel(text, box, size, color, weight = "600") {
    addText(text, box.x + box.w / 2, box.y + box.h / 2, {
      size,
      color,
      width: box.w,
      height: box.h,
      z: 74,
      weight,
    });
    occupied.push(padRect(box, 5));
    return box;
  }

  assertSingleCreation("brand");
  const brandSize = rand(24, 34);
  const brandW = Math.min(faceLayout.halfWidth * 1.15, Math.max(110, brandName.length * brandSize * 0.72));
  const brandH = brandSize * 1.28;
  const brandGap = rand(8, 14);
  const brandBox = {
    x: -brandW / 2,
    y: digitWindow.y + digitWindow.h + brandGap,
    w: brandW,
    h: brandH,
  };
  if (!insideShell(brandBox, s) || intersects(brandBox, digitWindow, 0)) {
    throw new Error(`Brand band does not fit ${meterConfig.family}/${meterConfig.layoutPreset}`);
  }
  layoutState.labels.brand = drawFaceLabel(brandName, brandBox, brandSize, primaryLabelColor, "700");

  const unitSize = rand(24, 32);
  const unitW = 58;
  const unitH = 40;
  const unitY = digitWindow.y + digitWindow.h * 0.52;
  const unitCandidates = [
    { x: digitWindow.x + digitWindow.w + 12, y: unitY, w: unitW, h: unitH },
    { x: digitWindow.x - unitW - 12, y: unitY, w: unitW, h: unitH },
  ];
  const unitBox = unitCandidates.find((box) => insideShellLoose(box, s) && !intersects(box, digitWindow, 4));
  if (unitBox) {
    layoutState.labels.unit = drawFaceLabel("m³", unitBox, unitSize, secondaryLabelColor, "700");
  }

  assertSingleCreation("bottomText");
  const bottomText = choice([
    `${choice(models)} ${choice(["T30", "PN16", "16 bar"])}`,
    `Qn ${choice(["1.5", "2.5", "4"])} m³/h`,
    "Δp 0.1 bar",
    "1 x 10⁶ Pa",
  ]);
  const bottomSize = rand(14, 18);
  const preferredBottomW = Math.max(110, bottomText.length * bottomSize * 0.7);
  let bottomBox = null;
  let finalBottomSize = bottomSize;
  for (const scale of [1, 0.86, 0.74, 0.62, 0.52]) {
    const size = bottomSize * scale;
    const h = size * 1.4;
    const y = faceLayout.bottomText.y + faceLayout.bottomText.h * 0.28;
    const halfWidth = faceHalfWidthAtY(s, y, 34);
    const w = Math.min(preferredBottomW * scale, halfWidth * 0.78);
    const edgeCenter = Math.max(0, halfWidth - w / 2 - 12);
    const centers = shuffle([0, -edgeCenter, edgeCenter]);
    for (const x of centers) {
      const candidate = { x: x - w / 2, y: y - h / 2, w, h };
      if (!insideShellLoose(candidate, s)) continue;
      if (intersectsAny(candidate, majorBounds, 5)) continue;
      bottomBox = candidate;
      finalBottomSize = size;
      break;
    }
    if (bottomBox) break;
  }
  if (!bottomBox) {
    throw new Error(`Bottom text band does not fit ${meterConfig.family}/${meterConfig.layoutPreset}`);
  }
  layoutState.labels.bottomText = drawFaceLabel(bottomText, bottomBox, finalBottomSize, primaryLabelColor, "600");

  const smallLabels = [
    { text: serial, color: primaryLabelColor },
    { text: `${choice(models)} ${choice(["30°C", "T30", "PN16"])}`, color: secondaryLabelColor },
  ];
  const sideY = layoutState.centerGear.y;
  const sideX = faceHalfWidthAtY(s, sideY, 36) * 0.72;
  const sideSlots = shuffle([[-sideX, sideY], [sideX, sideY]]);
  for (let i = 0; i < smallLabels.length; i++) {
    const item = smallLabels[i];
    const size = rand(12, 16);
    const w = Math.max(82, item.text.length * size * 0.66);
    const h = size * 1.35;
    const [x, y] = sideSlots[i];
    const box = { x: x - w / 2, y: y - h / 2, w, h };
    if (!insideShellLoose(box, s) || intersectsAny(box, majorBounds, 6)) continue;
    drawFaceLabel(item.text, box, size, item.color, "600");
  }
}

function drawGear(x, y, r, teeth, z) {
  const pts = [];
  for (let i = 0; i < teeth * 4; i++) {
    const a = (i / (teeth * 4)) * Math.PI * 2;
    const phase = i % 4;
    const rr = phase === 1 || phase === 2 ? r : r * 0.76;
    pts.push(new THREE.Vector2(Math.cos(a) * rr, Math.sin(a) * rr));
  }
  const shape = new THREE.Shape(pts);
  shape.holes.push(new THREE.Path().absarc(0, 0, r * 0.24, 0, Math.PI * 2, true));

  const gear = extruded(shape, materials.metalDetail || materials.dark, x, y, z, 20, 2.6);
  gear.castShadow = true;
  root.add(gear);
  root.add(cylinderRing(x, y, r * 0.28, r * 0.48, 8, metalRoleMaterial("metalMechanical", materials.metal), z + 15));
  root.add(cylinderDisc(x, y, r * 0.2, 6, materials.black, z + 23));
  root.add(cylinderDisc(x, y, r * 0.09, 4, materials.warmWhite, z + 28));
}

function drawStar(x, y, r, points, z) {
  const pts = [];
  for (let i = 0; i < points * 2; i++) {
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * 0.34;
    pts.push(new THREE.Vector2(Math.cos(a) * rr, Math.sin(a) * rr));
  }
  root.add(extruded(new THREE.Shape(pts), materials.dark, x, y, z, 14, 2));
  root.add(cylinderDisc(x, y, r * 0.18, 8, materials.red, z + 13));
}

function drawRotor(x, y, r, blades, z) {
  for (let i = 0; i < blades; i++) {
    const blade = roundedBox(r * 0.32, r * 0.88, 13, r * 0.14, materials.blue, x, y + r * 0.32, z + i * 0.02);
    blade.rotation.z = (i / blades) * Math.PI * 2;
    root.add(blade);
  }
  root.add(cylinderDisc(x, y, r * 0.34, 14, materials.dark, z + 8));
  root.add(cylinderDisc(x, y, r * 0.13, 9, materials.warmWhite, z + 18));
}

function addText(text, x, y, options = {}) {
  const width = Math.ceil(options.width || 180);
  const height = Math.ceil(options.height || 60);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(2, width * 4);
  canvas.height = Math.max(2, height * 4);
  const ctx = canvas.getContext("2d");
  ctx.scale(4, 4);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = options.color || "#10151a";
  let fontSize = options.size || 24;
  const fontFamily = options.family || "Arial, Helvetica, sans-serif";
  const fontWeight = options.weight || "500";
  ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
  while (ctx.measureText(text).width > width * 0.9 && fontSize > 6) {
    fontSize -= 1;
    ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (options.strokeWidth) {
    ctx.lineWidth = options.strokeWidth;
    ctx.strokeStyle = options.strokeColor || options.color || "#10151a";
    ctx.strokeText(text, width / 2, height / 2);
  }
  ctx.fillText(text, width / 2, height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, depthTest: false });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  plane.position.set(x, y, options.z || 78);
  plane.renderOrder = options.renderOrder || 80;
  root.add(plane);
  return plane;
}

function makeRollingDigitTexture(currentDigit, theta, red, wheelWidth, wheelHeight, glyphBoxWidth = wheelWidth) {
  const viewW = 512;
  const viewH = Math.max(280, Math.round(viewW * (wheelHeight / wheelWidth)));
  const glyphBoxW = viewW * Math.min(1, glyphBoxWidth / wheelWidth);
  const stripH = viewH * 10;
  const rollProgress = ((theta % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / (Math.PI * 2);
  const strip = document.createElement("canvas");
  strip.width = viewW;
  strip.height = stripH;
  const stripCtx = strip.getContext("2d");
  const aperture = document.createElement("canvas");
  aperture.width = viewW;
  aperture.height = viewH;
  const apertureCtx = aperture.getContext("2d");
  const curved = document.createElement("canvas");
  curved.width = viewW;
  curved.height = viewH;
  const ctx = curved.getContext("2d");
  const bg = red ? "#c3292f" : "#f7f6ed";
  const fg = red ? "#fff9f3" : "#111820";
  const separator = red ? "rgba(86,0,0,0.28)" : "rgba(0,0,0,0.13)";
  const glyphStyles = createRegisterGlyphStyles(stripCtx, glyphBoxW, viewH);

  stripCtx.fillStyle = bg;
  stripCtx.fillRect(0, 0, viewW, stripH);
  for (let digit = 0; digit < 10; digit++) {
    const cellY = digit * viewH;
    stripCtx.fillStyle = bg;
    stripCtx.fillRect(0, cellY, viewW, viewH);
    stripCtx.fillStyle = fg;
    drawDigitGlyphInCell(stripCtx, String(digit), 0, cellY, viewW, viewH, fg, glyphStyles);
    if (digit > 0) {
      stripCtx.fillStyle = separator;
      stripCtx.fillRect(viewW * 0.04, cellY - 1.5, viewW * 0.92, 3);
    }
  }
  addWheelSurfaceGrain(stripCtx, viewW, stripH, red);

  apertureCtx.fillStyle = bg;
  apertureCtx.fillRect(0, 0, viewW, viewH);
  apertureCtx.save();
  roundRectPath(apertureCtx, 8, 8, viewW - 16, viewH - 16, 18);
  apertureCtx.clip();
  const sourceY = (currentDigit + rollProgress) * viewH;
  drawWrappedStrip(apertureCtx, strip, sourceY, viewW, viewH, stripH);
  apertureCtx.restore();

  ctx.clearRect(0, 0, viewW, viewH);
  ctx.save();
  roundRectPath(ctx, 7, 7, viewW - 14, viewH - 14, 20);
  ctx.clip();
  for (let y = 0; y < viewH; y++) {
    const v = (y - viewH / 2) / (viewH / 2);
    const curve = v * v;
    const scaleX = 1 - 0.1 * curve;
    const alpha = 1 - 0.22 * curve;
    const lineW = viewW * scaleX;
    const dx = (viewW - lineW) / 2;
    ctx.globalAlpha = alpha;
    ctx.drawImage(aperture, 0, y, viewW, 1, dx, y, lineW, 1);
  }
  ctx.restore();
  ctx.globalAlpha = 1;

  const sideShade = ctx.createLinearGradient(0, 0, viewW, 0);
  sideShade.addColorStop(0, "rgba(0,0,0,0.5)");
  sideShade.addColorStop(0.16, "rgba(0,0,0,0.1)");
  sideShade.addColorStop(0.5, "rgba(255,255,255,0.23)");
  sideShade.addColorStop(0.84, "rgba(0,0,0,0.1)");
  sideShade.addColorStop(1, "rgba(0,0,0,0.48)");
  ctx.fillStyle = sideShade;
  roundRectPath(ctx, 7, 7, viewW - 14, viewH - 14, 20);
  ctx.fill();

  const topBottomShade = ctx.createLinearGradient(0, 0, 0, viewH);
  topBottomShade.addColorStop(0, "rgba(0,0,0,0.55)");
  topBottomShade.addColorStop(0.15, "rgba(0,0,0,0.1)");
  topBottomShade.addColorStop(0.5, "rgba(255,255,255,0.04)");
  topBottomShade.addColorStop(0.85, "rgba(0,0,0,0.12)");
  topBottomShade.addColorStop(1, "rgba(0,0,0,0.58)");
  ctx.fillStyle = topBottomShade;
  roundRectPath(ctx, 7, 7, viewW - 14, viewH - 14, 20);
  ctx.fill();

  ctx.strokeStyle = red ? "rgba(92,0,0,0.65)" : "rgba(0,0,0,0.32)";
  ctx.lineWidth = 8;
  roundRectPath(ctx, 8, 8, viewW - 16, viewH - 16, 19);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(curved);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function drawWrappedStrip(ctx, strip, sourceY, viewW, viewH, stripH) {
  let srcY = ((sourceY % stripH) + stripH) % stripH;
  let dstY = 0;
  let remaining = viewH;
  while (remaining > 0) {
    const chunk = Math.min(remaining, stripH - srcY);
    ctx.drawImage(strip, 0, srcY, viewW, chunk, 0, dstY, viewW, chunk);
    remaining -= chunk;
    dstY += chunk;
    srcY = 0;
  }
}

function createRegisterGlyphStyles(ctx, cellW, cellH) {
  const cacheKey = `${cellW.toFixed(4)}:${cellH.toFixed(4)}`;
  if (registerGlyphStyleCache.has(cacheKey)) return registerGlyphStyleCache.get(cacheKey);

  const glyphs = "0123456789";
  const rasterScale = 2;
  const targetMinX = cellW * 0.1;
  const targetMaxX = cellW * 0.92;
  const targetMinY = cellH * 0.1;
  const targetMaxY = cellH * 0.9;
  const targetVisibleWidth = targetMaxX - targetMinX;
  const targetVisibleHeight = targetMaxY - targetMinY;
  const scratchSize = Math.ceil(Math.max(cellW, cellH) * rasterScale * 1.6);
  const rasterFontSize = cellH * rasterScale * 1.2;
  const font = `${REGISTER_DIGIT_WEIGHT} ${rasterFontSize}px ${REGISTER_DIGIT_FAMILY}`;
  const styles = {};
  const diagnosticDigits = [];
  void ctx;

  Array.from(glyphs).forEach((glyph) => {
    const scratch = document.createElement("canvas");
    scratch.width = scratchSize;
    scratch.height = scratchSize;
    const scratchCtx = scratch.getContext("2d", { willReadFrequently: true });
    scratchCtx.clearRect(0, 0, scratchSize, scratchSize);
    scratchCtx.fillStyle = "#ffffff";
    scratchCtx.font = font;
    scratchCtx.textAlign = "center";
    scratchCtx.textBaseline = "middle";
    scratchCtx.fillText(glyph, scratchSize / 2, scratchSize / 2);

    const pixels = scratchCtx.getImageData(0, 0, scratchSize, scratchSize).data;
    let xMin = scratchSize;
    let xMax = -1;
    let yMin = scratchSize;
    let yMax = -1;
    for (let y = 0; y < scratchSize; y++) {
      for (let x = 0; x < scratchSize; x++) {
        if (pixels[(y * scratchSize + x) * 4 + 3] === 0) continue;
        xMin = Math.min(xMin, x);
        xMax = Math.max(xMax, x);
        yMin = Math.min(yMin, y);
        yMax = Math.max(yMax, y);
      }
    }
    if (xMax < xMin || yMax < yMin) {
      throw new Error(`Register glyph rasterization produced no visible pixels for ${glyph}`);
    }

    const rawWidth = xMax - xMin + 1;
    const rawHeight = yMax - yMin + 1;
    const mask = document.createElement("canvas");
    mask.width = rawWidth;
    mask.height = rawHeight;
    mask.getContext("2d").drawImage(
      scratch,
      xMin,
      yMin,
      rawWidth,
      rawHeight,
      0,
      0,
      rawWidth,
      rawHeight
    );
    const style = {
      mask,
      tintedMasks: new Map(),
      rasterBounds: { xMin, xMax, yMin, yMax },
      scaleX: targetVisibleWidth / rawWidth,
      scaleY: targetVisibleHeight / rawHeight,
    };
    styles[glyph] = style;
    diagnosticDigits.push({
      glyph,
      rasterBounds: { xMin, xMax, yMin, yMax },
      rawVisibleWidth: rawWidth,
      rawVisibleHeight: rawHeight,
      scaleX: style.scaleX,
      scaleY: style.scaleY,
      finalVisibleWidth: targetVisibleWidth,
      finalVisibleHeight: targetVisibleHeight,
      targetBounds: { xMin: targetMinX, xMax: targetMaxX, yMin: targetMinY, yMax: targetMaxY },
    });
  });

  const widthValues = diagnosticDigits.map((item) => item.finalVisibleWidth);
  const heightValues = diagnosticDigits.map((item) => item.finalVisibleHeight);
  const variation = (values) => {
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    return (Math.max(...values) - Math.min(...values)) / Math.max(1, mean);
  };
  const widthVariation = variation(widthValues);
  const heightVariation = variation(heightValues);
  if (widthVariation > 0.03 || heightVariation > 0.03) {
    throw new Error(
      `Register glyph normalization failed: width=${widthVariation.toFixed(4)}, height=${heightVariation.toFixed(4)}`
    );
  }

  const result = {
    font,
    styles,
    glyphBoxWidth: cellW,
    cellHeight: cellH,
    targetMinX,
    targetMaxX,
    targetMinY,
    targetMaxY,
    targetVisibleWidth,
    targetVisibleHeight,
    diagnostics: {
      font,
      fontFamily: REGISTER_DIGIT_FAMILY,
      fontWeight: REGISTER_DIGIT_WEIGHT,
      rasterScale,
      glyphBoxWidth: cellW,
      cellHeight: cellH,
      targetBounds: { xMin: targetMinX, xMax: targetMaxX, yMin: targetMinY, yMax: targetMaxY },
      targetVisibleWidth,
      targetVisibleHeight,
      widthVariation,
      heightVariation,
      digits: diagnosticDigits,
    },
  };
  registerGlyphStyleCache.set(cacheKey, result);
  registerGlyphDiagnostics = result.diagnostics;
  return result;
}

function drawDigitGlyphInCell(ctx, glyph, cellX, cellY, cellW, cellH, fillStyle, glyphStyles) {
  const style = glyphStyles.styles[glyph];
  let tintedMask = style.tintedMasks.get(fillStyle);
  if (!tintedMask) {
    tintedMask = document.createElement("canvas");
    tintedMask.width = style.mask.width;
    tintedMask.height = style.mask.height;
    const tintCtx = tintedMask.getContext("2d");
    tintCtx.drawImage(style.mask, 0, 0);
    tintCtx.globalCompositeOperation = "source-in";
    tintCtx.fillStyle = fillStyle;
    tintCtx.fillRect(0, 0, tintedMask.width, tintedMask.height);
    style.tintedMasks.set(fillStyle, tintedMask);
  }

  const glyphBoxX = cellX + (cellW - glyphStyles.glyphBoxWidth) / 2;
  const targetX = glyphBoxX + glyphStyles.targetMinX;
  const targetY = cellY + glyphStyles.targetMinY;
  ctx.save();
  ctx.beginPath();
  ctx.rect(cellX, cellY, cellW, cellH);
  ctx.clip();
  ctx.drawImage(
    tintedMask,
    0,
    0,
    tintedMask.width,
    tintedMask.height,
    targetX,
    targetY,
    glyphStyles.targetVisibleWidth,
    glyphStyles.targetVisibleHeight
  );
  ctx.restore();
}

function createRegisterGlyphDiagnosticCanvas() {
  const canvas = document.createElement("canvas");
  canvas.width = 1120;
  canvas.height = 650;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#252b30";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const sampleDigits = Array.from("0123456789");
  const cellW = 84;
  const cellH = 96;
  const glyphBoxW = 70;
  const rowX = 205;

  const label = (text, x, y) => {
    ctx.fillStyle = "#f3f5f6";
    ctx.font = "600 17px Arial, Helvetica, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x, y);
  };
  const drawWheel = (x, y, digit, red, rollProgress = 0, width = cellW, height = cellH) => {
    const texture = makeRollingDigitTexture(
      Number(digit),
      rollProgress * Math.PI * 2,
      red,
      width,
      height,
      width * (glyphBoxW / cellW)
    );
    ctx.drawImage(texture.image, x, y, width, height);
    texture.dispose();
  };

  label("BLACK / IVORY", 30, 84);
  sampleDigits.forEach((digit, index) => drawWheel(rowX + index * cellW, 36, digit, false));

  label("WHITE / RED", 30, 194);
  sampleDigits.forEach((digit, index) => drawWheel(rowX + index * cellW, 146, digit, true));

  label("ROLLING", 30, 320);
  label("4 -> 5", 205, 278);
  drawWheel(205, 300, "4", false, 0.58, 110, 112);
  label("8 -> 9", 420, 278);
  drawWheel(420, 300, "8", true, 0.46, 110, 112);

  const drawRegister = (digits, x, y) => {
    ctx.fillStyle = "#11161a";
    ctx.fillRect(x - 6, y - 6, digits.length * 76 + 12, 88);
    digits.forEach((digit, index) => drawWheel(x + index * 76, y, digit, index >= digits.length - 2, 0, 76, 76));
  };

  label("7-DIGIT REGISTER", 30, 475);
  drawRegister(["0", "1", "2", "4", "5", "7", "8"], 255, 438);
  label("8-DIGIT REGISTER", 30, 584);
  drawRegister(["0", "1", "2", "4", "5", "7", "8", "9"], 255, 547);

  return canvas;
}

function addWheelSurfaceGrain(ctx, width, height, red) {
  ctx.save();
  ctx.globalAlpha = red ? 0.13 : 0.1;
  for (let i = 0; i < 80; i++) {
    ctx.strokeStyle = i % 3 === 0 ? "#ffffff" : "#000000";
    ctx.lineWidth = rand(0.35, 1.1);
    const x = rand(12, width - 12);
    ctx.beginPath();
    ctx.moveTo(x, rand(8, height - 8));
    ctx.lineTo(x + rand(-3, 3), rand(8, height - 8));
    ctx.stroke();
  }
  ctx.globalAlpha = red ? 0.1 : 0.08;
  for (let i = 0; i < 120; i++) {
    ctx.fillStyle = i % 2 ? "#ffffff" : "#000000";
    ctx.fillRect(rand(10, width - 10), rand(10, height - 10), rand(0.6, 2.2), rand(0.6, 2.2));
  }
  ctx.restore();
}

function texturePlane(texture, width, height, x, y, z) {
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, depthTest: false });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  plane.position.set(x, y, z);
  return plane;
}

function buildAnnotationMeta() {
  if (!annotationState.wheel) {
    return { wheel_reading: "", wheel: null, digits: [] };
  }
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  const wheelCorners = rectToProjectedCorners(annotationState.wheel);
  return {
    wheel_reading: annotationState.wheelReading,
    wheel: {
      obb: rectToProjectedObb(annotationState.wheel),
      corners: wheelCorners,
      bbox: cornersToAabb(wheelCorners),
      visible: cornersVisible(wheelCorners),
    },
    digits: annotationState.digits.map((digit) => {
      const corners = rectToProjectedCorners(digit);
      return {
        pos: digit.pos,
        value: digit.value,
        gt_float: digit.gt_float,
        is_decimal: digit.is_decimal,
        obb: rectToProjectedObb(digit),
        corners,
        bbox: cornersToAabb(corners),
        visible: cornersVisible(corners),
      };
    }),
  };
}

function rectToProjectedCorners(rect) {
  const z = rect.z || 0;
  return [
    new THREE.Vector3(rect.cx - rect.w / 2, rect.cy - rect.h / 2, z),
    new THREE.Vector3(rect.cx + rect.w / 2, rect.cy - rect.h / 2, z),
    new THREE.Vector3(rect.cx + rect.w / 2, rect.cy + rect.h / 2, z),
    new THREE.Vector3(rect.cx - rect.w / 2, rect.cy + rect.h / 2, z),
  ].map((point) => {
    const pixel = projectToPixel(point);
    return [Number(pixel.x.toFixed(4)), Number(pixel.y.toFixed(4))];
  });
}

function cornersToAabb(corners) {
  const xs = corners.map(([x]) => x);
  const ys = corners.map(([, y]) => y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return [
    Number(minX.toFixed(4)),
    Number(minY.toFixed(4)),
    Number((Math.max(...xs) - minX).toFixed(4)),
    Number((Math.max(...ys) - minY).toFixed(4)),
  ];
}

function cornersVisible(corners) {
  return corners.every(([x, y]) => x >= 0 && x <= WIDTH && y >= 0 && y <= HEIGHT);
}

function rectToProjectedObb(rect) {
  const z = rect.z || 0;
  const corners = [
    new THREE.Vector3(rect.cx - rect.w / 2, rect.cy - rect.h / 2, z),
    new THREE.Vector3(rect.cx + rect.w / 2, rect.cy - rect.h / 2, z),
    new THREE.Vector3(rect.cx + rect.w / 2, rect.cy + rect.h / 2, z),
    new THREE.Vector3(rect.cx - rect.w / 2, rect.cy + rect.h / 2, z),
  ].map((point) => projectToPixel(point));
  return minAreaRectObb(corners).map((value) => Number(value.toFixed(4)));
}

function projectToPixel(point) {
  const projected = point.clone().project(camera);
  return {
    x: (projected.x * 0.5 + 0.5) * WIDTH,
    y: (-projected.y * 0.5 + 0.5) * HEIGHT,
  };
}

function minAreaRectObb(points) {
  let best = null;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const rotated = points.map((p) => ({
      x: p.x * cos + p.y * sin,
      y: -p.x * sin + p.y * cos,
    }));
    const minX = Math.min(...rotated.map((p) => p.x));
    const maxX = Math.max(...rotated.map((p) => p.x));
    const minY = Math.min(...rotated.map((p) => p.y));
    const maxY = Math.max(...rotated.map((p) => p.y));
    const w = maxX - minX;
    const h = maxY - minY;
    const area = w * h;
    if (!best || area < best.area) {
      const rcx = (minX + maxX) / 2;
      const rcy = (minY + maxY) / 2;
      best = {
        area,
        cx: rcx * cos - rcy * sin,
        cy: rcx * sin + rcy * cos,
        w,
        h,
        angle,
      };
    }
  }
  return normalizeCv2Obb(best.cx, best.cy, best.w, best.h, best.angle);
}

function normalizeCv2Obb(cx, cy, w, h, angle) {
  while (angle <= -Math.PI / 2) angle += Math.PI;
  while (angle > Math.PI / 2) angle -= Math.PI;
  if (angle > 0) {
    angle -= Math.PI / 2;
    [w, h] = [h, w];
  }
  if (angle <= -Math.PI / 2) {
    angle += Math.PI / 2;
    [w, h] = [h, w];
  }
  return [cx, cy, w, h, angle];
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
}

function shellShape(type, rx, ry, radius = 70) {
  if (type === "circle" || type === "ellipse") {
    const shape = new THREE.Shape();
    shape.absellipse(0, 0, rx, ry, 0, Math.PI * 2, false, 0);
    return shape;
  }
  if (type === "squircle") return new THREE.Shape(shellPoints(type, rx, ry, 112));
  return roundedRectShape(rx * 2, ry * 2, Math.min(radius, rx * 0.38, ry * 0.38));
}

function shellPoints(type, rx, ry, count) {
  const pts = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    if (type === "squircle") {
      const c = Math.cos(a);
      const s = Math.sin(a);
      pts.push(new THREE.Vector2(Math.sign(c) * rx * Math.pow(Math.abs(c), 0.48), Math.sign(s) * ry * Math.pow(Math.abs(s), 0.48)));
    } else {
      pts.push(new THREE.Vector2(Math.cos(a) * rx, Math.sin(a) * ry));
    }
  }
  return pts;
}

function mat(color, roughness = 0.55, metalness = 0.25, opacity = 1) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness,
    transparent: opacity < 1,
    opacity,
    side: THREE.DoubleSide,
  });
}

function extruded(shape, material, x, y, z, depth = 10, bevel = 2, options = {}) {
  let geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelSegments: 4,
    bevelSize: bevel,
    bevelThickness: bevel,
    curveSegments: 72,
  });
  geometry.center();
  const shouldNormalizeUvs = options.normalizeUVs
    ?? Boolean(material?.userData?.normalizeExtrudeUVs);
  let meshMaterial = material;
  if (shouldNormalizeUvs && material?.userData?.extrudeCalibration) {
    const calibration = material.userData.extrudeCalibration;
    meshMaterial = material.clone();
    meshMaterial.roughness = calibration.roughness;
    meshMaterial.metalness = calibration.metalness;
    meshMaterial.normalScale.setScalar(calibration.normalScale);
  }
  if (normalizePbrExtrudeUVs && shouldNormalizeUvs) {
    geometry = normalizeExtrudeGeometryUVs(
      geometry,
      material?.userData?.pbrRole,
      pbrUvNormalizationStats
    );
  }
  const obj = new THREE.Mesh(geometry, meshMaterial);
  obj.position.set(x, y, z + depth / 2);
  obj.castShadow = true;
  obj.receiveShadow = true;
  return obj;
}

function roundedBox(w, h, depth, r, material, x = 0, y = 0, z = 0) {
  const obj = extruded(roundedRectShape(w, h, r), material, x, y, z, depth, Math.min(1.8, depth * 0.25));
  return obj;
}

function cylinderDisc(x, y, r, depth, material, z, segments = 72) {
  const obj = new THREE.Mesh(new THREE.CylinderGeometry(r, r, depth, segments), material);
  obj.rotation.x = Math.PI / 2;
  obj.position.set(x, y, z + depth / 2);
  obj.castShadow = true;
  obj.receiveShadow = true;
  return obj;
}

function cylinderRing(x, y, innerR, outerR, depth, material, z) {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, outerR, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  hole.absarc(0, 0, innerR, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  return extruded(shape, material, x, y, z, depth, 1.5);
}

function roundedRectShape(w, h, r) {
  const shape = new THREE.Shape();
  r = Math.min(r, w / 2, h / 2);
  shape.moveTo(-w / 2 + r, -h / 2);
  shape.lineTo(w / 2 - r, -h / 2);
  shape.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  shape.lineTo(w / 2, h / 2 - r);
  shape.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  shape.lineTo(-w / 2 + r, h / 2);
  shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  shape.lineTo(-w / 2, -h / 2 + r);
  shape.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  return shape;
}

function tubePolyline(points, material, radius, z) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p.x, p.y, z)), true, "catmullrom", 0.05);
  return new THREE.Mesh(new THREE.TubeGeometry(curve, 220, radius, 10, true), material);
}

function insideShell(rect, s) {
  const pad = 10;
  const pts = [
    [rect.x - pad, rect.y - pad],
    [rect.x + rect.w + pad, rect.y - pad],
    [rect.x - pad, rect.y + rect.h + pad],
    [rect.x + rect.w + pad, rect.y + rect.h + pad],
  ];
  return pts.every(([x, y]) => {
    const rx = (s.inner - 20) * s.scaleX;
    const ry = (s.inner - 20) * s.scaleY;
    if (s.shape === "roundedRect") return Math.abs(x) < rx && Math.abs(y) < ry;
    const nx = x / rx;
    const ny = y / ry;
    return nx * nx + ny * ny < 1;
  });
}

function insideShellLoose(rect, s) {
  const pts = [
    [rect.x, rect.y],
    [rect.x + rect.w, rect.y],
    [rect.x, rect.y + rect.h],
    [rect.x + rect.w, rect.y + rect.h],
  ];
  return pts.every(([x, y]) => {
    const rx = (s.inner - 16) * s.scaleX;
    const ry = (s.inner - 16) * s.scaleY;
    if (s.shape === "roundedRect") return Math.abs(x) < rx && Math.abs(y) < ry;
    if (s.shape === "squircle") {
      const nx = Math.abs(x / rx);
      const ny = Math.abs(y / ry);
      return Math.pow(nx, 3.2) + Math.pow(ny, 3.2) < 1;
    }
    const nx = x / rx;
    const ny = y / ry;
    return nx * nx + ny * ny < 1;
  });
}

function validateFinalLayout(s, digitWindow) {
  const errors = [];
  const creation = layoutState.creation;
  const digitCount = annotationState.digits.length;
  if (creation.mainFace !== 1) errors.push(`main_face_count=${creation.mainFace}`);
  if (creation.lid > 1) errors.push(`lid_count=${creation.lid}`);
  if (creation.register !== 1) errors.push(`register_count=${creation.register}`);
  if (creation.centerGear !== 1) errors.push(`center_gear_count=${creation.centerGear}`);
  if (creation.brand !== 1) errors.push(`brand_count=${creation.brand}`);
  if (creation.bottomText !== 1) errors.push(`bottom_text_count=${creation.bottomText}`);
  if (digitCount !== 7 && digitCount !== 8) errors.push(`digit_count=${digitCount}`);
  const registerAspect = digitWindow.w / digitWindow.h;
  if (registerAspect < 8 || registerAspect > 13) {
    errors.push(`register_aspect=${registerAspect.toFixed(3)}`);
  }
  const firstDigitBox = annotationState.digits[0];
  annotationState.digits.forEach((digit, index) => {
    if (!(digit.w > 0 && digit.h > 0)) {
      errors.push(`digit_${index}_invalid_size=${digit.w.toFixed(3)}x${digit.h.toFixed(3)}`);
    }
    if (firstDigitBox && (Math.abs(digit.w - firstDigitBox.w) > 1e-6 || Math.abs(digit.h - firstDigitBox.h) > 1e-6)) {
      errors.push(`digit_${index}_cell_size_mismatch`);
    }
  });
  if (!insideShell(digitWindow, s)) errors.push("register_outside_face");
  if (!layoutState.centerGear) {
    errors.push("center_gear_missing");
  } else {
    if (!insideFaceCircle(layoutState.centerGear, s)) errors.push("center_gear_outside_face");
    if (circleIntersectsRect(layoutState.centerGear, digitWindow, 14)) errors.push("center_gear_overlaps_register");
  }
  if (layoutState.dials.length < 1 || layoutState.dials.length > 3) {
    errors.push(`dial_count=${layoutState.dials.length}`);
  }
  for (let i = 0; i < layoutState.dials.length; i++) {
    const dial = layoutState.dials[i];
    const dialCircle = { x: dial.x, y: dial.y, r: dial.r + 5 };
    if (!insideFaceCircle(dialCircle, s)) errors.push(`dial_${i}_outside_face`);
    if (circleIntersectsRect(dialCircle, digitWindow, 14)) errors.push(`dial_${i}_overlaps_register`);
    if (circlesOverlap(dialCircle, layoutState.centerGear, 14)) errors.push(`dial_${i}_overlaps_center_gear`);
    for (let j = i + 1; j < layoutState.dials.length; j++) {
      const other = layoutState.dials[j];
      if (circlesOverlap(dialCircle, { x: other.x, y: other.y, r: other.r + 5 }, 14)) {
        errors.push(`dial_${i}_overlaps_dial_${j}`);
      }
    }
  }
  const brand = layoutState.labels.brand;
  if (!brand || !insideShellLoose(brand, s)) errors.push("brand_outside_face");
  if (brand && intersects(brand, digitWindow, 0)) errors.push("brand_overlaps_register");
  if (brand) {
    const brandGap = brand.y - (digitWindow.y + digitWindow.h);
    if (brandGap < 8 || brandGap > 14.001) errors.push(`brand_register_gap=${brandGap.toFixed(2)}`);
  }
  if (!layoutState.labels.bottomText || !insideShellLoose(layoutState.labels.bottomText, s)) {
    errors.push("bottom_text_outside_face");
  }
  if (layoutState.lid && layoutState.mainFace) {
    const distance = Math.hypot(layoutState.lid.x, layoutState.lid.y);
    const mainRadius = Math.max(layoutState.mainFace.rx, layoutState.mainFace.ry);
    if (distance < mainRadius + layoutState.lid.r + 20) errors.push("lid_overlaps_main_face");
  }
  if (annotationState.digits.some((digit) => !insideShellLoose({
    x: digit.cx - digit.w / 2,
    y: digit.cy - digit.h / 2,
    w: digit.w,
    h: digit.h,
  }, s))) {
    errors.push("digit_box_outside_face");
  }
  if (errors.length) {
    throw new Error(`Invalid ${meterConfig.family}/${meterConfig.layoutPreset} layout: ${errors.join(", ")}`);
  }
  return {
    valid: true,
    family: meterConfig.family,
    layout_preset: meterConfig.layoutPreset,
    digit_count: digitCount,
    dial_count: layoutState.dials.length,
    register: { ...digitWindow },
    center_gear: { ...layoutState.centerGear, box: { ...layoutState.centerGear.box } },
    dials: layoutState.dials.map((dial) => ({ x: dial.x, y: dial.y, r: dial.r, box: { ...dial.box } })),
    semantic_bands: JSON.parse(JSON.stringify(layoutState.faceLayout)),
    creation_counts: { ...layoutState.creation },
    module_count: layoutState.modules.length,
  };
}

function insideFaceCircle(circle, s) {
  if (!circle) return false;
  const rx = (s.inner - 24) * s.scaleX;
  const ry = (s.inner - 24) * s.scaleY;
  if (s.shape === "roundedRect") {
    return Math.abs(circle.x) + circle.r < rx && Math.abs(circle.y) + circle.r < ry;
  }
  for (let i = 0; i < 16; i++) {
    const angle = i / 16 * Math.PI * 2;
    const x = circle.x + Math.cos(angle) * circle.r;
    const y = circle.y + Math.sin(angle) * circle.r;
    if (s.shape === "squircle") {
      if (Math.pow(Math.abs(x / rx), 3.2) + Math.pow(Math.abs(y / ry), 3.2) >= 1) return false;
    } else if ((x / rx) ** 2 + (y / ry) ** 2 >= 1) {
      return false;
    }
  }
  return true;
}

function circleIntersectsRect(circle, rect, clearance = 0) {
  const nearestX = THREE.MathUtils.clamp(circle.x, rect.x, rect.x + rect.w);
  const nearestY = THREE.MathUtils.clamp(circle.y, rect.y, rect.y + rect.h);
  return Math.hypot(circle.x - nearestX, circle.y - nearestY) < circle.r + clearance;
}

function circlesOverlap(a, b, clearance = 0) {
  if (!a || !b) return false;
  return Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r + clearance;
}

function intersectsAny(rect, others, gap = 0) {
  return others.some((o) => intersects(rect, o, gap));
}

function intersects(a, b, gap) {
  return !(a.x + a.w + gap < b.x || b.x + b.w + gap < a.x || a.y + a.h + gap < b.y || b.y + b.h + gap < a.y);
}

function padRect(r, pad) {
  return { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 };
}

function centeredToRect(b) {
  return { x: b.x - b.w / 2, y: b.y - b.h / 2, w: b.w, h: b.h };
}

function rand(min, max) {
  return min + rng() * (max - min);
}

function randInt(min, max) {
  return Math.floor(rand(min, max + 1));
}

function choice(arr) {
  return arr[randInt(0, arr.length - 1)];
}

function shuffle(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(a) {
  return function next() {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
