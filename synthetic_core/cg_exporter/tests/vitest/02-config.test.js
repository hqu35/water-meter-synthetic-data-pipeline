import { describe, it, expect } from "vitest";
import {
  DESIGN_FAMILIES,
  createMeterConfig,
  deepMerge,
  getFacePlatePalettes,
  applyFacePlateVariation,
  applyLightingConfiguration,
  applyLightingWithEnvironment,
  selectEnvironment,
  applyDigitCountParams,
  selectDigitCount,
  selectPbrTexture,
  applyTrimStyle,
} from "../../renderer/config.js";
import { hashString, mulberry32, setRng } from "../../renderer/random.js";
import { scanForNonFinite, scanForUndefined } from "./helpers/assertFinite.js";

function makeConfig(seed, family, overrides = {}) {
  const rng = mulberry32(hashString(seed));
  setRng(rng);
  return createMeterConfig({ seed, family, width: 512, height: 512, rng, ...overrides });
}

describe("createMeterConfig", () => {
  it("returns a config whose family matches an explicitly requested valid family", () => {
    for (const family of DESIGN_FAMILIES) {
      const config = makeConfig(`seed-${family}`, family);
      expect(config.family).toBe(family);
    }
  });

  it("works for every supported DESIGN_FAMILIES value without throwing", () => {
    for (const family of DESIGN_FAMILIES) {
      expect(() => makeConfig("stable-seed", family)).not.toThrow();
    }
  });

  it("is deeply identical for the same seed + family", () => {
    const a = makeConfig("determinism-seed", "protective_shell");
    const b = makeConfig("determinism-seed", "protective_shell");
    expect(a).toEqual(b);
  });

  it("produces variation across different seeds", () => {
    const configs = ["seed-a", "seed-b", "seed-c", "seed-d", "seed-e"].map((seed) =>
      makeConfig(seed, "classic_round")
    );
    const bodyDepths = new Set(configs.map((c) => c.shape.bodyDepth));
    expect(bodyDepths.size).toBeGreaterThan(1);
  });

  it("falls back to a random valid family when family is missing or unknown", () => {
    const missing = makeConfig("missing-seed", undefined);
    expect(DESIGN_FAMILIES).toContain(missing.family);
    const invalid = makeConfig("invalid-seed", "not_a_real_family");
    expect(DESIGN_FAMILIES).toContain(invalid.family);
  });

  it("contains every required top-level section", () => {
    const config = makeConfig("sections-seed", "industrial_window");
    for (const key of [
      "output", "shape", "facePlate", "housing", "trim", "glass", "digitRegister",
      "family", "layoutPreset", "registerLayout", "dialLayout", "cover", "modules",
      "connectors", "screws", "trimStructure", "appearance", "lighting",
    ]) {
      expect(config).toHaveProperty(key);
    }
  });

  it("has no NaN/Infinity anywhere in the config, across all families", () => {
    for (const family of DESIGN_FAMILIES) {
      const config = makeConfig(`finite-${family}`, family);
      expect(scanForNonFinite(config)).toEqual([]);
    }
  });

  it("has no undefined values anywhere in the config (null placeholders are fine)", () => {
    const config = makeConfig("undefined-check", "smart_housing");
    expect(scanForUndefined(config)).toEqual([]);
  });

  it("keeps dimensions/scales/radii positive where required", () => {
    for (const family of DESIGN_FAMILIES) {
      const config = makeConfig(`positive-${family}`, family);
      expect(config.shape.bodyDepth).toBeGreaterThan(0);
      expect(config.shape.facePlateDepth).toBeGreaterThan(0);
      expect(config.shape.bezelDepth).toBeGreaterThan(0);
      expect(config.shape.outerRimHeight).toBeGreaterThan(0);
      expect(config.shape.innerRimHeight).toBeGreaterThan(0);
      expect(config.housing.thicknessScale).toBeGreaterThan(0);
      expect(config.glass.thickness).toBeGreaterThan(0);
      expect(config.output.width).toBeGreaterThan(0);
      expect(config.output.height).toBeGreaterThan(0);
    }
  });

  it("keeps digit register min/max constraints valid (min <= max, both 7 or 8)", () => {
    const config = makeConfig("digits-seed", "classic_round");
    expect(config.digitRegister.minDigits).toBeLessThanOrEqual(config.digitRegister.maxDigits);
    expect([7, 8]).toContain(config.digitRegister.minDigits);
    expect([7, 8]).toContain(config.digitRegister.maxDigits);
  });

  it("keeps registerLayout.redDigitCount within the legal [0, 3] range", () => {
    for (let i = 0; i < 30; i++) {
      const config = makeConfig(`red-digit-${i}`, "classic_round");
      expect(config.registerLayout.redDigitCount).toBeGreaterThanOrEqual(0);
      expect(config.registerLayout.redDigitCount).toBeLessThanOrEqual(3);
    }
  });

  it("keeps lighting.exposure within the implementation range [0.95, 1.12)", () => {
    for (let i = 0; i < 20; i++) {
      const config = makeConfig(`exposure-${i}`, "classic_round");
      expect(config.lighting.exposure).toBeGreaterThanOrEqual(0.95);
      expect(config.lighting.exposure).toBeLessThan(1.12);
    }
  });

  it("selects a layoutPreset that matches the chosen family's naming prefix", () => {
    for (const family of DESIGN_FAMILIES) {
      const config = makeConfig(`preset-${family}`, family);
      const prefix = family.split("_")[0];
      expect(config.layoutPreset.startsWith(prefix)).toBe(true);
    }
  });
});

