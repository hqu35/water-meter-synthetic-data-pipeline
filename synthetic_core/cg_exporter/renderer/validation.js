import * as THREE from "../vendor/three.module.js";

export function insideShell(rect, s) {
  const pad = 10;
  const pts = [
    [rect.x - pad, rect.y - pad],
    [rect.x + rect.w + pad, rect.y - pad],
    [rect.x - pad, rect.y + rect.h + pad],
    [rect.x + rect.w + pad, rect.y + rect.h + pad],
  ];
  return pts.every(([x, y]) => {
    const rx = (s.inner - 20) * s.scaleX;
    const ry = (s.inner - 20) * s.scaleY;
    if (s.shape === "roundedRect") return Math.abs(x) < rx && Math.abs(y) < ry;
    const nx = x / rx;
    const ny = y / ry;
    return nx * nx + ny * ny < 1;
  });
}

export function insideShellLoose(rect, s) {
  const pts = [
    [rect.x, rect.y],
    [rect.x + rect.w, rect.y],
    [rect.x, rect.y + rect.h],
    [rect.x + rect.w, rect.y + rect.h],
  ];
  return pts.every(([x, y]) => {
    const rx = (s.inner - 16) * s.scaleX;
    const ry = (s.inner - 16) * s.scaleY;
    if (s.shape === "roundedRect") return Math.abs(x) < rx && Math.abs(y) < ry;
    if (s.shape === "squircle") {
      const nx = Math.abs(x / rx);
      const ny = Math.abs(y / ry);
      return Math.pow(nx, 3.2) + Math.pow(ny, 3.2) < 1;
    }
    const nx = x / rx;
    const ny = y / ry;
    return nx * nx + ny * ny < 1;
  });
}

export function validateFinalLayout(ctx) {
  const {
    config: meterConfig,
    layoutState,
    annotationState,
    shell: s,
    digitWindow,
  } = ctx;
  const errors = [];
  const creation = layoutState.creation;
  const digitCount = annotationState.digits.length;
  if (creation.mainFace !== 1) errors.push(`main_face_count=${creation.mainFace}`);
  if (creation.lid > 1) errors.push(`lid_count=${creation.lid}`);
  if (creation.register !== 1) errors.push(`register_count=${creation.register}`);
  if (creation.centerGear !== 1) errors.push(`center_gear_count=${creation.centerGear}`);
  if (creation.brand !== 1) errors.push(`brand_count=${creation.brand}`);
  if (creation.bottomText !== 1) errors.push(`bottom_text_count=${creation.bottomText}`);
  if (digitCount !== 7 && digitCount !== 8) errors.push(`digit_count=${digitCount}`);
  const registerAspect = digitWindow.w / digitWindow.h;
  if (registerAspect < 8 || registerAspect > 13) {
    errors.push(`register_aspect=${registerAspect.toFixed(3)}`);
  }
  const firstDigitBox = annotationState.digits[0];
  annotationState.digits.forEach((digit, index) => {
    if (!(digit.w > 0 && digit.h > 0)) {
      errors.push(`digit_${index}_invalid_size=${digit.w.toFixed(3)}x${digit.h.toFixed(3)}`);
    }
    if (firstDigitBox && (Math.abs(digit.w - firstDigitBox.w) > 1e-6 || Math.abs(digit.h - firstDigitBox.h) > 1e-6)) {
      errors.push(`digit_${index}_cell_size_mismatch`);
    }
  });
  if (!insideShell(digitWindow, s)) errors.push("register_outside_face");
  if (!layoutState.centerGear) {
    errors.push("center_gear_missing");
  } else {
    if (!insideFaceCircle(layoutState.centerGear, s)) errors.push("center_gear_outside_face");
    if (circleIntersectsRect(layoutState.centerGear, digitWindow, 14)) errors.push("center_gear_overlaps_register");
  }
  if (layoutState.dials.length < 1 || layoutState.dials.length > 3) {
    errors.push(`dial_count=${layoutState.dials.length}`);
  }
  for (let i = 0; i < layoutState.dials.length; i++) {
    const dial = layoutState.dials[i];
    const dialCircle = { x: dial.x, y: dial.y, r: dial.r + 5 };
    if (!insideFaceCircle(dialCircle, s)) errors.push(`dial_${i}_outside_face`);
    if (circleIntersectsRect(dialCircle, digitWindow, 14)) errors.push(`dial_${i}_overlaps_register`);
    if (circlesOverlap(dialCircle, layoutState.centerGear, 14)) errors.push(`dial_${i}_overlaps_center_gear`);
    for (let j = i + 1; j < layoutState.dials.length; j++) {
      const other = layoutState.dials[j];
      if (circlesOverlap(dialCircle, { x: other.x, y: other.y, r: other.r + 5 }, 14)) {
        errors.push(`dial_${i}_overlaps_dial_${j}`);
      }
    }
  }
  const brand = layoutState.labels.brand;
  if (!brand || !insideShellLoose(brand, s)) errors.push("brand_outside_face");
  if (brand && intersects(brand, digitWindow, 0)) errors.push("brand_overlaps_register");
  if (brand) {
    const brandGap = brand.y - (digitWindow.y + digitWindow.h);
    if (brandGap < 8 || brandGap > 14.001) errors.push(`brand_register_gap=${brandGap.toFixed(2)}`);
  }
  if (!layoutState.labels.bottomText || !insideShellLoose(layoutState.labels.bottomText, s)) {
    errors.push("bottom_text_outside_face");
  }
  if (layoutState.lid && layoutState.mainFace) {
    const distance = Math.hypot(layoutState.lid.x, layoutState.lid.y);
    const mainRadius = Math.max(layoutState.mainFace.rx, layoutState.mainFace.ry);
    if (distance < mainRadius + layoutState.lid.r + 20) errors.push("lid_overlaps_main_face");
  }
  if (annotationState.digits.some((digit) => !insideShellLoose({
    x: digit.cx - digit.w / 2,
    y: digit.cy - digit.h / 2,
    w: digit.w,
    h: digit.h,
  }, s))) {
    errors.push("digit_box_outside_face");
  }
  if (errors.length) {
    throw new Error(`Invalid ${meterConfig.family}/${meterConfig.layoutPreset} layout: ${errors.join(", ")}`);
  }
  return {
    valid: true,
    family: meterConfig.family,
    layout_preset: meterConfig.layoutPreset,
    digit_count: digitCount,
    dial_count: layoutState.dials.length,
    register: { ...digitWindow },
    center_gear: { ...layoutState.centerGear, box: { ...layoutState.centerGear.box } },
    dials: layoutState.dials.map((dial) => ({ x: dial.x, y: dial.y, r: dial.r, box: { ...dial.box } })),
    semantic_bands: JSON.parse(JSON.stringify(layoutState.faceLayout)),
    creation_counts: { ...layoutState.creation },
    module_count: layoutState.modules.length,
  };
}

