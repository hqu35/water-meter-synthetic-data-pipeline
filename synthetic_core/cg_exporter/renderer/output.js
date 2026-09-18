import * as THREE from "../vendor/three.module.js";

export function renderFinalRgb({ renderer, scene, camera }) {
  renderer.render(scene, camera);
}

export function buildOutputMetadata({
  seedParam,
  config,
  width,
  height,
  occupied,
  registerGlyphDiagnostics,
  layoutState,
  resolvePbrRepeat,
  normalizePbrExtrudeUVs,
  pbrUvNormalizationStats,
  environmentState,
  materials,
  annotationMeta,
}) {
  return {
    seed: seedParam || "random",
    family: config.family,
    layout_preset: config.layoutPreset,
    size: [width, height],
    mode: "three-js-3d-front-view",
    occupied: occupied.length,
    digit_count: config.digitRegister.selectedDigitCount,
    digit_count_source: config.digitRegister.digitCountSource,
    red_digit_count: config.digitRegister.redDigitCount,
    register_glyph_diagnostics: registerGlyphDiagnostics,
    dial_count: layoutState.dials.length,
    texture_mode: config.pbr.mode,
    texture_set: config.pbr.selectedTextureKey,
    texture_loaded: config.pbr.loaded,
    pbr_repeat: {
      metalHousing: resolvePbrRepeat("metalHousing"),
      metalBezel: resolvePbrRepeat("metalBezel"),
      metalConnector: resolvePbrRepeat("metalConnector"),
      metalMechanical: resolvePbrRepeat("metalMechanical"),
    },
    pbr_extrude_uv_normalized: normalizePbrExtrudeUVs,
    pbr_extrude_uv_stats: pbrUvNormalizationStats,
    face_plate: {
      key: config.facePlate.key,
      color: config.facePlate.color,
      dark: config.facePlate.dark,
      selection_source: config.facePlate.selectionSource,
    },
    environmentMode: environmentState.mode,
    requestedEnvironmentKey: environmentState.requestedKey,
    selectedEnvironmentKey: environmentState.selectedKey,
    environmentLoaded: environmentState.loaded,
    environmentFallback: environmentState.fallback,
    environmentIntensity: environmentState.intensity,
    environmentRotation: environmentState.rotationDegrees,
    lightingWithEnvironment: config.lighting.withEnvironment,
    textured_roles: ["metalHousing", "metalBezel", "metalConnector", "metalMechanical"]
      .filter((role) => Boolean(materials[role])),
    textured_components: materials.metalDetail ? ["center_gear", "screws"] : [],
    metal_detail_texture: materials.metalDetail ? config.pbr.selectedTextureKey : null,
    layout_validation: layoutState.validation,
    finalized_configuration: JSON.parse(JSON.stringify(config)),
    ...annotationMeta,
  };
}

export function installOutputAPI({
  scene,
  camera,
  renderer,
  root,
  createMetadata,
  registerGlyphDiagnostic,
  createRegisterGlyphDiagnosticCanvas,
  exportMode,
  width,
  height,
}) {
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

  if (registerGlyphDiagnostic) {
    const diagnosticCanvas = createRegisterGlyphDiagnosticCanvas();
    renderer.domElement.replaceWith(diagnosticCanvas);
    window.__registerGlyphDiagnosticCanvas = diagnosticCanvas;
  }

  window.__waterMeterReady = true;
  window.__waterMeterMaskReady = false;
  window.__renderWaterMeterMask = renderWaterMeterMask;
  window.__restoreWaterMeterRender = restoreWaterMeterRender;
  window.__waterMeterMeta = createMetadata();

  if (!exportMode) {
    window.addEventListener("click", () => {
      const next = new URLSearchParams(window.location.search);
      next.set("seed", String(Date.now()));
      next.set("w", String(width));
      next.set("h", String(height));
      window.location.search = `?${next.toString()}`;
    });
  }
}
