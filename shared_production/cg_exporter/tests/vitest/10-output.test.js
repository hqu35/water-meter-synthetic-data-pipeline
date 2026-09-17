import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as THREE from "../../vendor/three.module.js";
import { renderFinalRgb, buildOutputMetadata, installOutputAPI } from "../../renderer/output.js";

let previousWindow;
beforeEach(() => {
  previousWindow = globalThis.window;
  globalThis.window = { addEventListener() {}, location: { search: "" } };
});
afterEach(() => {
  if (previousWindow === undefined) delete globalThis.window;
  else globalThis.window = previousWindow;
});

describe("renderFinalRgb", () => {
  it("renders the given scene/camera exactly once through the renderer", () => {
    const calls = [];
    const renderer = { render: (...args) => calls.push(args) };
    const scene = {};
    const camera = {};
    renderFinalRgb({ renderer, scene, camera });
    expect(calls).toEqual([[scene, camera]]);
  });
});

describe("buildOutputMetadata", () => {
  function baseArgs(overrides = {}) {
    return {
      seedParam: "meta-seed",
      config: {
        family: "industrial_window",
        layoutPreset: "industrial_c",
        digitRegister: { selectedDigitCount: 8, digitCountSource: "seeded_weighted_70_30", redDigitCount: 1 },
        pbr: { mode: "off", selectedTextureKey: null, loaded: false },
        facePlate: { key: "gray", color: 0x85898a, dark: false, selectionSource: "seeded" },
        lighting: { withEnvironment: "current" },
      },
      width: 512,
      height: 512,
      occupied: [{ x: 0, y: 0, w: 10, h: 10 }],
      registerGlyphDiagnostics: null,
      layoutState: { dials: [{}, {}], validation: { valid: true } },
      resolvePbrRepeat: (role) => (role === "metalConnector" ? [2, 1] : [1, 1]),
      normalizePbrExtrudeUVs: true,
      pbrUvNormalizationStats: [],
      environmentState: { mode: "room", requestedKey: null, selectedKey: null, loaded: false, fallback: false, intensity: 1, rotationDegrees: 0 },
      materials: {},
      annotationMeta: { wheel_reading: "01234567", wheel: null, digits: [] },
      ...overrides,
    };
  }

  it("assembles the documented top-level fields", () => {
    const metadata = buildOutputMetadata(baseArgs());
    expect(metadata.seed).toBe("meta-seed");
    expect(metadata.family).toBe("industrial_window");
    expect(metadata.layout_preset).toBe("industrial_c");
    expect(metadata.size).toEqual([512, 512]);
    expect(metadata.occupied).toBe(1);
    expect(metadata.digit_count).toBe(8);
    expect(metadata.dial_count).toBe(2);
    expect(metadata.wheel_reading).toBe("01234567");
  });

  it("defaults the seed to 'random' when seedParam is falsy", () => {
    const metadata = buildOutputMetadata(baseArgs({ seedParam: "" }));
    expect(metadata.seed).toBe("random");
  });

  it("builds pbr_repeat for all four metal roles via resolvePbrRepeat", () => {
    const metadata = buildOutputMetadata(baseArgs());
    expect(metadata.pbr_repeat).toEqual({
      metalHousing: [1, 1],
      metalBezel: [1, 1],
      metalConnector: [2, 1],
      metalMechanical: [1, 1],
    });
  });

  it("only lists textured_roles for materials that are actually present", () => {
    const args = baseArgs({ materials: { metalHousing: {}, metalBezel: {} } });
    const metadata = buildOutputMetadata(args);
    expect(metadata.textured_roles).toEqual(["metalHousing", "metalBezel"]);
  });

  it("only lists textured_components when metalDetail is present", () => {
    const withoutDetail = buildOutputMetadata(baseArgs({ materials: {} }));
    expect(withoutDetail.textured_components).toEqual([]);
    expect(withoutDetail.metal_detail_texture).toBeNull();

    const withDetail = buildOutputMetadata(baseArgs({ materials: { metalDetail: {} } }));
    expect(withDetail.textured_components).toEqual(["center_gear", "screws"]);
  });

  it("deep-clones the config into finalized_configuration (later mutation does not leak back)", () => {
    const args = baseArgs();
    const metadata = buildOutputMetadata(args);
    args.config.family = "mutated_after_the_fact";
    expect(metadata.finalized_configuration.family).toBe("industrial_window");
  });

  it("spreads annotationMeta fields (e.g. wheel_reading, digits) onto the top-level metadata", () => {
    const metadata = buildOutputMetadata(baseArgs({ annotationMeta: { wheel_reading: "9999999", wheel: null, digits: [{ pos: 0 }] } }));
    expect(metadata.wheel_reading).toBe("9999999");
    expect(metadata.digits).toEqual([{ pos: 0 }]);
  });
});

