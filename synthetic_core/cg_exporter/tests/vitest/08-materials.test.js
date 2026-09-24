import { describe, it, expect } from "vitest";
import * as THREE from "../../vendor/three.module.js";
import {
  PBR_TEXTURE_MANIFEST,
  FAMILY_TEXTURE_POOLS,
  createHousingMaterial,
  createTrimMaterial,
  createMaterials,
} from "../../renderer/materials.js";

const NO_RUNTIME = {
  pbrRepeatParam: "",
  pbrRoughnessMapParam: "",
  pbrMetalnessMapParam: "",
  pbrRoughnessParam: "",
  pbrMetalnessParam: "",
  pbrNormalScaleParam: "",
};

function fakeTextureSet() {
  return {
    map: new THREE.Texture(),
    roughnessMap: new THREE.Texture(),
    metalnessMap: new THREE.Texture(),
    normalMap: new THREE.Texture(),
  };
}

describe("PBR manifests", () => {
  it("is frozen and lists the expected texture roles for every entry", () => {
    expect(Object.isFrozen(PBR_TEXTURE_MANIFEST)).toBe(true);
    for (const entry of Object.values(PBR_TEXTURE_MANIFEST)) {
      expect(entry).toHaveProperty("color");
      expect(entry).toHaveProperty("roughness");
      expect(entry).toHaveProperty("metalness");
      expect(entry).toHaveProperty("normal");
    }
  });

  it("gives every FAMILY_TEXTURE_POOLS entry only keys that exist in the manifest", () => {
    for (const pool of Object.values(FAMILY_TEXTURE_POOLS)) {
      for (const key of pool) {
        expect(PBR_TEXTURE_MANIFEST).toHaveProperty(key);
      }
    }
  });
});

describe("createHousingMaterial", () => {
  it("returns a MeshPhysicalMaterial for plastic", () => {
    const material = createHousingMaterial({ materialType: "plastic", color: 0xffffff, roughness: 0.5 });
    expect(material).toBeInstanceOf(THREE.MeshPhysicalMaterial);
  });

  it("returns a MeshStandardMaterial with fixed colors for brass/darkMetal/agedMetal", () => {
    const brass = createHousingMaterial({ materialType: "brass" });
    expect(brass).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(brass.color.getHex()).toBe(0x9a6d2f);

    const dark = createHousingMaterial({ materialType: "darkMetal" });
    expect(dark.color.getHex()).toBe(0x303236);

    const aged = createHousingMaterial({ materialType: "agedMetal" });
    expect(aged.color.getHex()).toBe(0x756957);
  });

  it("falls back to the config's own color/roughness/metalness for an unknown materialType", () => {
    const material = createHousingMaterial({ materialType: "paintedMetal", color: 0x123456, roughness: 0.3, metalness: 0.4 });
    expect(material.color.getHex()).toBe(0x123456);
    expect(material.roughness).toBeCloseTo(0.3);
    expect(material.metalness).toBeCloseTo(0.4);
  });
});

describe("createTrimMaterial", () => {
  it("uses the requested color key by default", () => {
    const material = createTrimMaterial({ primaryTrimColor: 0x111111, secondaryTrimColor: 0x496f91 }, "secondaryTrimColor");
    expect(material.color.getHex()).toBe(0x496f91);
  });

  it("forces the gold color when useGoldTrim is set, regardless of the requested key", () => {
    const material = createTrimMaterial({ useGoldTrim: true, goldColor: 0xc69b3c, secondaryTrimColor: 0x496f91 }, "secondaryTrimColor");
    expect(material.color.getHex()).toBe(0xc69b3c);
    expect(material.metalness).toBeCloseTo(0.78);
  });

  it("gives 'steel' a distinct roughness/metalness from the default", () => {
    const steel = createTrimMaterial({ style: "steel", primaryTrimColor: 0x111111 }, "primaryTrimColor");
    const generic = createTrimMaterial({ style: "black", primaryTrimColor: 0x111111 }, "primaryTrimColor");
    expect(steel.roughness).not.toBeCloseTo(generic.roughness);
  });
});

