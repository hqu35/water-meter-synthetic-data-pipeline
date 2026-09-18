import { describe, it, expect } from "vitest";
import {
  insideShell,
  insideShellLoose,
  insideFaceCircle,
  circleIntersectsRect,
  circlesOverlap,
  intersects,
  intersectsAny,
  padRect,
  centeredToRect,
  validateFinalLayout,
} from "../../renderer/validation.js";

const ROUNDED_RECT_SHELL = { shape: "roundedRect", inner: 300, scaleX: 1, scaleY: 1 };

describe("insideShell", () => {
  it("returns true for a box clearly inside the shell", () => {
    expect(insideShell({ x: -50, y: -50, w: 100, h: 100 }, ROUNDED_RECT_SHELL)).toBe(true);
  });

  it("returns false when a padded corner sits exactly on the boundary (strict inequality)", () => {
    // rx = (300 - 20) * 1 = 280; pad = 10, so choose w such that a corner
    // lands exactly at x = 280.
    const rect = { x: -290, y: -50, w: 580, h: 0 }; // padded corners at x=+-300... adjust below
    // Build a rect whose padded right edge is exactly rx (280).
    const exact = { x: 0, y: 0, w: 270, h: 0 }; // padded corner x = 0 + 270 + 10 = 280
    expect(insideShell(exact, ROUNDED_RECT_SHELL)).toBe(false);
    void rect;
  });

  it("returns false for a box slightly outside the shell", () => {
    const rect = { x: 0, y: 0, w: 275, h: 0 }; // padded corner x = 285 > 280
    expect(insideShell(rect, ROUNDED_RECT_SHELL)).toBe(false);
  });

  it("returns false for a box completely outside the shell", () => {
    expect(insideShell({ x: 1000, y: 1000, w: 50, h: 50 }, ROUNDED_RECT_SHELL)).toBe(false);
  });

  it("returns true for a zero-size box at the center", () => {
    expect(insideShell({ x: 0, y: 0, w: 0, h: 0 }, ROUNDED_RECT_SHELL)).toBe(true);
  });

  it("does not throw for negative dimensions and returns a boolean", () => {
    const result = insideShell({ x: 0, y: 0, w: -40, h: -40 }, ROUNDED_RECT_SHELL);
    expect(typeof result).toBe("boolean");
  });

  it("uses the elliptical formula for non-roundedRect shell shapes", () => {
    const circleShell = { shape: "circle", inner: 300, scaleX: 1, scaleY: 1 };
    // rx=ry=280; a box whose corners sit inside the unit circle after
    // normalization should be inside, one that sits on the axis just
    // outside should not.
    expect(insideShell({ x: -50, y: -50, w: 100, h: 100 }, circleShell)).toBe(true);
    expect(insideShell({ x: 1000, y: 0, w: 0, h: 0 }, circleShell)).toBe(false);
  });
});

describe("insideShellLoose", () => {
  it("uses a smaller margin (16) than insideShell (20), so it is more permissive", () => {
    // rx for insideShell = 280, rx for insideShellLoose = 284.
    const rect = { x: 0, y: 0, w: 283, h: 0 };
    expect(insideShellLoose(rect, ROUNDED_RECT_SHELL)).toBe(true);
    expect(insideShell(rect, ROUNDED_RECT_SHELL)).toBe(false);
  });

  it("applies the superellipse formula for squircle shells", () => {
    const squircleShell = { shape: "squircle", inner: 300, scaleX: 1, scaleY: 1 };
    expect(insideShellLoose({ x: -10, y: -10, w: 20, h: 20 }, squircleShell)).toBe(true);
    expect(insideShellLoose({ x: 1000, y: 0, w: 0, h: 0 }, squircleShell)).toBe(false);
  });
});

