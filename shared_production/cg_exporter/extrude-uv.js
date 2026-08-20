import * as THREE from "./vendor/three.module.js";

export function uvAttributeRange(attribute) {
  const range = { minU: Infinity, maxU: -Infinity, minV: Infinity, maxV: -Infinity };
  for (let i = 0; i < attribute.count; i++) {
    const u = attribute.getX(i);
    const v = attribute.getY(i);
    range.minU = Math.min(range.minU, u);
    range.maxU = Math.max(range.maxU, u);
    range.minV = Math.min(range.minV, v);
    range.maxV = Math.max(range.maxV, v);
  }
  return range;
}

export function normalizeExtrudeGeometryUVs(inputGeometry, role = "metalPbr", statsSink = null) {
  const convertedToNonIndexed = Boolean(inputGeometry.index);
  const geometry = convertedToNonIndexed ? inputGeometry.toNonIndexed() : inputGeometry;
  geometry.computeBoundingBox();

  const position = geometry.getAttribute("position");
  const oldUv = geometry.getAttribute("uv");
  const before = oldUv ? uvAttributeRange(oldUv) : null;
  const min = geometry.boundingBox.min;
  const max = geometry.boundingBox.max;
  const sizeX = Math.max(max.x - min.x, Number.EPSILON);
  const sizeY = Math.max(max.y - min.y, Number.EPSILON);
  const sizeZ = Math.max(max.z - min.z, Number.EPSILON);
  const uv = new Float32Array(position.count * 2);

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const edgeAB = new THREE.Vector3();
  const edgeAC = new THREE.Vector3();
  const faceNormal = new THREE.Vector3();

  for (let i = 0; i < position.count; i += 3) {
    a.fromBufferAttribute(position, i);
    b.fromBufferAttribute(position, i + 1);
    c.fromBufferAttribute(position, i + 2);
    edgeAB.subVectors(b, a);
    edgeAC.subVectors(c, a);
    faceNormal.crossVectors(edgeAB, edgeAC).normalize();

    const absX = Math.abs(faceNormal.x);
    const absY = Math.abs(faceNormal.y);
    const absZ = Math.abs(faceNormal.z);
    for (let vertexOffset = 0; vertexOffset < 3; vertexOffset++) {
      const vertexIndex = i + vertexOffset;
      const x = position.getX(vertexIndex);
      const y = position.getY(vertexIndex);
      const z = position.getZ(vertexIndex);
      let u;
      let v;

      if (absZ >= absX && absZ >= absY) {
        // Front/back caps use normalized planar XY mapping.
        u = (x - min.x) / sizeX;
        v = (y - min.y) / sizeY;
      } else if (absX >= absY) {
        // Mostly left/right-facing side triangles use normalized YZ.
        u = (y - min.y) / sizeY;
        v = (z - min.z) / sizeZ;
      } else {
        // Mostly top/bottom-facing side triangles use normalized XZ.
        u = (x - min.x) / sizeX;
        v = (z - min.z) / sizeZ;
      }

      uv[vertexIndex * 2] = THREE.MathUtils.clamp(u, 0, 1);
      uv[vertexIndex * 2 + 1] = THREE.MathUtils.clamp(v, 0, 1);
    }
  }

  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  const stats = {
    role,
    before,
    after: uvAttributeRange(geometry.getAttribute("uv")),
    convertedToNonIndexed,
  };
  geometry.userData.pbrUvNormalization = stats;
  if (statsSink) statsSink.push(stats);
  return geometry;
}