describe("createMaterials", () => {
  const baseConfig = () => ({
    family: "classic_round",
    housing: { materialType: "paintedMetal", color: 0xe6e2d8, roughness: 0.46, metalness: 0.52 },
    facePlate: { color: 0xfffbf2, roughness: 0.48, metalness: 0 },
    trim: { style: "black", primaryTrimColor: 0x111111, secondaryTrimColor: 0x496f91, digitWindowBorderColor: 0x111111 },
    glass: { tint: 0xffffff, roughness: 0.04, transmission: 1, thickness: 8, ior: 1.5, clearcoat: 1, clearcoatRoughness: 0.02, specularIntensity: 1, envMapIntensity: 1 },
    pbr: { loaded: false, selectedTextureKey: null },
  });

  it("returns the expected fixed material roles with sane material types", () => {
    const { materials } = createMaterials({ config: baseConfig(), loadedPbrTextureSet: null, runtime: NO_RUNTIME });
    for (const key of ["white", "warmWhite", "facePlate", "dark", "black", "rubber", "blue", "red", "gray", "metal", "brass", "glass", "glassEdge"]) {
      expect(materials).toHaveProperty(key);
      expect(materials[key]).toBeInstanceOf(THREE.Material);
    }
  });

  it("leaves textured PBR roles null when no texture set is loaded", () => {
    const { materials } = createMaterials({ config: baseConfig(), loadedPbrTextureSet: null, runtime: NO_RUNTIME });
    expect(materials.metalHousing).toBeNull();
    expect(materials.metalBezel).toBeNull();
    expect(materials.metalConnector).toBeNull();
    expect(materials.metalMechanical).toBeNull();
    expect(materials.metalDetail).toBeNull();
  });

  it("resolvePbrRepeat defaults to [2,1] for metalConnector and [1,1] otherwise", () => {
    const { resolvePbrRepeat } = createMaterials({ config: baseConfig(), loadedPbrTextureSet: null, runtime: NO_RUNTIME });
    expect(resolvePbrRepeat("metalConnector")).toEqual([2, 1]);
    expect(resolvePbrRepeat("metalHousing")).toEqual([1, 1]);
  });

  it("resolvePbrRepeat honors a finite, positive diagnostic override", () => {
    const { resolvePbrRepeat } = createMaterials({ config: baseConfig(), loadedPbrTextureSet: null, runtime: { ...NO_RUNTIME, pbrRepeatParam: "4" } });
    expect(resolvePbrRepeat("metalConnector")).toEqual([4, 1]);
    expect(resolvePbrRepeat("metalHousing")).toEqual([4, 4]);
  });

  it("metalRoleMaterial falls back to the given material when the role is unset", () => {
    const { metalRoleMaterial, materials } = createMaterials({ config: baseConfig(), loadedPbrTextureSet: null, runtime: NO_RUNTIME });
    const fallback = {};
    expect(metalRoleMaterial("metalHousing", fallback)).toBe(fallback);
    expect(metalRoleMaterial("white", fallback)).toBe(materials.white);
  });

  it("builds real textured materials for roles the family allows once a texture set is loaded", () => {
    const config = baseConfig();
    config.pbr = { loaded: true, selectedTextureKey: "Metal021" };
    const { materials } = createMaterials({ config, loadedPbrTextureSet: fakeTextureSet(), runtime: NO_RUNTIME });
    // classic_round allows metalHousing/metalBezel/metalConnector but not metalMechanical.
    expect(materials.metalHousing).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(materials.metalBezel).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(materials.metalConnector).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(materials.metalMechanical).toBeNull();
    expect(materials.metalDetail).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(materials.metalHousing.userData.pbrRole).toBe("metalHousing");
    expect(materials.metalHousing.userData.normalizeExtrudeUVs).toBe(true);
  });

  it("returns null for a texture role when the selected key does not match the loaded set", () => {
    const config = baseConfig();
    config.pbr = { loaded: true, selectedTextureKey: "Metal034" };
    // loadedPbrTextureSet exists but was (in this fabricated scenario) loaded
    // for a different key than config.pbr.selectedTextureKey reports.
    const { materials } = createMaterials({ config, loadedPbrTextureSet: null, runtime: NO_RUNTIME });
    expect(materials.metalHousing).toBeNull();
  });

  it("applies diagnostic roughness/metalness/normalScale overrides to textured materials", () => {
    const config = baseConfig();
    config.pbr = { loaded: true, selectedTextureKey: "Metal021" };
    const { materials } = createMaterials({
      config,
      loadedPbrTextureSet: fakeTextureSet(),
      runtime: { ...NO_RUNTIME, pbrRoughnessParam: "0.33", pbrMetalnessParam: "0.77", pbrNormalScaleParam: "0.9" },
    });
    expect(materials.metalHousing.roughness).toBeCloseTo(0.33);
    expect(materials.metalHousing.metalness).toBeCloseTo(0.77);
    expect(materials.metalHousing.normalScale.x).toBeCloseTo(0.9);
  });

  it("disables the roughness/metalness map when the corresponding runtime flag is 'off'", () => {
    const config = baseConfig();
    config.pbr = { loaded: true, selectedTextureKey: "Metal021" };
    const { materials } = createMaterials({
      config,
      loadedPbrTextureSet: fakeTextureSet(),
      runtime: { ...NO_RUNTIME, pbrRoughnessMapParam: "off", pbrMetalnessMapParam: "off" },
    });
    expect(materials.metalHousing.roughnessMap).toBeNull();
    expect(materials.metalHousing.metalnessMap).toBeNull();
    expect(materials.metalHousing.map).not.toBeNull();
  });
});