describe("insideFaceCircle", () => {
  it("returns false for a null/undefined circle", () => {
    expect(insideFaceCircle(null, ROUNDED_RECT_SHELL)).toBe(false);
  });

  it("returns true for a circle clearly within the face", () => {
    expect(insideFaceCircle({ x: 0, y: 0, r: 40 }, ROUNDED_RECT_SHELL)).toBe(true);
  });

  it("returns false once the circle extends past the face boundary", () => {
    // rx = (300-24) = 276 for insideFaceCircle's margin.
    expect(insideFaceCircle({ x: 270, y: 0, r: 40 }, ROUNDED_RECT_SHELL)).toBe(false);
  });

  it("samples 16 angles for non-box shell shapes and stays finite", () => {
    const circleShell = { shape: "circle", inner: 300, scaleX: 1, scaleY: 1 };
    expect(insideFaceCircle({ x: 0, y: 0, r: 40 }, circleShell)).toBe(true);
    expect(insideFaceCircle({ x: 260, y: 0, r: 40 }, circleShell)).toBe(false);
  });
});

describe("circleIntersectsRect", () => {
  it("returns false when the circle is far from the rect", () => {
    expect(circleIntersectsRect({ x: 0, y: 0, r: 10 }, { x: 100, y: 100, w: 20, h: 20 })).toBe(false);
  });

  it("returns true when the circle overlaps the rect", () => {
    expect(circleIntersectsRect({ x: 5, y: 5, r: 10 }, { x: 0, y: 0, w: 20, h: 20 })).toBe(true);
  });

  it("honors an explicit clearance distance", () => {
    const circle = { x: 0, y: 0, r: 5 };
    const rect = { x: 20, y: -5, w: 10, h: 10 };
    expect(circleIntersectsRect(circle, rect, 0)).toBe(false);
    expect(circleIntersectsRect(circle, rect, 20)).toBe(true);
  });
});

describe("circlesOverlap", () => {
  it("returns false when either circle is missing", () => {
    expect(circlesOverlap(null, { x: 0, y: 0, r: 1 })).toBe(false);
    expect(circlesOverlap({ x: 0, y: 0, r: 1 }, undefined)).toBe(false);
  });

  it("returns true when circles overlap and false when they do not", () => {
    expect(circlesOverlap({ x: 0, y: 0, r: 10 }, { x: 15, y: 0, r: 10 })).toBe(true);
    expect(circlesOverlap({ x: 0, y: 0, r: 10 }, { x: 100, y: 0, r: 10 })).toBe(false);
  });

  it("honors an explicit clearance distance", () => {
    expect(circlesOverlap({ x: 0, y: 0, r: 10 }, { x: 25, y: 0, r: 10 }, 0)).toBe(false);
    expect(circlesOverlap({ x: 0, y: 0, r: 10 }, { x: 25, y: 0, r: 10 }, 10)).toBe(true);
  });
});

describe("intersects", () => {
  it("returns false for rects with a clear gap", () => {
    expect(intersects({ x: 0, y: 0, w: 10, h: 10 }, { x: 100, y: 100, w: 10, h: 10 }, 0)).toBe(false);
  });

  it("returns true for a partial overlap", () => {
    expect(intersects({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 }, 0)).toBe(true);
  });

  it("returns true for full containment", () => {
    expect(intersects({ x: 0, y: 0, w: 100, h: 100 }, { x: 40, y: 40, w: 5, h: 5 }, 0)).toBe(true);
  });

  it("treats exact edge-touching as intersecting (inclusive boundary)", () => {
    expect(intersects({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 }, 0)).toBe(true);
  });

  it("treats exact corner-touching as intersecting (inclusive boundary)", () => {
    expect(intersects({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 10, w: 10, h: 10 }, 0)).toBe(true);
  });

  it("returns true for identical rectangles", () => {
    const rect = { x: 0, y: 0, w: 10, h: 10 };
    expect(intersects(rect, { ...rect }, 0)).toBe(true);
  });

  it("treats coincident zero-area rectangles as intersecting, and separated ones as not", () => {
    expect(intersects({ x: 5, y: 5, w: 0, h: 0 }, { x: 5, y: 5, w: 0, h: 0 }, 0)).toBe(true);
    expect(intersects({ x: 5, y: 5, w: 0, h: 0 }, { x: 50, y: 50, w: 0, h: 0 }, 0)).toBe(false);
  });

  it("a positive gap pushes separated-but-close rects into 'intersecting'", () => {
    expect(intersects({ x: 0, y: 0, w: 10, h: 10 }, { x: 15, y: 0, w: 10, h: 10 }, 0)).toBe(false);
    expect(intersects({ x: 0, y: 0, w: 10, h: 10 }, { x: 15, y: 0, w: 10, h: 10 }, 10)).toBe(true);
  });
});

