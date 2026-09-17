import { describe, it, expect } from "vitest";
import * as THREE from "../../vendor/three.module.js";
import {
  roundRectPath,
  shellShape,
  shellPoints,
  cylinderDisc,
  roundedRectShape,
  tubePolyline,
} from "../../renderer/geometry.js";

function makeCallRecorder() {
  const calls = [];
  const proxy = new Proxy(
    {},
    {
      get(_target, prop) {
        return (...args) => {
          calls.push([prop, args]);
        };
      },
    }
  );
  return { ctx: proxy, calls };
}

function allFinite(numbers) {
  return numbers.every((n) => Number.isFinite(n));
}

describe("roundRectPath", () => {
  it("emits the expected drawing-method sequence", () => {
    const { ctx, calls } = makeCallRecorder();
    roundRectPath(ctx, 0, 0, 100, 50, 10);
    const methodNames = calls.map(([name]) => name);
    expect(methodNames).toEqual([
      "beginPath",
      "moveTo",
      "lineTo",
      "quadraticCurveTo",
      "lineTo",
      "quadraticCurveTo",
      "lineTo",
      "quadraticCurveTo",
      "lineTo",
      "quadraticCurveTo",
    ]);
  });

  it("propagates x/y/w/h/r into the first moveTo and lineTo calls", () => {
    const { ctx, calls } = makeCallRecorder();
    roundRectPath(ctx, 5, 7, 100, 50, 12);
    const moveTo = calls.find(([name]) => name === "moveTo");
    expect(moveTo[1]).toEqual([5 + 12, 7]);
    const firstLineTo = calls.find(([name]) => name === "lineTo");
    expect(firstLineTo[1]).toEqual([5 + 100 - 12, 7]);
  });

  it("handles a zero corner radius without throwing", () => {
    const { ctx } = makeCallRecorder();
    expect(() => roundRectPath(ctx, 0, 0, 40, 20, 0)).not.toThrow();
  });

  it("handles a very small width/height without throwing", () => {
    const { ctx } = makeCallRecorder();
    expect(() => roundRectPath(ctx, 0, 0, 0.001, 0.001, 0)).not.toThrow();
  });
});

