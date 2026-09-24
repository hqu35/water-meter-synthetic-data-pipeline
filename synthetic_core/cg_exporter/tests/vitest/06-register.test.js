import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as THREE from "../../vendor/three.module.js";
import {
  createRegisterState,
  placeDigitRegister,
  makeRollingDigitTexture,
  createRegisterGlyphDiagnosticCanvas,
} from "../../renderer/register.js";
import { insideShell, padRect } from "../../renderer/validation.js";
import { selectDigitCount } from "../../renderer/config.js";
import { hashString, mulberry32, setRng } from "../../renderer/random.js";
import { scanForNonFinite } from "./helpers/assertFinite.js";
import { installFakeDom } from "./helpers/fakeDom.js";

let uninstallFakeDom;
beforeEach(() => {
  uninstallFakeDom = installFakeDom();
});
afterEach(() => {
  uninstallFakeDom();
});

// NOTE on scope: the task brief assumed register.js used a physical
// CylinderGeometry-based digit wheel with its own texture cache. The actual
// implementation renders rolling digits as 2D canvas textures (a vertically
// stacked "strip" of 10 glyphs sampled through a curved aperture) and the
// only cache on RegisterState is `glyphStyleCache` (a Map keyed by cell
// size) plus a `glyphDiagnostics` snapshot. Tests below target what the
// module actually does, not the assumed cylinder/atlas contract.

describe("createRegisterState", () => {
  it("returns a fresh, independent state with an empty glyph cache", () => {
    const state = createRegisterState();
    expect(state.glyphStyleCache).toBeInstanceOf(Map);
    expect(state.glyphStyleCache.size).toBe(0);
    expect(state.glyphDiagnostics).toBeNull();
  });

  it("does not share the glyph cache Map instance across separate states", () => {
    const a = createRegisterState();
    const b = createRegisterState();
    expect(a.glyphStyleCache).not.toBe(b.glyphStyleCache);
    a.glyphStyleCache.set("k", "v");
    expect(b.glyphStyleCache.size).toBe(0);
  });
});

describe("makeRollingDigitTexture", () => {
  beforeEach(() => {
    // addWheelSurfaceGrain() calls rand(), which reads the module-level RNG
    // installed via setRng(); it is not passed explicitly to this function.
    setRng(mulberry32(hashString("register-texture-seed")));
  });

  it("returns a CanvasTexture with sRGB color space for representative wheel dimensions", () => {
    const state = createRegisterState();
    const texture = makeRollingDigitTexture(state, 3, 0.4, false, 60, 70, 55);
    expect(texture).toBeInstanceOf(THREE.CanvasTexture);
    expect(texture.colorSpace).toBe(THREE.SRGBColorSpace);
  });

  it("does not crash for any digit 0-9, rolling or not, red or ivory", () => {
    const state = createRegisterState();
    for (let digit = 0; digit <= 9; digit++) {
      for (const red of [false, true]) {
        expect(() => makeRollingDigitTexture(state, digit, 0.5, red, 60, 70, 55)).not.toThrow();
      }
    }
  });

  it("generates diagnostics for all 10 glyphs on a cache miss, with zero variation under the fake rasterizer", () => {
    const state = createRegisterState();
    makeRollingDigitTexture(state, 0, 0, false, 60, 70, 55);
    expect(state.glyphDiagnostics).not.toBeNull();
    expect(state.glyphDiagnostics.digits).toHaveLength(10);
    expect(state.glyphDiagnostics.digits.map((d) => d.glyph)).toEqual(
      ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]
    );
    expect(state.glyphDiagnostics.widthVariation).toBeLessThanOrEqual(0.03);
    expect(state.glyphDiagnostics.heightVariation).toBeLessThanOrEqual(0.03);
    expect(scanForNonFinite(state.glyphDiagnostics)).toEqual([]);
  });

  it("reuses the same glyphStyleCache entry for identical wheel/glyph-box dimensions", () => {
    const state = createRegisterState();
    makeRollingDigitTexture(state, 1, 0, false, 60, 70, 55);
    expect(state.glyphStyleCache.size).toBe(1);
    makeRollingDigitTexture(state, 7, 0.8, true, 60, 70, 55);
    expect(state.glyphStyleCache.size).toBe(1);
  });

  it("creates a new glyphStyleCache entry when the effective cell size changes", () => {
    const state = createRegisterState();
    makeRollingDigitTexture(state, 0, 0, false, 60, 70, 55);
    makeRollingDigitTexture(state, 0, 0, false, 90, 120, 80);
    expect(state.glyphStyleCache.size).toBe(2);
  });

  it("caches red and ivory glyph tints separately, keyed by fill color", () => {
    const state = createRegisterState();
    makeRollingDigitTexture(state, 0, 0, false, 60, 70, 55);
    const cacheKey = [...state.glyphStyleCache.keys()][0];
    const styleZero = state.glyphStyleCache.get(cacheKey).styles["0"];
    expect(styleZero.tintedMasks.size).toBe(1);
    makeRollingDigitTexture(state, 0, 0, true, 60, 70, 55);
    expect(styleZero.tintedMasks.size).toBe(2);
  });
});