describe("intersectsAny", () => {
  it("returns false against an empty list", () => {
    expect(intersectsAny({ x: 0, y: 0, w: 10, h: 10 }, [], 0)).toBe(false);
  });

  it("returns true if any rect in the list intersects", () => {
    const rect = { x: 0, y: 0, w: 10, h: 10 };
    const others = [{ x: 100, y: 100, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 }];
    expect(intersectsAny(rect, others, 0)).toBe(true);
  });
});

describe("padRect", () => {
  it("grows the rect by pad on every side while preserving the center", () => {
    const rect = { x: 0, y: 0, w: 100, h: 50 };
    const padded = padRect(rect, 10);
    expect(padded).toEqual({ x: -10, y: -10, w: 120, h: 70 });
    const centerBefore = { cx: rect.x + rect.w / 2, cy: rect.y + rect.h / 2 };
    const centerAfter = { cx: padded.x + padded.w / 2, cy: padded.y + padded.h / 2 };
    expect(centerAfter).toEqual(centerBefore);
  });

  it("is a no-op for pad=0", () => {
    const rect = { x: 3, y: 4, w: 5, h: 6 };
    expect(padRect(rect, 0)).toEqual(rect);
  });

  it("shrinks the rect for negative pad, still preserving the center", () => {
    const rect = { x: 0, y: 0, w: 100, h: 50 };
    const padded = padRect(rect, -10);
    expect(padded).toEqual({ x: 10, y: 10, w: 80, h: 30 });
  });
});

describe("centeredToRect", () => {
  it("converts a center-based box into a top-left rect", () => {
    expect(centeredToRect({ x: 10, y: 20, w: 40, h: 30 })).toEqual({ x: -10, y: 5, w: 40, h: 30 });
  });
});

// --- validateFinalLayout: adversarial fixture-based coverage ---------------

function buildValidFixture() {
  const shell = { shape: "roundedRect", inner: 300, scaleX: 1, scaleY: 1, outer: 340 };
  const digitWindow = { x: -250, y: 150, w: 500, h: 50 };
  const digits = Array.from({ length: 8 }, (_, i) => ({
    pos: i,
    gt_float: i,
    value: i,
    is_decimal: false,
    cx: -250 + 62.5 * (i + 0.5),
    cy: 175,
    w: 50,
    h: 40,
    z: 70,
  }));
  const layoutState = {
    creation: { mainFace: 1, lid: 0, register: 1, centerGear: 1, brand: 1, bottomText: 1 },
    centerGear: { x: 0, y: -100, r: 40, box: { x: -40, y: -140, w: 80, h: 80 } },
    dials: [
      { x: 150, y: -100, r: 30, box: { x: 100, y: -140, w: 100, h: 100 } },
      { x: -150, y: -100, r: 30, box: { x: -200, y: -140, w: 100, h: 100 } },
    ],
    labels: {
      brand: { x: -60, y: 210, w: 120, h: 30 },
      bottomText: { x: -80, y: -250, w: 160, h: 24 },
    },
    lid: null,
    mainFace: null,
    modules: [],
    faceLayout: { note: "fixture" },
  };
  const annotationState = { digits };
  const config = { family: "test_family", layoutPreset: "test_preset" };
  return { config, layoutState, annotationState, shell, digitWindow };
}