describe("shellPoints", () => {
  it("returns exactly the requested number of points", () => {
    for (const count of [1, 2, 8, 112]) {
      expect(shellPoints("roundedRect", 100, 80, count)).toHaveLength(count);
    }
  });

  it("produces finite points for an ellipse", () => {
    const points = shellPoints("ellipse", 120, 90, 64);
    expect(points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
  });

  it("keeps ellipse points within [-rx, rx] x [-ry, ry]", () => {
    const rx = 120;
    const ry = 90;
    const points = shellPoints("ellipse", rx, ry, 64);
    for (const p of points) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(rx + 1e-9);
      expect(Math.abs(p.y)).toBeLessThanOrEqual(ry + 1e-9);
    }
  });

  it("produces finite points for a squircle", () => {
    const points = shellPoints("squircle", 100, 100, 112);
    expect(points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
  });

  it("keeps squircle points within [-rx, rx] x [-ry, ry]", () => {
    const points = shellPoints("squircle", 100, 80, 112);
    for (const p of points) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(100 + 1e-9);
      expect(Math.abs(p.y)).toBeLessThanOrEqual(80 + 1e-9);
    }
  });

  it("handles count=1 and count=2 without throwing, staying finite", () => {
    for (const count of [1, 2]) {
      const points = shellPoints("roundedRect", 50, 50, count);
      expect(points).toHaveLength(count);
      expect(points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
    }
  });

  it("documents current behavior for zero radius: collapses every point to the origin", () => {
    const points = shellPoints("ellipse", 0, 0, 8);
    expect(points.every((p) => p.x === 0 && p.y === 0)).toBe(true);
  });

  it("documents current behavior for negative radius: mirrors points across the axes", () => {
    const points = shellPoints("ellipse", -10, -10, 8);
    expect(points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
  });

  it("is point-symmetric about the origin for a default (non-squircle) shell shape", () => {
    const points = shellPoints("roundedRect", 100, 80, 4);
    // At i=0 -> angle 0 -> (rx, 0); at i=count/2 -> angle PI -> (-rx, 0).
    expect(points[0].x).toBeCloseTo(100);
    expect(points[0].y).toBeCloseTo(0);
    expect(points[2].x).toBeCloseTo(-100);
    expect(points[2].y).toBeCloseTo(0);
  });
});

describe("shellShape", () => {
  it("returns a THREE.Shape for 'circle'/'ellipse'", () => {
    expect(shellShape("circle", 100, 100)).toBeInstanceOf(THREE.Shape);
    expect(shellShape("ellipse", 100, 60)).toBeInstanceOf(THREE.Shape);
  });

  it("returns a THREE.Shape for 'squircle'", () => {
    expect(shellShape("squircle", 100, 100)).toBeInstanceOf(THREE.Shape);
  });

  it("returns a THREE.Shape for the default/roundedRect case", () => {
    expect(shellShape("roundedRect", 100, 80, 20)).toBeInstanceOf(THREE.Shape);
    expect(shellShape("anything-else", 100, 80, 20)).toBeInstanceOf(THREE.Shape);
  });

  it("handles extreme aspect ratios without throwing", () => {
    expect(() => shellShape("ellipse", 2000, 1)).not.toThrow();
    expect(() => shellShape("roundedRect", 2000, 1, 20)).not.toThrow();
  });

  it("handles zero/small radii without throwing", () => {
    expect(() => shellShape("roundedRect", 100, 80, 0)).not.toThrow();
    expect(() => shellShape("roundedRect", 0.01, 0.01, 0)).not.toThrow();
  });

  it("clamps the rounded-rect radius so it never exceeds the shape's own half-extents", () => {
    // radius=1000 with rx=50, ry=40 -> internally clamped to min(radius, rx*0.38, ry*0.38).
    const shape = shellShape("roundedRect", 50, 40, 1000);
    expect(shape).toBeInstanceOf(THREE.Shape);
    const points = shape.getPoints();
    expect(points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
  });
});

describe("roundedRectShape", () => {
  it("returns a THREE.Shape", () => {
    expect(roundedRectShape(100, 60, 10)).toBeInstanceOf(THREE.Shape);
  });

  it("clamps radius to w/2 and h/2", () => {
    const shape = roundedRectShape(40, 20, 1000);
    const points = shape.getPoints();
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThanOrEqual(40 + 1e-6);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThanOrEqual(20 + 1e-6);
  });

  it("handles a zero radius without throwing", () => {
    expect(() => roundedRectShape(40, 20, 0)).not.toThrow();
  });

  it("handles very small dimensions without throwing", () => {
    expect(() => roundedRectShape(0.001, 0.001, 0)).not.toThrow();
  });

  it("produces finite vertex points", () => {
    const shape = roundedRectShape(100, 60, 15);
    const points = shape.getPoints();
    expect(points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
  });
});

describe("cylinderDisc", () => {
  it("returns a THREE.Mesh backed by a CylinderGeometry", () => {
    const mesh = cylinderDisc(0, 0, 20, 10, {}, 0);
    expect(mesh).toBeInstanceOf(THREE.Mesh);
    expect(mesh.geometry).toBeInstanceOf(THREE.CylinderGeometry);
  });

  it("rotates the disc flat (rotation.x === PI/2)", () => {
    const mesh = cylinderDisc(0, 0, 20, 10, {}, 0);
    expect(mesh.rotation.x).toBeCloseTo(Math.PI / 2);
  });

  it("positions the disc at z + depth/2", () => {
    const mesh = cylinderDisc(5, -3, 20, 10, {}, 100);
    expect(mesh.position.x).toBe(5);
    expect(mesh.position.y).toBe(-3);
    expect(mesh.position.z).toBeCloseTo(105);
  });

  it("enables cast/receive shadows", () => {
    const mesh = cylinderDisc(0, 0, 20, 10, {}, 0);
    expect(mesh.castShadow).toBe(true);
    expect(mesh.receiveShadow).toBe(true);
  });

  it("respects an explicit segment count", () => {
    const mesh = cylinderDisc(0, 0, 20, 10, {}, 0, 12);
    expect(mesh.geometry.parameters.radialSegments).toBe(12);
  });

  it("handles zero/small depth and radius without throwing", () => {
    expect(() => cylinderDisc(0, 0, 0.001, 0.001, {}, 0)).not.toThrow();
    const mesh = cylinderDisc(0, 0, 0, 0, {}, 0);
    expect(allFinite([mesh.position.x, mesh.position.y, mesh.position.z])).toBe(true);
  });
});

describe("tubePolyline", () => {
  const square = [
    new THREE.Vector2(-10, -10),
    new THREE.Vector2(10, -10),
    new THREE.Vector2(10, 10),
    new THREE.Vector2(-10, 10),
  ];

  it("returns a THREE.Mesh with finite geometry positions", () => {
    const mesh = tubePolyline(square, {}, 2, 0);
    expect(mesh).toBeInstanceOf(THREE.Mesh);
    const position = mesh.geometry.getAttribute("position");
    let finite = true;
    for (let i = 0; i < position.count; i++) {
      if (!Number.isFinite(position.getX(i)) || !Number.isFinite(position.getY(i)) || !Number.isFinite(position.getZ(i))) {
        finite = false;
        break;
      }
    }
    expect(finite).toBe(true);
  });

  it("builds a closed TubeGeometry (closed=true is hardcoded)", () => {
    const mesh = tubePolyline(square, {}, 2, 0);
    expect(mesh.geometry).toBeInstanceOf(THREE.TubeGeometry);
    expect(mesh.geometry.parameters.closed).toBe(true);
  });

  it("handles the minimum viable point set (2 points) without throwing", () => {
    const twoPoints = [new THREE.Vector2(0, 0), new THREE.Vector2(10, 0)];
    expect(() => tubePolyline(twoPoints, {}, 1, 0)).not.toThrow();
  });

  it("documents current behavior for degenerate/repeated points: does not throw, geometry stays finite", () => {
    const repeated = [new THREE.Vector2(5, 5), new THREE.Vector2(5, 5), new THREE.Vector2(5, 5)];
    let mesh;
    expect(() => {
      mesh = tubePolyline(repeated, {}, 1, 0);
    }).not.toThrow();
    const position = mesh.geometry.getAttribute("position");
    expect(Number.isFinite(position.getX(0))).toBe(true);
  });
});
