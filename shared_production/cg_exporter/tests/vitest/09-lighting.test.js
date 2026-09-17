import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as THREE from "../../vendor/three.module.js";
import { HDRI_MANIFEST, addLights, addStudioBackdrop } from "../../renderer/lighting.js";
import { hashString, mulberry32, setRng } from "../../renderer/random.js";
import { installFakeDom } from "./helpers/fakeDom.js";

let uninstallFakeDom;
beforeEach(() => {
  uninstallFakeDom = installFakeDom();
});
afterEach(() => {
  uninstallFakeDom();
});

// NOTE on scope: createSceneEnvironment()/loadHdriEnvironment() require a
// real WebGL-backed THREE.WebGLRenderer (PMREMGenerator.fromScene /
// fromEquirectangular actually render into a render target) plus an
// EXRLoader file fetch. Neither can be meaningfully exercised in plain
// Node without a WebGL context, so they are left as browser-only
// integration surface rather than being mocked into a no-op that would not
// actually verify anything. addLights() and addStudioBackdrop() are pure
// scene-graph construction and are fully unit-testable.

describe("HDRI_MANIFEST", () => {
  it("is frozen and maps each key to a string asset path", () => {
    expect(Object.isFrozen(HDRI_MANIFEST)).toBe(true);
    for (const path of Object.values(HDRI_MANIFEST)) {
      expect(typeof path).toBe("string");
      expect(path.length).toBeGreaterThan(0);
    }
  });
});

describe("addLights", () => {
  function makeConfig(overrides = {}) {
    return {
      lighting: {
        keyLightIntensity: 1.54,
        fillLightIntensity: 0.6,
        rimLightIntensity: 0.39,
        keyLightPosition: [-300, 320, 650],
        fillLightPosition: [270, -190, 430],
        rimLightPosition: [0, 380, -260],
        ...overrides,
      },
    };
  }

  it("adds exactly one hemisphere light and three directional lights", () => {
    const scene = new THREE.Scene();
    addLights({ scene, config: makeConfig() });
    expect(scene.children).toHaveLength(4);
    const hemisphereCount = scene.children.filter((c) => c instanceof THREE.HemisphereLight).length;
    const directionalCount = scene.children.filter((c) => c instanceof THREE.DirectionalLight).length;
    expect(hemisphereCount).toBe(1);
    expect(directionalCount).toBe(3);
  });

  it("propagates configured intensities and positions to the correct lights", () => {
    const scene = new THREE.Scene();
    addLights({ scene, config: makeConfig({ keyLightIntensity: 2.1, fillLightIntensity: 0.7, rimLightIntensity: 0.25 }) });
    const [, key, fill, rim] = scene.children;
    expect(key.intensity).toBeCloseTo(2.1);
    expect(key.position.toArray()).toEqual([-300, 320, 650]);
    expect(fill.intensity).toBeCloseTo(0.7);
    expect(fill.position.toArray()).toEqual([270, -190, 430]);
    expect(rim.intensity).toBeCloseTo(0.25);
    expect(rim.position.toArray()).toEqual([0, 380, -260]);
  });

  it("enables shadow casting only on the key light", () => {
    const scene = new THREE.Scene();
    addLights({ scene, config: makeConfig() });
    const [, key, fill, rim] = scene.children;
    expect(key.castShadow).toBe(true);
    expect(fill.castShadow).toBe(false);
    expect(rim.castShadow).toBe(false);
  });

  it("keeps every light intensity finite and non-negative for zeroed (off) lighting", () => {
    const scene = new THREE.Scene();
    addLights({ scene, config: makeConfig({ keyLightIntensity: 0, fillLightIntensity: 0, rimLightIntensity: 0 }) });
    for (const light of scene.children) {
      expect(Number.isFinite(light.intensity)).toBe(true);
      expect(light.intensity).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("addStudioBackdrop", () => {
  it("adds exactly one plane mesh with a CanvasTexture map, excluded from the mask pass", () => {
    setRng(mulberry32(hashString("backdrop-seed")));
    const root = new THREE.Group();
    addStudioBackdrop({ root });
    expect(root.children).toHaveLength(1);
    const [plane] = root.children;
    expect(plane).toBeInstanceOf(THREE.Mesh);
    expect(plane.geometry).toBeInstanceOf(THREE.PlaneGeometry);
    expect(plane.material.map).toBeInstanceOf(THREE.CanvasTexture);
    expect(plane.position.z).toBe(-190);
    expect(plane.userData.excludeFromMask).toBe(true);
  });

  it("does not throw across a range of seeds (all mood palettes get exercised)", () => {
    for (let i = 0; i < 10; i++) {
      setRng(mulberry32(hashString(`backdrop-seed-${i}`)));
      const root = new THREE.Group();
      expect(() => addStudioBackdrop({ root })).not.toThrow();
    }
  });
});