describe("validateFinalLayout", () => {
  it("accepts a known-valid layout and returns a validation summary", () => {
    const fixture = buildValidFixture();
    const result = validateFinalLayout(fixture);
    expect(result.valid).toBe(true);
    expect(result.digit_count).toBe(8);
    expect(result.dial_count).toBe(2);
  });

  it("rejects a register that no longer fits the (shrunk) face", () => {
    const fixture = buildValidFixture();
    fixture.shell.inner = 100;
    expect(() => validateFinalLayout(fixture)).toThrow(/register_outside_face/);
  });

  it("rejects a center gear that overlaps the register", () => {
    const fixture = buildValidFixture();
    fixture.layoutState.centerGear = { x: 0, y: 175, r: 40, box: { x: -40, y: 135, w: 80, h: 80 } };
    expect(() => validateFinalLayout(fixture)).toThrow(/center_gear_overlaps_register/);
  });

  it("rejects a missing center gear", () => {
    const fixture = buildValidFixture();
    fixture.layoutState.centerGear = null;
    expect(() => validateFinalLayout(fixture)).toThrow(/center_gear_missing/);
  });

  it("rejects digits with a non-positive width/height", () => {
    const fixture = buildValidFixture();
    fixture.annotationState.digits[0].w = 0;
    expect(() => validateFinalLayout(fixture)).toThrow(/digit_0_invalid_size/);
  });

  it("rejects digit cells whose size differs from the first digit's cell size", () => {
    const fixture = buildValidFixture();
    fixture.annotationState.digits[3].w = 999;
    expect(() => validateFinalLayout(fixture)).toThrow(/digit_3_cell_size_mismatch/);
  });

  it("rejects a digit count outside {7, 8}", () => {
    const fixture = buildValidFixture();
    fixture.annotationState.digits = fixture.annotationState.digits.slice(0, 6);
    expect(() => validateFinalLayout(fixture)).toThrow(/digit_count=6/);
  });

  it("rejects a dial count outside [1, 3]", () => {
    const fixture = buildValidFixture();
    fixture.layoutState.dials = [];
    expect(() => validateFinalLayout(fixture)).toThrow(/dial_count=0/);
  });

  it("rejects two overlapping dials", () => {
    const fixture = buildValidFixture();
    fixture.layoutState.dials[1] = { ...fixture.layoutState.dials[0] };
    expect(() => validateFinalLayout(fixture)).toThrow(/dial_0_overlaps_dial_1/);
  });

  it("rejects a wrong mainFace creation count", () => {
    const fixture = buildValidFixture();
    fixture.layoutState.creation.mainFace = 0;
    expect(() => validateFinalLayout(fixture)).toThrow(/main_face_count=0/);
  });

  it("rejects a brand-to-register gap outside [8, 14.001]", () => {
    const fixture = buildValidFixture();
    fixture.layoutState.labels.brand.y = 400; // gap becomes 400-200=200, way over 14.001
    expect(() => validateFinalLayout(fixture)).toThrow(/brand_register_gap/);
  });

  it("rejects a missing bottomText label", () => {
    const fixture = buildValidFixture();
    fixture.layoutState.labels.bottomText = null;
    expect(() => validateFinalLayout(fixture)).toThrow(/bottom_text_outside_face/);
  });

  it("documents current behavior for a NaN digit coordinate: not explicitly detected, surfaces indirectly as a geometry failure", () => {
    const fixture = buildValidFixture();
    fixture.annotationState.digits[0].cx = NaN;
    // insideShellLoose compares `Math.abs(x) < rx`, which is false for NaN,
    // so the corrupted digit is reported as being outside the face rather
    // than triggering a dedicated "NaN" error.
    expect(() => validateFinalLayout(fixture)).toThrow(/digit_box_outside_face/);
  });

  it("aggregates multiple simultaneous violations into one error message", () => {
    const fixture = buildValidFixture();
    fixture.layoutState.creation.mainFace = 0;
    fixture.layoutState.dials = [];
    try {
      validateFinalLayout(fixture);
      throw new Error("expected validateFinalLayout to throw");
    } catch (error) {
      expect(error.message).toMatch(/main_face_count=0/);
      expect(error.message).toMatch(/dial_count=0/);
    }
  });
});
