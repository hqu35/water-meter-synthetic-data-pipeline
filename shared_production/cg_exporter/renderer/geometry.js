import * as THREE from "../vendor/three.module.js";

export function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
}

export function shellShape(type, rx, ry, radius = 70) {
  if (type === "circle" || type === "ellipse") {
    const shape = new THREE.Shape();
    shape.absellipse(0, 0, rx, ry, 0, Math.PI * 2, false, 0);
    return shape;
  }
  if (type === "squircle") return new THREE.Shape(shellPoints(type, rx, ry, 112));
  return roundedRectShape(rx * 2, ry * 2, Math.min(radius, rx * 0.38, ry * 0.38));
}

export function shellPoints(type, rx, ry, count) {
  const pts = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    if (type === "squircle") {
      const c = Math.cos(a);
      const s = Math.sin(a);
      pts.push(new THREE.Vector2(Math.sign(c) * rx * Math.pow(Math.abs(c), 0.48), Math.sign(s) * ry * Math.pow(Math.abs(s), 0.48)));
    } else {
      pts.push(new THREE.Vector2(Math.cos(a) * rx, Math.sin(a) * ry));
    }
  }
  return pts;
}

export function cylinderDisc(x, y, r, depth, material, z, segments = 72) {
  const obj = new THREE.Mesh(new THREE.CylinderGeometry(r, r, depth, segments), material);
  obj.rotation.x = Math.PI / 2;
  obj.position.set(x, y, z + depth / 2);
  obj.castShadow = true;
  obj.receiveShadow = true;
  return obj;
}

export function roundedRectShape(w, h, r) {
  const shape = new THREE.Shape();
  r = Math.min(r, w / 2, h / 2);
  shape.moveTo(-w / 2 + r, -h / 2);
  shape.lineTo(w / 2 - r, -h / 2);
  shape.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  shape.lineTo(w / 2, h / 2 - r);
  shape.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  shape.lineTo(-w / 2 + r, h / 2);
  shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  shape.lineTo(-w / 2, -h / 2 + r);
  shape.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  return shape;
}

export function tubePolyline(points, material, radius, z) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p.x, p.y, z)), true, "catmullrom", 0.05);
  return new THREE.Mesh(new THREE.TubeGeometry(curve, 220, radius, 10, true), material);
}
