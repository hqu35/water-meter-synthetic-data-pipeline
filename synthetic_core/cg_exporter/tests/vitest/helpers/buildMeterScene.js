// Replicates the scene-assembly portion of water-meter-generator.js
// (creating the shell, face layout, materials, register, dials, labels,
// glass, and running validateFinalLayout) without the browser-only parts:
// no WebGLRenderer, no camera, no HDRI/PBR network texture loading, no
// `window`/`document.body` usage. `document.createElement("canvas")` calls
// inside register.js/meter.js still fire and must be covered by
// installFakeDom() in the calling test.

import * as THREE from "../../../vendor/three.module.js";
import { hashString, mulberry32, setRng } from "../../../renderer/random.js";
import { createMeterConfig, selectDigitCount } from "../../../renderer/config.js";
import { createMaterials } from "../../../renderer/materials.js";
import { addLights } from "../../../renderer/lighting.js";
import { createRegisterState, placeDigitRegister } from "../../../renderer/register.js";
import { validateFinalLayout } from "../../../renderer/validation.js";
import {
  createMeterIdentity,
  makeShell,
  createFaceLayout,
  faceHalfWidthAtY,
  assertSingleCreation,
  drawPipeAssembly,
  drawBackHousing,
  drawFamilyStructures,
  drawShell,
  placeScrews,
  placeCenterElement,
  placeDials,
  placeLabels,
  drawGlassCover,
  roundedBox,
} from "../../../renderer/meter.js";

const NO_RUNTIME_PBR = {
  pbrRepeatParam: "",
  pbrRoughnessMapParam: "",
  pbrMetalnessMapParam: "",
  pbrRoughnessParam: "",
  pbrMetalnessParam: "",
  pbrNormalScaleParam: "",
};

export function buildMeterScene({ seed, family, digitOverride = null }) {
  const rng = mulberry32(hashString(seed));
  setRng(rng);
  const meterConfig = createMeterConfig({ seed, family, width: 512, height: 512, rng });
  meterConfig.pbr = { mode: "off", requestedTextureKey: null, selectedTextureKey: null, loaded: false, familyPool: [] };
  if (digitOverride) {
    meterConfig.digitRegister.exactDigits = digitOverride;
    meterConfig.digitRegister.minDigits = digitOverride;
    meterConfig.digitRegister.maxDigits = digitOverride;
  }

  const root = new THREE.Group();
  const scene = new THREE.Scene();
  const occupied = [];
  const annotationState = { wheel: null, digits: [], wheelReading: "" };
  const layoutState = {
    register: null,
    centerGear: null,
    dials: [],
    labels: {},
    faceLayout: null,
    mainFace: null,
    lid: null,
    modules: [],
    creation: { mainFace: 0, lid: 0, register: 0, centerGear: 0, brand: 0, bottomText: 0 },
    validation: null,
  };
  const registerState = createRegisterState();

  const materialSystem = createMaterials({ config: meterConfig, loadedPbrTextureSet: null, runtime: NO_RUNTIME_PBR });
  const { materials, metalRoleMaterial } = materialSystem;
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
    normalizePbrExtrudeUVs: true,
    pbrUvNormalizationStats: [],
  };

  const shell = makeShell(meterContext);
  const faceLayout = createFaceLayout(shell);
  layoutState.faceLayout = faceLayout;

  addLights({ scene, config: meterConfig });
  drawPipeAssembly(meterContext, shell);
  drawBackHousing(meterContext, shell);
  drawFamilyStructures(meterContext, shell);
  drawShell(meterContext, shell);
  placeScrews(meterContext, shell);

  const digitWindow = placeDigitRegister(
    {
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
    },
    shell,
    faceLayout
  );
  const center = placeCenterElement(meterContext, shell, faceLayout, digitWindow);
  placeDials(meterContext, shell, faceLayout, digitWindow, center);
  placeLabels(meterContext, shell, faceLayout, digitWindow, center);
  drawGlassCover(meterContext, shell);

  const validation = validateFinalLayout({
    config: meterConfig,
    layoutState,
    annotationState,
    occupied,
    shell,
    digitWindow,
  });
  layoutState.validation = validation;

  return { meterConfig, root, scene, layoutState, annotationState, shell, digitWindow, validation, identity };
}
