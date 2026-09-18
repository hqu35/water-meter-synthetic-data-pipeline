import { describe, it, expect } from "vitest";
import * as THREE from "../../vendor/three.module.js";
import {
  buildAnnotationMeta,
  rectToProjectedCorners,
  cornersToAabb,
  cornersVisible,
  rectToProjectedObb,
  projectToPixel,
  minAreaRectObb,
  normalizeCv2Obb,
} from "../../renderer/annotations.js";

// An orthographic camera facing straight down -z with a +-100 frustum makes
// the world-to-pixel mapping easy to verify by hand: world (x, y) in
// [-100, 100] maps linearly onto a `width` x `height` pixel canvas.
function makeOrthoCamera(width = 200, height = 200) {
  const camera = new THREE.OrthographicCamera(-100, 100, 100, -100, 0.1, 1000);
  camera.position.set(0, 0, 100);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return { camera, width, height };
}

describe("projectToPixel", () => {
  it("maps the world origin to the pixel-space center", () => {
    const ctx = makeOrthoCamera(200, 200);
    const pixel = projectToPixel(new THREE.Vector3(0, 0, 0), ctx);
    expect(pixel.x).toBeCloseTo(100);
    expect(pixel.y).toBeCloseTo(100);
  });

  it("maps +x world to the right and +y world to the top (pixel y is flipped)", () => {
    const ctx = makeOrthoCamera(200, 200);
    const right = projectToPixel(new THREE.Vector3(100, 0, 0), ctx);
    expect(right.x).toBeCloseTo(200);
    const up = projectToPixel(new THREE.Vector3(0, 100, 0), ctx);
    expect(up.y).toBeCloseTo(0);
    const down = projectToPixel(new THREE.Vector3(0, -100, 0), ctx);
    expect(down.y).toBeCloseTo(200);
  });

  it("documents current behavior for a point behind a perspective camera: still returns finite (unclipped) pixel coordinates", () => {
    const camera = new THREE.PerspectiveCamera(50, 1, 1, 1000);
    camera.position.set(0, 0, 100);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    const behind = projectToPixel(new THREE.Vector3(0, 0, 300), { camera, width: 200, height: 200 });
    expect(Number.isFinite(behind.x)).toBe(true);
    expect(Number.isFinite(behind.y)).toBe(true);
  });

  it("stays finite for a point near the camera's near plane", () => {
    const camera = new THREE.PerspectiveCamera(50, 1, 1, 1000);
    camera.position.set(0, 0, 100);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    const nearPoint = projectToPixel(new THREE.Vector3(0, 0, 99.01), { camera, width: 200, height: 200 });
    expect(Number.isFinite(nearPoint.x)).toBe(true);
    expect(Number.isFinite(nearPoint.y)).toBe(true);
  });
});

describe("rectToProjectedCorners / cornersToAabb / cornersVisible", () => {
  it("projects a centered rect to the expected pixel corners", () => {
    const ctx = makeOrthoCamera(200, 200);
    const corners = rectToProjectedCorners({ cx: 0, cy: 0, w: 100, h: 60, z: 0 }, ctx);
    expect(corners).toEqual([
      [50, 130],
      [150, 130],
      [150, 70],
      [50, 70],
    ]);
  });

  it("recovers the original rect dimensions via its AABB", () => {
    const ctx = makeOrthoCamera(200, 200);
    const corners = rectToProjectedCorners({ cx: 0, cy: 0, w: 100, h: 60, z: 0 }, ctx);
    expect(cornersToAabb(corners)).toEqual([50, 70, 100, 60]);
  });

  it("always yields a non-negative AABB width/height", () => {
    const ctx = makeOrthoCamera(200, 200);
    for (const rect of [
      { cx: 30, cy: -20, w: 40, h: 10, z: 0 },
      { cx: -80, cy: 80, w: 5, h: 200, z: 5 },
    ]) {
      const [, , w, h] = cornersToAabb(rectToProjectedCorners(rect, ctx));
      expect(w).toBeGreaterThanOrEqual(0);
      expect(h).toBeGreaterThanOrEqual(0);
    }
  });

  it("reports visible=true when all corners land inside the canvas", () => {
    const ctx = makeOrthoCamera(200, 200);
    const corners = rectToProjectedCorners({ cx: 0, cy: 0, w: 20, h: 20, z: 0 }, ctx);
    expect(cornersVisible(corners, 200, 200)).toBe(true);
  });

  it("reports visible=false once any corner falls outside the canvas", () => {
    const ctx = makeOrthoCamera(200, 200);
    const corners = rectToProjectedCorners({ cx: 90, cy: 0, w: 40, h: 20, z: 0 }, ctx);
    expect(cornersVisible(corners, 200, 200)).toBe(false);
  });
});

