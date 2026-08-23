import * as THREE from "./vendor/three.module.js";
import { normalizeExtrudeGeometryUVs } from "./extrude-uv.js";
import { choice, hashString, mulberry32, rand, randInt, setRng, shuffle } from "./renderer/random.js";
import {
  cylinderDisc,
  roundRectPath,
  roundedRectShape,
  shellPoints,
  shellShape,
  tubePolyline,
} from "./renderer/geometry.js";
import {
  centeredToRect,
  circleIntersectsRect,
  circlesOverlap,
  insideFaceCircle,
  insideShell,
  insideShellLoose,
  intersects,
  intersectsAny,
  padRect,
  validateFinalLayout,
} from "./renderer/validation.js";
import { buildAnnotationMeta } from "./renderer/annotations.js";
import { addLights, addStudioBackdrop, createSceneEnvironment } from "./renderer/lighting.js";
import { buildOutputMetadata, installOutputAPI, renderFinalRgb } from "./renderer/output.js";
import {
  createRegisterGlyphDiagnosticCanvas,
  createRegisterState,
  placeDigitRegister,
} from "./renderer/register.js";
import {
  FAMILY_TEXTURE_POOLS,
  createHousingMaterial,
  createMaterials,
  createTrimMaterial,
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

const DIAL_SCALE = 1.35;
const DIAL_DIGIT_SCALE = 1.5;
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

const brands = ["elster", "HYDROMAX", "AQUOR", "METRON", "SENSUS", "KENSUI", "ZENNER"];
const models = ["J20", "B-H A-V", "LX", "Qn", "TRP", "WM", "MS"];
const brandName = choice(brands);
const serial = `${choice(["J20MU", "B89", "SN", "MTR"])}${randInt(100000, 999999)}${choice(["", " L", "A", "B"])}`;
const shell = makeShell();
const faceLayout = createFaceLayout(shell);
layoutState.faceLayout = faceLayout;

if (!meterConfig.output.transparentBackground) addStudioBackdrop({ root });
addLights({ scene, config: meterConfig });
drawPipeAssembly(shell);
drawBackHousing(shell);
drawFamilyStructures(shell);
drawShell(shell);
placeScrews(shell);
const digitWindow = placeDigitRegister({
  config: meterConfig,
  rng,
  root,
  materials,
  annotationState,
  layoutState,
  occupied,
  registerState,
  roundedBox,
  faceHalfWidthAtY,
  assertSingleCreation,
  selectDigitCount,
}, shell, faceLayout);
const center = placeCenterElement(shell, faceLayout, digitWindow);
placeDials(shell, faceLayout, digitWindow, center);
placeLabels(shell, faceLayout, digitWindow, center);
drawGlassCover(shell);
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

function cylinderRing(x, y, innerR, outerR, depth, material, z) {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, outerR, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  hole.absarc(0, 0, innerR, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  return extruded(shape, material, x, y, z, depth, 1.5);
}