describe("createRegisterGlyphDiagnosticCanvas", () => {
  it("returns a fixed-size diagnostic canvas without throwing", () => {
    setRng(mulberry32(hashString("diagnostic-canvas-seed")));
    const state = createRegisterState();
    const canvas = createRegisterGlyphDiagnosticCanvas(state);
    expect(canvas.width).toBe(1120);
    expect(canvas.height).toBe(650);
  });
});

describe("placeDigitRegister", () => {
  function makeHarness({ redDigitCount = 2, seed = "register-seed", bandOverrides = {} } = {}) {
    const rng = mulberry32(hashString(seed));
    setRng(rng);
    const shell = { inner: 300, scaleX: 1, scaleY: 1, shape: "roundedRect" };
    const faceLayout = { register: { x: -280, y: -20, w: 560, h: 200, ...bandOverrides } };
    const meterConfig = {
      family: "test_family",
      layoutPreset: "test_preset",
      registerLayout: { widthScale: 1, heightScale: 1, redDigitCount },
      digitRegister: { minDigits: 7, maxDigits: 8, exactDigits: null, selectedDigitCount: null, digitCountSource: null, redDigitCount: null },
    };
    const root = new THREE.Group();
    const annotationState = { wheel: null, digits: [], wheelReading: "" };
    const layoutState = { register: null };
    const occupied = [];
    const registerState = createRegisterState();
    const assertSingleCreationCalls = [];
    const ctx = {
      config: meterConfig,
      rng,
      root,
      materials: { dark: {}, black: {}, gray: {}, red: {}, warmWhite: {} },
      annotationState,
      layoutState,
      occupied,
      registerState,
      roundedBox: () => new THREE.Group(),
      faceHalfWidthAtY: () => 260,
      assertSingleCreation: (key) => assertSingleCreationCalls.push(key),
      selectDigitCount,
    };
    return { ctx, shell, faceLayout, meterConfig, root, annotationState, layoutState, occupied, assertSingleCreationCalls };
  }

  it("calls assertSingleCreation('register') exactly once", () => {
    const { ctx, shell, faceLayout, assertSingleCreationCalls } = makeHarness();
    placeDigitRegister(ctx, shell, faceLayout);
    expect(assertSingleCreationCalls).toEqual(["register"]);
  });

  it("produces a digit count matching selectDigitCount and a wheelReading of the same length", () => {
    const { ctx, shell, faceLayout, meterConfig, annotationState } = makeHarness();
    const box = placeDigitRegister(ctx, shell, faceLayout);
    expect([7, 8]).toContain(meterConfig.digitRegister.selectedDigitCount);
    expect(annotationState.digits).toHaveLength(meterConfig.digitRegister.selectedDigitCount);
    expect(annotationState.wheelReading).toHaveLength(meterConfig.digitRegister.selectedDigitCount);
    expect(box.w).toBeGreaterThan(0);
    expect(box.h).toBeGreaterThan(0);
  });

  it("clamps redDigitCount into [0, digits-1]", () => {
    const overRed = makeHarness({ redDigitCount: 99 });
    placeDigitRegister(overRed.ctx, overRed.shell, overRed.faceLayout);
    const digits = overRed.meterConfig.digitRegister.selectedDigitCount;
    expect(overRed.meterConfig.digitRegister.redDigitCount).toBe(digits - 1);

    const negativeRed = makeHarness({ redDigitCount: -5, seed: "register-seed-2" });
    placeDigitRegister(negativeRed.ctx, negativeRed.shell, negativeRed.faceLayout);
    expect(negativeRed.meterConfig.digitRegister.redDigitCount).toBe(0);
  });

  it("marks exactly the last `redDigitCount` digits as is_decimal", () => {
    const { ctx, shell, faceLayout, meterConfig, annotationState } = makeHarness({ redDigitCount: 2 });
    placeDigitRegister(ctx, shell, faceLayout);
    const digits = meterConfig.digitRegister.selectedDigitCount;
    const redCount = meterConfig.digitRegister.redDigitCount;
    annotationState.digits.forEach((digit, i) => {
      expect(digit.is_decimal).toBe(i >= digits - redCount);
    });
  });

  it("produces a register box that lies inside the shell (insideShell holds)", () => {
    const { ctx, shell, faceLayout } = makeHarness();
    const box = placeDigitRegister(ctx, shell, faceLayout);
    expect(insideShell(box, shell)).toBe(true);
  });

  it("throws when the register band sits entirely outside the face shell", () => {
    // Shrinking the band alone just yields a tiny-but-still-centered (and
    // therefore still valid) register; to actually violate insideShell the
    // band must be relocated outside the shell's radius (rx=ry=280 here).
    const { ctx, shell, faceLayout } = makeHarness({ bandOverrides: { y: 10000, h: 10 } });
    expect(() => placeDigitRegister(ctx, shell, faceLayout)).toThrow(/does not fit/);
  });

  it("pushes a padded register rectangle onto `occupied` and sets layoutState.register", () => {
    const { ctx, shell, faceLayout, occupied, layoutState } = makeHarness();
    const box = placeDigitRegister(ctx, shell, faceLayout);
    expect(occupied).toHaveLength(1);
    expect(occupied[0]).toEqual(padRect(box, 20));
    expect(layoutState.register).toEqual(box);
  });

  it("adds exactly one PlaneGeometry digit texture per digit to root", () => {
    const { ctx, shell, faceLayout, root, meterConfig } = makeHarness();
    placeDigitRegister(ctx, shell, faceLayout);
    const digitPlanes = root.children.filter((child) => child.geometry instanceof THREE.PlaneGeometry);
    expect(digitPlanes).toHaveLength(meterConfig.digitRegister.selectedDigitCount);
  });

  it("produces digit annotations with all required, finite fields", () => {
    const { ctx, shell, faceLayout, annotationState } = makeHarness();
    placeDigitRegister(ctx, shell, faceLayout);
    for (const digit of annotationState.digits) {
      for (const key of ["pos", "gt_float", "value", "cx", "cy", "w", "h", "z"]) {
        expect(digit).toHaveProperty(key);
      }
      expect(typeof digit.is_decimal).toBe("boolean");
      expect(scanForNonFinite(digit)).toEqual([]);
      expect(digit.w).toBeGreaterThan(0);
      expect(digit.h).toBeGreaterThan(0);
    }
  });

  it("is deterministic for the same seed", () => {
    const a = makeHarness({ seed: "determinism-register-seed" });
    placeDigitRegister(a.ctx, a.shell, a.faceLayout);
    const b = makeHarness({ seed: "determinism-register-seed" });
    placeDigitRegister(b.ctx, b.shell, b.faceLayout);
    expect(a.annotationState.digits).toEqual(b.annotationState.digits);
    expect(a.annotationState.wheelReading).toBe(b.annotationState.wheelReading);
  });
});