describe("rectToProjectedObb / minAreaRectObb / normalizeCv2Obb", () => {
  it("recovers center/width/height/angle for an axis-aligned rect viewed head-on", () => {
    const ctx = makeOrthoCamera(200, 200);
    const [cx, cy, w, h, angle] = rectToProjectedObb({ cx: 0, cy: 0, w: 100, h: 60, z: 0 }, ctx);
    expect(cx).toBeCloseTo(100);
    expect(cy).toBeCloseTo(100);
    expect(w).toBeCloseTo(100);
    expect(h).toBeCloseTo(60);
    expect(angle).toBeCloseTo(0);
  });

  it("produces a finite OBB for a zero-area rect without throwing", () => {
    const ctx = makeOrthoCamera(200, 200);
    expect(() => rectToProjectedObb({ cx: 0, cy: 0, w: 0, h: 0, z: 0 }, ctx)).not.toThrow();
  });

  it("normalizeCv2Obb leaves an angle already in (-PI/2, 0] untouched", () => {
    // Only angle <= 0 is left alone: the normalization also treats any
    // angle > 0 as needing a -PI/2 shift (with a w/h swap), so "in range"
    // for this function specifically means (-PI/2, 0], not (-PI/2, PI/2].
    expect(normalizeCv2Obb(1, 2, 10, 20, -0.4)).toEqual([1, 2, 10, 20, -0.4]);
  });

  it("normalizeCv2Obb wraps an angle > PI/2 back into range, swapping w/h when it ends up positive", () => {
    const [, , w, h, angle] = normalizeCv2Obb(0, 0, 10, 20, 0.3);
    expect(angle).toBeCloseTo(0.3 - Math.PI / 2);
    expect([w, h]).toEqual([20, 10]);
  });

  it("normalizeCv2Obb wraps an angle <= -PI/2 back into range", () => {
    const result = normalizeCv2Obb(0, 0, 10, 20, -2.0);
    const [, , , , angle] = result;
    expect(angle).toBeGreaterThan(-Math.PI / 2);
    expect(angle).toBeLessThanOrEqual(Math.PI / 2);
  });

  it("minAreaRectObb returns a finite result for a simple rotated quad", () => {
    const points = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(10, 2, 0),
      new THREE.Vector3(8, 12, 0),
      new THREE.Vector3(-2, 10, 0),
    ];
    const [cx, cy, w, h, angle] = minAreaRectObb(points);
    expect([cx, cy, w, h, angle].every(Number.isFinite)).toBe(true);
    expect(w).toBeGreaterThan(0);
    expect(h).toBeGreaterThan(0);
  });
});

describe("buildAnnotationMeta", () => {
  it("returns an empty structure when no wheel has been placed yet", () => {
    const camera = makeOrthoCamera().camera;
    const meta = buildAnnotationMeta({
      camera,
      width: 200,
      height: 200,
      annotationState: { wheel: null, digits: [], wheelReading: "" },
    });
    expect(meta).toEqual({ wheel_reading: "", wheel: null, digits: [] });
  });

  it("assembles wheel + digit metadata with matching counts and finite geometry", () => {
    const { camera } = makeOrthoCamera(200, 200);
    const digitCount = 7;
    const digits = Array.from({ length: digitCount }, (_, i) => ({
      pos: i,
      value: i % 10,
      gt_float: i + 0.5,
      is_decimal: i === digitCount - 1,
      cx: -60 + i * 18,
      cy: 0,
      w: 16,
      h: 24,
      z: 10,
    }));
    const annotationState = {
      wheel: { cx: 0, cy: 0, w: 140, h: 30, z: 10 },
      wheelReading: "0123456",
      digits,
    };
    const meta = buildAnnotationMeta({ camera, width: 200, height: 200, annotationState });

    expect(meta.wheel_reading).toBe("0123456");
    expect(meta.wheel_reading.length).toBe(digitCount);
    expect(meta.digits).toHaveLength(digitCount);
    meta.digits.forEach((digit, i) => {
      expect(digit.pos).toBe(i);
      expect(digit.value).toBe(digits[i].value);
      expect(digit.is_decimal).toBe(digits[i].is_decimal);
      expect(Number.isFinite(digit.gt_float)).toBe(true);
      expect(digit.corners).toHaveLength(4);
      expect(digit.bbox).toHaveLength(4);
      expect(digit.obb).toHaveLength(5);
      expect(typeof digit.visible).toBe("boolean");
      expect(digit.corners.flat().every(Number.isFinite)).toBe(true);
      expect(digit.obb.every(Number.isFinite)).toBe(true);
    });
    expect(meta.wheel.corners).toHaveLength(4);
    expect(meta.wheel.bbox).toHaveLength(4);
  });

  it("preserves digit ordering (positions stay ascending as supplied)", () => {
    const { camera } = makeOrthoCamera(200, 200);
    const digits = [2, 0, 1].map((pos) => ({
      pos,
      value: pos,
      gt_float: pos,
      is_decimal: false,
      cx: pos * 10,
      cy: 0,
      w: 5,
      h: 5,
      z: 0,
    }));
    const meta = buildAnnotationMeta({
      camera,
      width: 200,
      height: 200,
      annotationState: { wheel: { cx: 0, cy: 0, w: 30, h: 5, z: 0 }, wheelReading: "201", digits },
    });
    expect(meta.digits.map((d) => d.pos)).toEqual([2, 0, 1]);
  });
});