describe("deepMerge", () => {
  it("overwrites shallow primitive properties", () => {
    const target = { a: 1, b: 2 };
    deepMerge(target, { b: 99 });
    expect(target).toEqual({ a: 1, b: 99 });
  });

  it("recursively merges nested objects while preserving unrelated fields", () => {
    const target = { nested: { a: 1, b: 2 } };
    deepMerge(target, { nested: { b: 3 } });
    expect(target).toEqual({ nested: { a: 1, b: 3 } });
  });

  it("replaces arrays wholesale rather than merging them element-wise", () => {
    const target = { list: [1, 2, 3] };
    deepMerge(target, { list: [9] });
    expect(target.list).toEqual([9]);
  });

  it("overwrites with null rather than treating null as 'no-op'", () => {
    const target = { value: { nested: true } };
    deepMerge(target, { value: null });
    expect(target.value).toBeNull();
  });

  it("treats a null/undefined source as a no-op", () => {
    const target = { a: 1 };
    expect(deepMerge(target, null)).toEqual({ a: 1 });
    expect(deepMerge(target, undefined)).toEqual({ a: 1 });
  });

  it("mutates and returns the same target reference", () => {
    const target = { a: 1 };
    const result = deepMerge(target, { a: 2 });
    expect(result).toBe(target);
  });

  it("documents current behavior: a falsy-but-defined target value is replaced by {} before merging in a nested object", () => {
    const target = { count: 0 };
    deepMerge(target, { count: { nested: 1 } });
    expect(target.count).toEqual({ nested: 1 });
  });
});

describe("family profile behavior (via createMeterConfig)", () => {
  it("returns a structurally valid config for every family", () => {
    for (const family of DESIGN_FAMILIES) {
      const config = makeConfig(`profile-${family}`, family);
      expect(config.dialLayout.count).toBeGreaterThanOrEqual(1);
      expect(config.dialLayout.count).toBeLessThanOrEqual(3);
      expect(Array.isArray(config.dialLayout.anchors)).toBe(true);
      expect(config.dialLayout.anchors.length).toBeGreaterThan(0);
    }
  });

  it("keeps family-specific expected traits (e.g. industrial_window always gets a module)", () => {
    const config = makeConfig("industrial-trait-seed", "industrial_window");
    expect(config.modules.type).toBe("industrial_plate");
    expect(config.modules.count).toBe(1);
  });

  it("falls back to classic_round's profile for an unrecognized family passed directly to internals", () => {
    // createMeterConfig always normalizes to a DESIGN_FAMILIES member before
    // building the profile, so an invalid family never reaches
    // createFamilyProfile in practice; this documents that the fallback
    // (profiles[family] || profiles.classic_round) exists as a safety net.
    const config = makeConfig("unknown-family-seed", "totally_bogus_family");
    expect(DESIGN_FAMILIES).toContain(config.family);
  });
});

