import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createMeterIdentity,
  makeShell,
  createFaceLayout,
  faceHalfWidthAtY,
  assertSingleCreation,
} from "../../renderer/meter.js";
import { DESIGN_FAMILIES } from "../../renderer/config.js";
import { hashString, mulberry32, setRng } from "../../renderer/random.js";
import { installFakeDom } from "./helpers/fakeDom.js";
import { buildMeterScene } from "./helpers/buildMeterScene.js";

let uninstallFakeDom;
beforeEach(() => {
  uninstallFakeDom = installFakeDom();
});
afterEach(() => {
  uninstallFakeDom();
});

function seeded(seed, fn) {
  setRng(mulberry32(hashString(seed)));
  return fn();
}

describe("createMeterIdentity", () => {
  it("returns a brand name from the known BRANDS list and a plausible serial", () => {
    const identity = seeded("identity-seed", createMeterIdentity);
    expect([
      "elster", "HYDROMAX", "AQUOR", "METRON", "SENSUS", "KENSUI", "ZENNER",
    ]).toContain(identity.brandName);
    expect(typeof identity.serial).toBe("string");
    expect(identity.serial.length).toBeGreaterThan(0);
  });
});

describe("makeShell", () => {
  it("keeps scaleX/scaleY finite and inner < outer for every face shape", () => {
    for (const faceShape of ["roundedSquare", "circle", "oval"]) {
      const meterCtx = {
        config: { shape: { faceShape, width: 1, height: 1, ovalAspectRatio: 1.2 } },
        rng: mulberry32(hashString(`shell-${faceShape}`)),
      };
      setRng(meterCtx.rng);
      const shell = makeShell(meterCtx);
      expect(Number.isFinite(shell.scaleX)).toBe(true);
      expect(Number.isFinite(shell.scaleY)).toBe(true);
      expect(shell.inner).toBeLessThan(shell.outer);
    }
  });

  it("forces scaleX=scaleY=1 for a circular shell", () => {
    const meterCtx = { config: { shape: { faceShape: "circle", width: 1, height: 1 } }, rng: mulberry32(1) };
    setRng(meterCtx.rng);
    const shell = makeShell(meterCtx);
    expect(shell.shape).toBe("circle");
    expect(shell.scaleX).toBe(1);
    expect(shell.scaleY).toBe(1);
  });
});

describe("createFaceLayout", () => {
  it("produces positive half-extents and positive-height bands", () => {
    const shell = { inner: 300, scaleX: 1, scaleY: 1 };
    const layout = createFaceLayout(shell);
    expect(layout.halfWidth).toBeGreaterThan(0);
    expect(layout.halfHeight).toBeGreaterThan(0);
    for (const band of ["brand", "register", "gear", "dial", "bottomText"]) {
      expect(layout[band].w).toBeGreaterThan(0);
      expect(layout[band].h).toBeGreaterThan(0);
    }
  });
});

describe("faceHalfWidthAtY", () => {
  it("returns a constant width for box-like shell shapes regardless of y", () => {
    const shell = { inner: 300, scaleX: 1, scaleY: 1, shape: "roundedRect" };
    expect(faceHalfWidthAtY(shell, 0)).toBeCloseTo(faceHalfWidthAtY(shell, 100));
  });

  it("shrinks toward the poles for elliptical shell shapes, staying finite", () => {
    const shell = { inner: 300, scaleX: 1, scaleY: 1, shape: "circle" };
    const atCenter = faceHalfWidthAtY(shell, 0);
    const nearPole = faceHalfWidthAtY(shell, 279);
    expect(nearPole).toBeLessThan(atCenter);
    expect(Number.isFinite(nearPole)).toBe(true);
  });

  it("never produces NaN even when y is pushed far past the shell radius", () => {
    const shell = { inner: 300, scaleX: 1, scaleY: 1, shape: "circle" };
    expect(Number.isFinite(faceHalfWidthAtY(shell, 100000))).toBe(true);
  });
});

describe("assertSingleCreation", () => {
  it("allows exactly one creation per key and throws on a second", () => {
    const meterCtx = { layoutState: { creation: { register: 0 } } };
    expect(() => assertSingleCreation(meterCtx, "register")).not.toThrow();
    expect(() => assertSingleCreation(meterCtx, "register")).toThrow(/Duplicate semantic component: register/);
  });
});

// --- Phase 5: full scene-construction contracts -----------------------------

function collectNonFiniteTransforms(root) {
  const problems = [];
  root.traverse((obj) => {
    const values = [
      ["position.x", obj.position.x], ["position.y", obj.position.y], ["position.z", obj.position.z],
      ["rotation.x", obj.rotation.x], ["rotation.y", obj.rotation.y], ["rotation.z", obj.rotation.z],
      ["scale.x", obj.scale.x], ["scale.y", obj.scale.y], ["scale.z", obj.scale.z],
    ];
    for (const [label, value] of values) {
      if (!Number.isFinite(value)) problems.push(`${obj.type || "object"}.${label} = ${value}`);
    }
  });
  return problems;
}

describe("full scene construction (one seed per family)", () => {
  for (const family of DESIGN_FAMILIES) {
    it(`constructs a valid, finite scene for family "${family}"`, () => {
      const scene = buildMeterScene({ seed: `scene-${family}`, family });
      expect(scene.validation.valid).toBe(true);
      expect(collectNonFiniteTransforms(scene.root)).toEqual([]);
      expect(scene.layoutState.creation.mainFace).toBe(1);
      expect(scene.layoutState.creation.register).toBe(1);
      expect(scene.layoutState.creation.centerGear).toBe(1);
      expect(scene.layoutState.creation.brand).toBe(1);
      expect(scene.layoutState.creation.bottomText).toBe(1);
      expect(scene.layoutState.creation.lid).toBeLessThanOrEqual(1);
      expect([7, 8]).toContain(scene.annotationState.digits.length);
      expect(scene.root.children.length).toBeGreaterThan(0);
    });
  }
});

describe("full scene construction (extra randomized seeds per family)", () => {
  for (const family of DESIGN_FAMILIES) {
    for (const suffix of ["alt-1", "alt-2"]) {
      it(`does not throw and stays finite for family "${family}" seed "${suffix}"`, () => {
        const scene = buildMeterScene({ seed: `${family}-${suffix}`, family });
        expect(scene.validation.valid).toBe(true);
        expect(collectNonFiniteTransforms(scene.root)).toEqual([]);
      });
    }
  }
});

describe("full scene construction (extreme but valid configuration fixtures)", () => {
  it("handles a forced 7-digit register", () => {
    const scene = buildMeterScene({ seed: "extreme-7-digit", family: "industrial_window", digitOverride: 7 });
    expect(scene.annotationState.digits).toHaveLength(7);
    expect(scene.validation.valid).toBe(true);
  });

  it("handles a forced 8-digit register", () => {
    const scene = buildMeterScene({ seed: "extreme-8-digit", family: "protective_shell", digitOverride: 8 });
    expect(scene.annotationState.digits).toHaveLength(8);
    expect(scene.validation.valid).toBe(true);
  });

  it("handles the classic_round family across several seeds without ever producing a duplicate semantic component", () => {
    for (let i = 0; i < 5; i++) {
      expect(() => buildMeterScene({ seed: `classic-stress-${i}`, family: "classic_round" })).not.toThrow();
    }
  });
});
