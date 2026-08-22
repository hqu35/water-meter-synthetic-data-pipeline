import * as THREE from "../vendor/three.module.js";

export function buildAnnotationMeta({ camera, width, height, annotationState }) {
  if (!annotationState.wheel) {
    return { wheel_reading: "", wheel: null, digits: [] };
  }
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  const projectionContext = { camera, width, height };
  const wheelCorners = rectToProjectedCorners(annotationState.wheel, projectionContext);
  return {
    wheel_reading: annotationState.wheelReading,
    wheel: {
      obb: rectToProjectedObb(annotationState.wheel, projectionContext),
      corners: wheelCorners,
      bbox: cornersToAabb(wheelCorners),
      visible: cornersVisible(wheelCorners, width, height),
    },
    digits: annotationState.digits.map((digit) => {
      const corners = rectToProjectedCorners(digit, projectionContext);
      return {
        pos: digit.pos,
        value: digit.value,
        gt_float: digit.gt_float,
        is_decimal: digit.is_decimal,
        obb: rectToProjectedObb(digit, projectionContext),
        corners,
        bbox: cornersToAabb(corners),
        visible: cornersVisible(corners, width, height),
      };
    }),
  };
}

export function rectToProjectedCorners(rect, projectionContext) {
  const z = rect.z || 0;
  return [
    new THREE.Vector3(rect.cx - rect.w / 2, rect.cy - rect.h / 2, z),
    new THREE.Vector3(rect.cx + rect.w / 2, rect.cy - rect.h / 2, z),
    new THREE.Vector3(rect.cx + rect.w / 2, rect.cy + rect.h / 2, z),
    new THREE.Vector3(rect.cx - rect.w / 2, rect.cy + rect.h / 2, z),
  ].map((point) => {
    const pixel = projectToPixel(point, projectionContext);
    return [Number(pixel.x.toFixed(4)), Number(pixel.y.toFixed(4))];
  });
}

export function cornersToAabb(corners) {
  const xs = corners.map(([x]) => x);
  const ys = corners.map(([, y]) => y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return [
    Number(minX.toFixed(4)),
    Number(minY.toFixed(4)),
    Number((Math.max(...xs) - minX).toFixed(4)),
    Number((Math.max(...ys) - minY).toFixed(4)),
  ];
}

export function cornersVisible(corners, width, height) {
  return corners.every(([x, y]) => x >= 0 && x <= width && y >= 0 && y <= height);
}

export function rectToProjectedObb(rect, projectionContext) {
  const z = rect.z || 0;
  const corners = [
    new THREE.Vector3(rect.cx - rect.w / 2, rect.cy - rect.h / 2, z),
    new THREE.Vector3(rect.cx + rect.w / 2, rect.cy - rect.h / 2, z),
    new THREE.Vector3(rect.cx + rect.w / 2, rect.cy + rect.h / 2, z),
    new THREE.Vector3(rect.cx - rect.w / 2, rect.cy + rect.h / 2, z),
  ].map((point) => projectToPixel(point, projectionContext));
  return minAreaRectObb(corners).map((value) => Number(value.toFixed(4)));
}

export function projectToPixel(point, { camera, width, height }) {
  const projected = point.clone().project(camera);
  return {
    x: (projected.x * 0.5 + 0.5) * width,
    y: (-projected.y * 0.5 + 0.5) * height,
  };
}

export function minAreaRectObb(points) {
  let best = null;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const rotated = points.map((p) => ({
      x: p.x * cos + p.y * sin,
      y: -p.x * sin + p.y * cos,
    }));
    const minX = Math.min(...rotated.map((p) => p.x));
    const maxX = Math.max(...rotated.map((p) => p.x));
    const minY = Math.min(...rotated.map((p) => p.y));
    const maxY = Math.max(...rotated.map((p) => p.y));
    const w = maxX - minX;
    const h = maxY - minY;
    const area = w * h;
    if (!best || area < best.area) {
      const rcx = (minX + maxX) / 2;
      const rcy = (minY + maxY) / 2;
      best = {
        area,
        cx: rcx * cos - rcy * sin,
        cy: rcx * sin + rcy * cos,
        w,
        h,
        angle,
      };
    }
  }
  return normalizeCv2Obb(best.cx, best.cy, best.w, best.h, best.angle);
}

export function normalizeCv2Obb(cx, cy, w, h, angle) {
  while (angle <= -Math.PI / 2) angle += Math.PI;
  while (angle > Math.PI / 2) angle -= Math.PI;
  if (angle > 0) {
    angle -= Math.PI / 2;
    [w, h] = [h, w];
  }
  if (angle <= -Math.PI / 2) {
    angle += Math.PI / 2;
    [w, h] = [h, w];
  }
  return [cx, cy, w, h, angle];
}