describe("installOutputAPI mask render/restore lifecycle", () => {
  function makeFakeRenderer() {
    let clearColor = new THREE.Color(0x123456);
    let clearAlpha = 1;
    const calls = [];
    return {
      calls,
      toneMapping: THREE.ACESFilmicToneMapping,
      toneMappingExposure: 1.1,
      shadowMap: { enabled: true },
      getClearColor: (target) => target.copy(clearColor),
      getClearAlpha: () => clearAlpha,
      setClearColor: (color, alpha) => {
        clearColor = color instanceof THREE.Color ? color : new THREE.Color(color);
        clearAlpha = alpha;
      },
      render: (...args) => calls.push(args),
    };
  }

  function makeScene() {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x222222);
    scene.environment = new THREE.Texture();
    scene.environmentIntensity = 0.8;
    scene.fog = new THREE.Fog(0x000000, 1, 100);
    scene.overrideMaterial = null;
    return scene;
  }

  function setup() {
    const renderer = makeFakeRenderer();
    const scene = makeScene();
    const camera = new THREE.PerspectiveCamera();
    const root = new THREE.Group();
    const hiddenChild = new THREE.Object3D();
    hiddenChild.userData.excludeFromMask = true;
    root.add(hiddenChild);
    const visibleChild = new THREE.Object3D();
    root.add(visibleChild);

    installOutputAPI({
      scene,
      camera,
      renderer,
      root,
      createMetadata: () => ({ seed: "install-seed" }),
      registerGlyphDiagnostic: false,
      createRegisterGlyphDiagnosticCanvas: () => null,
      exportMode: true,
      width: 100,
      height: 100,
    });

    return { renderer, scene, camera, root, hiddenChild, visibleChild };
  }

  it("marks the renderer ready and exposes the created metadata on window", () => {
    setup();
    expect(window.__waterMeterReady).toBe(true);
    expect(window.__waterMeterMaskReady).toBe(false);
    expect(window.__waterMeterMeta).toEqual({ seed: "install-seed" });
  });

  it("hides excludeFromMask objects, overrides the material, and renders once when the mask is requested", () => {
    const { renderer, scene, hiddenChild, visibleChild } = setup();
    window.__renderWaterMeterMask();
    expect(window.__waterMeterMaskReady).toBe(true);
    expect(hiddenChild.visible).toBe(false);
    expect(visibleChild.visible).toBe(true);
    expect(scene.overrideMaterial).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(scene.overrideMaterial.color.getHex()).toBe(0x000000);
    expect(scene.background).toEqual(new THREE.Color(0xffffff));
    expect(scene.environment).toBeNull();
    expect(renderer.calls).toHaveLength(1);
  });

  it("is a no-op guard on a second call while the mask is already active (does not re-render)", () => {
    const { renderer } = setup();
    window.__renderWaterMeterMask();
    window.__renderWaterMeterMask();
    expect(renderer.calls).toHaveLength(1);
  });

  it("restores the exact prior scene/renderer state and re-shows hidden objects", () => {
    const { renderer, scene, hiddenChild } = setup();
    const before = {
      background: scene.background,
      environment: scene.environment,
      environmentIntensity: scene.environmentIntensity,
      fog: scene.fog,
      overrideMaterial: scene.overrideMaterial,
      toneMapping: renderer.toneMapping,
      toneMappingExposure: renderer.toneMappingExposure,
      shadowMapEnabled: renderer.shadowMap.enabled,
    };

    window.__renderWaterMeterMask();
    window.__restoreWaterMeterRender();

    expect(window.__waterMeterMaskReady).toBe(false);
    expect(scene.background).toBe(before.background);
    expect(scene.environment).toBe(before.environment);
    expect(scene.environmentIntensity).toBe(before.environmentIntensity);
    expect(scene.fog).toBe(before.fog);
    expect(scene.overrideMaterial).toBe(before.overrideMaterial);
    expect(renderer.toneMapping).toBe(before.toneMapping);
    expect(renderer.toneMappingExposure).toBe(before.toneMappingExposure);
    expect(renderer.shadowMap.enabled).toBe(before.shadowMapEnabled);
    expect(hiddenChild.visible).toBe(true);
    expect(renderer.calls).toHaveLength(2);
  });

  it("leaves no permanent mutation after a full mask -> restore cycle", () => {
    const { scene } = setup();
    const backgroundBefore = scene.background;
    const environmentBefore = scene.environment;
    window.__renderWaterMeterMask();
    window.__restoreWaterMeterRender();
    expect(scene.background).toBe(backgroundBefore);
    expect(scene.environment).toBe(environmentBefore);
  });

  it("is a no-op guard when restore is called without an active mask", () => {
    const { renderer } = setup();
    expect(() => window.__restoreWaterMeterRender()).not.toThrow();
    expect(renderer.calls).toHaveLength(0);
  });
});