export function insideFaceCircle(circle, s) {
  if (!circle) return false;
  const rx = (s.inner - 24) * s.scaleX;
  const ry = (s.inner - 24) * s.scaleY;
  if (s.shape === "roundedRect") {
    return Math.abs(circle.x) + circle.r < rx && Math.abs(circle.y) + circle.r < ry;
  }
  for (let i = 0; i < 16; i++) {
    const angle = i / 16 * Math.PI * 2;
    const x = circle.x + Math.cos(angle) * circle.r;
    const y = circle.y + Math.sin(angle) * circle.r;
    if (s.shape === "squircle") {
      if (Math.pow(Math.abs(x / rx), 3.2) + Math.pow(Math.abs(y / ry), 3.2) >= 1) return false;
    } else if ((x / rx) ** 2 + (y / ry) ** 2 >= 1) {
      return false;
    }
  }
  return true;
}

export function circleIntersectsRect(circle, rect, clearance = 0) {
  const nearestX = THREE.MathUtils.clamp(circle.x, rect.x, rect.x + rect.w);
  const nearestY = THREE.MathUtils.clamp(circle.y, rect.y, rect.y + rect.h);
  return Math.hypot(circle.x - nearestX, circle.y - nearestY) < circle.r + clearance;
}

export function circlesOverlap(a, b, clearance = 0) {
  if (!a || !b) return false;
  return Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r + clearance;
}

export function intersectsAny(rect, others, gap = 0) {
  return others.some((o) => intersects(rect, o, gap));
}

export function intersects(a, b, gap) {
  return !(a.x + a.w + gap < b.x || b.x + b.w + gap < a.x || a.y + a.h + gap < b.y || b.y + b.h + gap < a.y);
}

export function padRect(r, pad) {
  return { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 };
}

export function centeredToRect(b) {
  return { x: b.x - b.w / 2, y: b.y - b.h / 2, w: b.w, h: b.h };
}