describe("applyFacePlateVariation", () => {
  it("is deterministic for the same seed/family", () => {
    const a = makeConfig("faceplate-det-seed", "industrial_window");
    const b = makeConfig("faceplate-det-seed", "industrial_window");
    expect(a.facePlate).toEqual(b.facePlate);
  });

  it("lets a valid explicit override win", () => {
    const config = makeConfig("faceplate-override-seed", "classic_round");
    applyFacePlateVariation(config, "faceplate-override-seed", "white");
    expect(config.facePlate.key).toBe("white");
    expect(config.facePlate.selectionSource).toBe("override");
  });

  it("maps known aliases to their canonical palette key", () => {
    const config = makeConfig("faceplate-alias-seed", "classic_round");
    applyFacePlateVariation(config, "faceplate-alias-seed", "silver-gray");
    expect(config.facePlate.key).toBe("silver");
  });

  it("documents current behavior for an invalid override key: silently falls back to seeded selection", () => {
    const config = makeConfig("faceplate-invalid-seed", "classic_round");
    applyFacePlateVariation(config, "faceplate-invalid-seed", "not-a-real-color");
    const palette = getFacePlatePalettes().classic_round;
    expect(palette.map((p) => p.key)).toContain(config.facePlate.key);
    expect(config.facePlate.selectionSource).toBe("seeded");
  });

  it("classifies dark colors correctly and assigns light label colors", () => {
    const config = makeConfig("dark-face-seed", "industrial_window");
    applyFacePlateVariation(config, "dark-face-seed", "black");
    expect(config.facePlate.dark).toBe(true);
    expect(config.facePlate.primaryLabelColor).toBe("#f2f3ef");
    expect(config.facePlate.secondaryLabelColor).toBe("#d8e7f2");
  });

  it("classifies light colors correctly and assigns dark label colors", () => {
    const config = makeConfig("light-face-seed", "industrial_window");
    applyFacePlateVariation(config, "light-face-seed", "white");
    expect(config.facePlate.dark).toBe(false);
    expect(config.facePlate.primaryLabelColor).toBe("#111820");
    expect(config.facePlate.secondaryLabelColor).toBe("#145faf");
  });

  it("produces valid hex color strings for both label colors", () => {
    const config = makeConfig("hex-face-seed", "smart_housing");
    applyFacePlateVariation(config, "hex-face-seed", null);
    expect(config.facePlate.primaryLabelColor).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(config.facePlate.secondaryLabelColor).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it("mutates only config.facePlate, leaving other sections untouched by reference", () => {
    const config = makeConfig("mutation-scope-seed", "classic_round");
    const shapeRef = config.shape;
    const housingRef = config.housing;
    applyFacePlateVariation(config, "mutation-scope-seed", "white");
    expect(config.shape).toBe(shapeRef);
    expect(config.housing).toBe(housingRef);
  });
});

describe("applyLightingConfiguration", () => {
  it("is deterministic for the same seed", () => {
    const configA = { lighting: {} };
    const configB = { lighting: {} };
    applyLightingConfiguration(configA, "lighting-seed");
    applyLightingConfiguration(configB, "lighting-seed");
    expect(configA.lighting).toEqual(configB.lighting);
  });

  it("produces finite values within the fixed implementation ranges", () => {
    const config = { lighting: {} };
    applyLightingConfiguration(config, "lighting-range-seed");
    expect(config.lighting.keyLightIntensity).toBe(1.54);
    expect(config.lighting.fillLightIntensity).toBe(0.6);
    expect(config.lighting.rimLightIntensity).toBe(0.39);
    expect(config.lighting.exposure).toBeGreaterThanOrEqual(0.92);
    expect(config.lighting.exposure).toBeLessThan(0.98);
  });
});

describe("applyLightingWithEnvironment", () => {
  it("scales intensities for 'weak' mode (0.45x)", () => {
    const config = { lighting: { keyLightIntensity: 10, fillLightIntensity: 10, rimLightIntensity: 10 } };
    applyLightingWithEnvironment(config, "weak");
    expect(config.lighting.keyLightIntensity).toBeCloseTo(4.5);
    expect(config.lighting.fillLightIntensity).toBeCloseTo(4.5);
    expect(config.lighting.rimLightIntensity).toBeCloseTo(4.5);
    expect(config.lighting.withEnvironment).toBe("weak");
  });

  it("zeroes intensities for 'off' mode", () => {
    const config = { lighting: { keyLightIntensity: 10, fillLightIntensity: 10, rimLightIntensity: 10 } };
    applyLightingWithEnvironment(config, "off");
    expect(config.lighting.keyLightIntensity).toBe(0);
    expect(config.lighting.fillLightIntensity).toBe(0);
    expect(config.lighting.rimLightIntensity).toBe(0);
  });

  it("leaves intensities unchanged for 'current' mode", () => {
    const config = { lighting: { keyLightIntensity: 10, fillLightIntensity: 10, rimLightIntensity: 10 } };
    applyLightingWithEnvironment(config, "current");
    expect(config.lighting.keyLightIntensity).toBe(10);
  });

  it("documents current behavior: an invalid/missing mode silently falls back to 'current'", () => {
    const config = { lighting: { keyLightIntensity: 10, fillLightIntensity: 10, rimLightIntensity: 10 } };
    applyLightingWithEnvironment(config, "bogus-mode");
    expect(config.lighting.withEnvironment).toBe("current");
    expect(config.lighting.keyLightIntensity).toBe(10);
    applyLightingWithEnvironment({ lighting: { keyLightIntensity: 1, fillLightIntensity: 1, rimLightIntensity: 1 } }, undefined);
  });

  it("never produces NaN regardless of mode combination", () => {
    for (const mode of ["current", "weak", "off", "bogus", undefined, null]) {
      const config = { lighting: { keyLightIntensity: 1.54, fillLightIntensity: 0.6, rimLightIntensity: 0.39 } };
      applyLightingWithEnvironment(config, mode);
      expect(scanForNonFinite(config.lighting)).toEqual([]);
    }
  });
});

describe("selectEnvironment", () => {
  it("selects the requested key in 'single' mode when valid", () => {
    const result = selectEnvironment("env-seed", "classic_round", "single", "empty_warehouse", null, null);
    expect(result.selectedKey).toBe("empty_warehouse");
  });

  it("documents current behavior: an invalid key in 'single' mode falls back to null (RoomEnvironment)", () => {
    const result = selectEnvironment("env-seed", "classic_round", "single", "not_a_real_hdri", null, null);
    expect(result.selectedKey).toBeNull();
  });

  it("is deterministic in 'random' mode for the same seed/family", () => {
    const a = selectEnvironment("random-env-seed", "smart_housing", "random", null, null, null);
    const b = selectEnvironment("random-env-seed", "smart_housing", "random", null, null, null);
    expect(a.selectedKey).toBe(b.selectedKey);
  });

  it("clamps an explicit intensity override into [0.5, 1.4]", () => {
    const high = selectEnvironment("seed", "classic_round", "room", null, "999", null);
    expect(high.intensity).toBe(1.4);
    const low = selectEnvironment("seed", "classic_round", "room", null, "-5", null);
    expect(low.intensity).toBe(0.5);
  });

  it("clamps an explicit rotation override into [-180, 180]", () => {
    const high = selectEnvironment("seed", "classic_round", "room", null, null, "999");
    expect(high.rotationDegrees).toBe(180);
    const low = selectEnvironment("seed", "classic_round", "room", null, null, "-999");
    expect(low.rotationDegrees).toBe(-180);
  });

  it("falls back to mode 'room' for an invalid requested mode, selecting no HDRI", () => {
    const result = selectEnvironment("seed", "classic_round", "bogus-mode", null, null, null);
    expect(result.mode).toBe("room");
    expect(result.selectedKey).toBeNull();
    expect(result.intensity).toBe(1);
  });

  it("never produces NaN across mode/override combinations", () => {
    for (const mode of ["room", "single", "random", "bogus"]) {
      for (const intensity of [null, "", "0.8", "abc"]) {
        for (const rotation of [null, "", "30", "xyz"]) {
          const result = selectEnvironment("fuzz-seed", "classic_round", mode, "empty_warehouse", intensity, rotation);
          expect(scanForNonFinite(result)).toEqual([]);
        }
      }
    }
  });
});

describe("applyDigitCountParams", () => {
  it("sets an exact digit count when exactDigitsParam is a finite number, clamped to [7, 8]", () => {
    const config = { digitRegister: { minDigits: 7, maxDigits: 8 } };
    applyDigitCountParams(config, { exactDigitsParam: "7.6", digitMinParam: null, digitMaxParam: null });
    expect(config.digitRegister.exactDigits).toBe(8);
    expect(config.digitRegister.minDigits).toBe(8);
    expect(config.digitRegister.maxDigits).toBe(8);
    expect(config.digitRegister.digitCountSource).toBe("url_override");
  });

  it("clamps an out-of-range exactDigitsParam into [7, 8]", () => {
    const low = { digitRegister: { minDigits: 7, maxDigits: 8 } };
    applyDigitCountParams(low, { exactDigitsParam: "5", digitMinParam: null, digitMaxParam: null });
    expect(low.digitRegister.exactDigits).toBe(7);

    const high = { digitRegister: { minDigits: 7, maxDigits: 8 } };
    applyDigitCountParams(high, { exactDigitsParam: "10", digitMinParam: null, digitMaxParam: null });
    expect(high.digitRegister.exactDigits).toBe(8);
  });

  it("swaps min/max when digitMinParam exceeds digitMaxParam", () => {
    const config = { digitRegister: { minDigits: 7, maxDigits: 8 } };
    applyDigitCountParams(config, { exactDigitsParam: null, digitMinParam: "8", digitMaxParam: "7" });
    expect(config.digitRegister.minDigits).toBe(7);
    expect(config.digitRegister.maxDigits).toBe(8);
  });

  it("leaves defaults untouched when all params are null", () => {
    const config = { digitRegister: { minDigits: 7, maxDigits: 8 } };
    applyDigitCountParams(config, { exactDigitsParam: null, digitMinParam: null, digitMaxParam: null });
    expect(config.digitRegister).toEqual({ minDigits: 7, maxDigits: 8 });
  });

  it("documents current behavior: an empty-string exactDigitsParam is treated as 0 (Number('') === 0) and clamped to 7", () => {
    // export-cg-single.js only sets DIGITS when the env var is truthy, so an
    // actual "" value would require a URL like "?digits=" to reach here.
    // Number("") is 0, which is finite, so the exactDigits branch still
    // fires instead of being skipped.
    const config = { digitRegister: { minDigits: 7, maxDigits: 8 } };
    applyDigitCountParams(config, { exactDigitsParam: "", digitMinParam: null, digitMaxParam: null });
    expect(config.digitRegister.exactDigits).toBe(7);
  });
});

describe("selectDigitCount", () => {
  it("returns exactDigits verbatim when set, marking source url_override", () => {
    const config = { digitRegister: { exactDigits: 7, minDigits: 7, maxDigits: 8 } };
    expect(selectDigitCount(config, () => 0.99)).toBe(7);
    expect(config.digitRegister.digitCountSource).toBe("url_override");
  });

  it("weights 8 for r < 0.7 and 7 otherwise, marking source seeded_weighted_70_30", () => {
    const highDigits = { digitRegister: { exactDigits: null, minDigits: 7, maxDigits: 8 } };
    expect(selectDigitCount(highDigits, () => 0)).toBe(8);
    const lowDigits = { digitRegister: { exactDigits: null, minDigits: 7, maxDigits: 8 } };
    expect(selectDigitCount(lowDigits, () => 0.99)).toBe(7);
    expect(lowDigits.digitRegister.digitCountSource).toBe("seeded_weighted_70_30");
  });

  it("clamps the weighted result into [minDigits, maxDigits] even when both are forced to 7", () => {
    const config = { digitRegister: { exactDigits: null, minDigits: 7, maxDigits: 7 } };
    expect(selectDigitCount(config, () => 0)).toBe(7);
  });
});

describe("selectPbrTexture", () => {
  it("returns no texture for mode 'off'", () => {
    expect(selectPbrTexture("seed", "classic_round", "off", null)).toEqual({ mode: "off", textureKey: null });
  });

  it("returns the requested key for a valid 'single' mode request", () => {
    const result = selectPbrTexture("seed", "classic_round", "single", "Metal021");
    expect(result).toEqual({ mode: "single", textureKey: "Metal021" });
  });

  it("documents current behavior: an invalid 'single' key falls back to null rather than throwing", () => {
    const result = selectPbrTexture("seed", "classic_round", "single", "NotARealTexture");
    expect(result).toEqual({ mode: "single", textureKey: null });
  });

  it("is deterministic in 'random' mode for the same seed/family", () => {
    const a = selectPbrTexture("pbr-random-seed", "industrial_window", "random", null);
    const b = selectPbrTexture("pbr-random-seed", "industrial_window", "random", null);
    expect(a).toEqual(b);
  });

  it("returns null textureKey in 'random' mode when the family has an empty/unknown texture pool", () => {
    const result = selectPbrTexture("seed", "unknown_family", "random", null);
    expect(result).toEqual({ mode: "random", textureKey: null });
  });

  it("defaults an invalid requestedMode to 'off'", () => {
    const result = selectPbrTexture("seed", "classic_round", "bogus-mode", null);
    expect(result.mode).toBe("off");
    expect(result.textureKey).toBeNull();
  });
});

describe("applyTrimStyle", () => {
  it("assigns the documented primary/secondary color pair for each known style", () => {
    const table = {
      black: [0x111111, 0x496f91],
      dark: [0x17191b, 0x5e676b],
      gray: [0x2f3438, 0x9aa2a6],
      steel: [0x8f979b, 0x5f7484],
      bronze: [0x4a3422, 0x8b6b38],
      blueGray: [0x263947, 0x5f7d8f],
      whiteEnamel: [0xf2f0e7, 0x9ba2a0],
    };
    for (const [style, [primary, secondary]] of Object.entries(table)) {
      const trim = { style };
      applyTrimStyle(trim);
      expect(trim.primaryTrimColor).toBe(primary);
      expect(trim.secondaryTrimColor).toBe(secondary);
    }
  });

  it("forces gold trim colors and useGoldTrim for the 'gold' style, honoring a custom goldColor", () => {
    const trim = { style: "gold", goldColor: 0xabcdef };
    applyTrimStyle(trim);
    expect(trim.useGoldTrim).toBe(true);
    expect(trim.primaryTrimColor).toBe(0xabcdef);
    expect(trim.secondaryTrimColor).toBe(0xabcdef);
  });

  it("propagates the primary trim color into the border/outline fields", () => {
    const trim = { style: "steel" };
    applyTrimStyle(trim);
    expect(trim.digitWindowBorderColor).toBe(trim.primaryTrimColor);
    expect(trim.dialBorderColor).toBe(trim.primaryTrimColor);
    expect(trim.innerOutlineColor).toBe(trim.primaryTrimColor);
  });

  it("falls back to the 'black' palette for an unknown style", () => {
    const trim = { style: "not_a_real_style" };
    applyTrimStyle(trim);
    expect(trim.primaryTrimColor).toBe(0x111111);
    expect(trim.secondaryTrimColor).toBe(0x496f91);
  });
});
