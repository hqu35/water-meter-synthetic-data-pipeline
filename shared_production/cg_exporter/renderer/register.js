import * as THREE from "../vendor/three.module.js";
import { roundRectPath } from "./geometry.js";
import { rand, randInt } from "./random.js";
import { insideShell, padRect } from "./validation.js";

const REGISTER_SCALE = 1.2;
const REGISTER_DIGIT_WEIGHT = "800";
const REGISTER_DIGIT_FAMILY = "Arial Black, Arial, Helvetica, sans-serif";

export function createRegisterState() {
  return {
    glyphStyleCache: new Map(),
    glyphDiagnostics: null,
  };
}

export function placeDigitRegister(ctx, s, faceLayout) {
  const {
    config: meterConfig,
    rng,
    root,
    materials,
    annotationState,
    layoutState,
    occupied,
    registerState,
    roundedBox,
    faceHalfWidthAtY,
    assertSingleCreation,
    selectDigitCount,
  } = ctx;

  assertSingleCreation("register");
  const digits = selectDigitCount(meterConfig, rng);
  const registerCfg = meterConfig.registerLayout;
  // Preserve the original three RNG draws so downstream seeded layout remains unchanged.
  const cellShapeSample = rng();
  const frameShapeSample = rng();
  const heightSample = rng();
  const familyScale = REGISTER_SCALE * Math.sqrt(registerCfg.widthScale * registerCfg.heightScale);
  const targetCellAspect = 0.76 + cellShapeSample * 0.1;
  const designWheelH = (44 + heightSample * 8) * familyScale;
  const designRegisterH = designWheelH + (7 + heightSample * 3) * familyScale;
  const targetRegisterAspect = 8.05 + frameShapeSample * 0.4;
  const designRegisterW = designRegisterH * targetRegisterAspect;
  const band = faceLayout.register;
  const registerCy = band.y + band.h / 2 + rand(-band.h * 0.025, band.h * 0.025);
  const maxH = band.h * 0.82;
  const provisionalH = Math.min(designRegisterH, maxH);
  const availableHalfWidth = Math.min(
    faceHalfWidthAtY(s, registerCy - provisionalH / 2, 42),
    faceHalfWidthAtY(s, registerCy + provisionalH / 2, 42)
  ) - 22;
  const maxW = Math.max(1, availableHalfWidth * 2);
  const fitScale = Math.min(1, maxH / designRegisterH, maxW / designRegisterW);
  const w = designRegisterW * fitScale;
  const h = designRegisterH * fitScale;
  const box = { x: -w / 2, y: registerCy - h / 2, w, h };
  if (!insideShell(box, s)) {
    throw new Error(`Register band does not fit ${meterConfig.family}/${meterConfig.layoutPreset}`);
  }
  occupied.push(padRect(box, 20));
  layoutState.register = { ...box };

  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const frameGap = 4 * fitScale;
  const apertureLip = 2 * fitScale;
  const digitInset = 3 * fitScale;
  const apertureW = box.w - 2 * (frameGap + apertureLip);
  const apertureH = box.h - 2 * (frameGap + apertureLip);
  const slotGap = 1.8 * fitScale;
  const slotW = (apertureW - slotGap * (digits - 1)) / digits;
  const wheelH = apertureH;
  const wheelW = Math.min(slotW - 4 * fitScale, wheelH * targetCellAspect);
  const digitPlaneW = slotW - digitInset;
  const digitPlaneH = wheelH - digitInset;
  root.add(roundedBox(box.w, box.h, 16, 9 * fitScale, materials.dark, cx, cy, 46));
  root.add(roundedBox(box.w - 2 * frameGap, box.h - 2 * frameGap, 8, 6 * fitScale, materials.black, cx, cy, 55));
  root.add(roundedBox(apertureW, apertureH, 4, 3 * fitScale, materials.gray, cx, cy, 58));

  const number = Array.from({ length: digits }, () => randInt(0, 9));
  const redDigitCount = Math.min(digits - 1, Math.max(0, registerCfg.redDigitCount));
  meterConfig.digitRegister.redDigitCount = redDigitCount;
  const startX = cx - ((digits - 1) * (slotW + slotGap)) / 2;
  annotationState.wheelReading = "";
  annotationState.digits = [];
  annotationState.wheel = { cx, cy, w: apertureW, h: apertureH, z: 70 };
  for (let i = 0; i < digits; i++) {
    const wheelCenterX = startX + i * (slotW + slotGap);
    const wheelCenterY = cy;
    const red = redDigitCount > 0 && i >= digits - redDigitCount;
    const wheel = roundedBox(slotW, wheelH, 9, 2.5 * fitScale, red ? materials.red : materials.warmWhite, wheelCenterX, wheelCenterY, 63);
    root.add(wheel);
    const currentDigit = number[i];
    const isRollingWheel = i === digits - 1 || rng() > 0.62;
    const rollProgress = isRollingWheel ? rand(0.55, 0.86) : 0;
    const theta = rollProgress * Math.PI * 2;
    const wheelTexture = makeRollingDigitTexture(registerState, currentDigit, theta, red, slotW, wheelH, wheelW);
    const digitPlane = texturePlane(wheelTexture, digitPlaneW, digitPlaneH, wheelCenterX, wheelCenterY, 70);
    digitPlane.renderOrder = 50 + i;
    root.add(digitPlane);
    if (i > 0) root.add(roundedBox(1.8 * fitScale, wheelH, 2, fitScale, materials.gray, wheelCenterX - (slotW + slotGap) / 2, wheelCenterY, 66));
    const gtFloat = currentDigit + rollProgress;
    annotationState.wheelReading += String(Math.floor(gtFloat) % 10);
    annotationState.digits.push({
      pos: i,
      gt_float: Number(gtFloat.toFixed(6)),
      value: currentDigit,
      is_decimal: red,
      cx: wheelCenterX,
      cy: wheelCenterY,
      w: digitPlaneW,
      h: digitPlaneH,
      z: 70,
    });
  }
  return box;
}

export function makeRollingDigitTexture(registerState, currentDigit, theta, red, wheelWidth, wheelHeight, glyphBoxWidth = wheelWidth) {
  const viewW = 512;
  const viewH = Math.max(280, Math.round(viewW * (wheelHeight / wheelWidth)));
  const glyphBoxW = viewW * Math.min(1, glyphBoxWidth / wheelWidth);
  const stripH = viewH * 10;
  const rollProgress = ((theta % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / (Math.PI * 2);
  const strip = document.createElement("canvas");
  strip.width = viewW;
  strip.height = stripH;
  const stripCtx = strip.getContext("2d");
  const aperture = document.createElement("canvas");
  aperture.width = viewW;
  aperture.height = viewH;
  const apertureCtx = aperture.getContext("2d");
  const curved = document.createElement("canvas");
  curved.width = viewW;
  curved.height = viewH;
  const ctx = curved.getContext("2d");
  const bg = red ? "#c3292f" : "#f7f6ed";
  const fg = red ? "#fff9f3" : "#111820";
  const separator = red ? "rgba(86,0,0,0.28)" : "rgba(0,0,0,0.13)";
  const glyphStyles = createRegisterGlyphStyles(registerState, stripCtx, glyphBoxW, viewH);

  stripCtx.fillStyle = bg;
  stripCtx.fillRect(0, 0, viewW, stripH);
  for (let digit = 0; digit < 10; digit++) {
    const cellY = digit * viewH;
    stripCtx.fillStyle = bg;
    stripCtx.fillRect(0, cellY, viewW, viewH);
    stripCtx.fillStyle = fg;
    drawDigitGlyphInCell(stripCtx, String(digit), 0, cellY, viewW, viewH, fg, glyphStyles);
    if (digit > 0) {
      stripCtx.fillStyle = separator;
      stripCtx.fillRect(viewW * 0.04, cellY - 1.5, viewW * 0.92, 3);
    }
  }
  addWheelSurfaceGrain(stripCtx, viewW, stripH, red);

  apertureCtx.fillStyle = bg;
  apertureCtx.fillRect(0, 0, viewW, viewH);
  apertureCtx.save();
  roundRectPath(apertureCtx, 8, 8, viewW - 16, viewH - 16, 18);
  apertureCtx.clip();
  const sourceY = (currentDigit + rollProgress) * viewH;
  drawWrappedStrip(apertureCtx, strip, sourceY, viewW, viewH, stripH);
  apertureCtx.restore();

  ctx.clearRect(0, 0, viewW, viewH);
  ctx.save();
  roundRectPath(ctx, 7, 7, viewW - 14, viewH - 14, 20);
  ctx.clip();
  for (let y = 0; y < viewH; y++) {
    const v = (y - viewH / 2) / (viewH / 2);
    const curve = v * v;
    const scaleX = 1 - 0.1 * curve;
    const alpha = 1 - 0.22 * curve;
    const lineW = viewW * scaleX;
    const dx = (viewW - lineW) / 2;
    ctx.globalAlpha = alpha;
    ctx.drawImage(aperture, 0, y, viewW, 1, dx, y, lineW, 1);
  }
  ctx.restore();
  ctx.globalAlpha = 1;

  const sideShade = ctx.createLinearGradient(0, 0, viewW, 0);
  sideShade.addColorStop(0, "rgba(0,0,0,0.5)");
  sideShade.addColorStop(0.16, "rgba(0,0,0,0.1)");
  sideShade.addColorStop(0.5, "rgba(255,255,255,0.23)");
  sideShade.addColorStop(0.84, "rgba(0,0,0,0.1)");
  sideShade.addColorStop(1, "rgba(0,0,0,0.48)");
  ctx.fillStyle = sideShade;
  roundRectPath(ctx, 7, 7, viewW - 14, viewH - 14, 20);
  ctx.fill();

  const topBottomShade = ctx.createLinearGradient(0, 0, 0, viewH);
  topBottomShade.addColorStop(0, "rgba(0,0,0,0.55)");
  topBottomShade.addColorStop(0.15, "rgba(0,0,0,0.1)");
  topBottomShade.addColorStop(0.5, "rgba(255,255,255,0.04)");
  topBottomShade.addColorStop(0.85, "rgba(0,0,0,0.12)");
  topBottomShade.addColorStop(1, "rgba(0,0,0,0.58)");
  ctx.fillStyle = topBottomShade;
  roundRectPath(ctx, 7, 7, viewW - 14, viewH - 14, 20);
  ctx.fill();

  ctx.strokeStyle = red ? "rgba(92,0,0,0.65)" : "rgba(0,0,0,0.32)";
  ctx.lineWidth = 8;
  roundRectPath(ctx, 8, 8, viewW - 16, viewH - 16, 19);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(curved);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function drawWrappedStrip(ctx, strip, sourceY, viewW, viewH, stripH) {
  let srcY = ((sourceY % stripH) + stripH) % stripH;
  let dstY = 0;
  let remaining = viewH;
  while (remaining > 0) {
    const chunk = Math.min(remaining, stripH - srcY);
    ctx.drawImage(strip, 0, srcY, viewW, chunk, 0, dstY, viewW, chunk);
    remaining -= chunk;
    dstY += chunk;
    srcY = 0;
  }
}

function createRegisterGlyphStyles(registerState, ctx, cellW, cellH) {
  const cacheKey = `${cellW.toFixed(4)}:${cellH.toFixed(4)}`;
  if (registerState.glyphStyleCache.has(cacheKey)) return registerState.glyphStyleCache.get(cacheKey);

  const glyphs = "0123456789";
  const rasterScale = 2;
  const targetMinX = cellW * 0.1;
  const targetMaxX = cellW * 0.92;
  const targetMinY = cellH * 0.1;
  const targetMaxY = cellH * 0.9;
  const targetVisibleWidth = targetMaxX - targetMinX;
  const targetVisibleHeight = targetMaxY - targetMinY;
  const scratchSize = Math.ceil(Math.max(cellW, cellH) * rasterScale * 1.6);
  const rasterFontSize = cellH * rasterScale * 1.2;
  const font = `${REGISTER_DIGIT_WEIGHT} ${rasterFontSize}px ${REGISTER_DIGIT_FAMILY}`;
  const styles = {};
  const diagnosticDigits = [];
  void ctx;

  Array.from(glyphs).forEach((glyph) => {
    const scratch = document.createElement("canvas");
    scratch.width = scratchSize;
    scratch.height = scratchSize;
    const scratchCtx = scratch.getContext("2d", { willReadFrequently: true });
    scratchCtx.clearRect(0, 0, scratchSize, scratchSize);
    scratchCtx.fillStyle = "#ffffff";
    scratchCtx.font = font;
    scratchCtx.textAlign = "center";
    scratchCtx.textBaseline = "middle";
    scratchCtx.fillText(glyph, scratchSize / 2, scratchSize / 2);

    const pixels = scratchCtx.getImageData(0, 0, scratchSize, scratchSize).data;
    let xMin = scratchSize;
    let xMax = -1;
    let yMin = scratchSize;
    let yMax = -1;
    for (let y = 0; y < scratchSize; y++) {
      for (let x = 0; x < scratchSize; x++) {
        if (pixels[(y * scratchSize + x) * 4 + 3] === 0) continue;
        xMin = Math.min(xMin, x);
        xMax = Math.max(xMax, x);
        yMin = Math.min(yMin, y);
        yMax = Math.max(yMax, y);
      }
    }
    if (xMax < xMin || yMax < yMin) {
      throw new Error(`Register glyph rasterization produced no visible pixels for ${glyph}`);
    }

    const rawWidth = xMax - xMin + 1;
    const rawHeight = yMax - yMin + 1;
    const mask = document.createElement("canvas");
    mask.width = rawWidth;
    mask.height = rawHeight;
    mask.getContext("2d").drawImage(
      scratch,
      xMin,
      yMin,
      rawWidth,
      rawHeight,
      0,
      0,
      rawWidth,
      rawHeight
    );
    const style = {
      mask,
      tintedMasks: new Map(),
      rasterBounds: { xMin, xMax, yMin, yMax },
      scaleX: targetVisibleWidth / rawWidth,
      scaleY: targetVisibleHeight / rawHeight,
    };
    styles[glyph] = style;
    diagnosticDigits.push({
      glyph,
      rasterBounds: { xMin, xMax, yMin, yMax },
      rawVisibleWidth: rawWidth,
      rawVisibleHeight: rawHeight,
      scaleX: style.scaleX,
      scaleY: style.scaleY,
      finalVisibleWidth: targetVisibleWidth,
      finalVisibleHeight: targetVisibleHeight,
      targetBounds: { xMin: targetMinX, xMax: targetMaxX, yMin: targetMinY, yMax: targetMaxY },
    });
  });

  const widthValues = diagnosticDigits.map((item) => item.finalVisibleWidth);
  const heightValues = diagnosticDigits.map((item) => item.finalVisibleHeight);
  const variation = (values) => {
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    return (Math.max(...values) - Math.min(...values)) / Math.max(1, mean);
  };
  const widthVariation = variation(widthValues);
  const heightVariation = variation(heightValues);
  if (widthVariation > 0.03 || heightVariation > 0.03) {
    throw new Error(
      `Register glyph normalization failed: width=${widthVariation.toFixed(4)}, height=${heightVariation.toFixed(4)}`
    );
  }

  const result = {
    font,
    styles,
    glyphBoxWidth: cellW,
    cellHeight: cellH,
    targetMinX,
    targetMaxX,
    targetMinY,
    targetMaxY,
    targetVisibleWidth,
    targetVisibleHeight,
    diagnostics: {
      font,
      fontFamily: REGISTER_DIGIT_FAMILY,
      fontWeight: REGISTER_DIGIT_WEIGHT,
      rasterScale,
      glyphBoxWidth: cellW,
      cellHeight: cellH,
      targetBounds: { xMin: targetMinX, xMax: targetMaxX, yMin: targetMinY, yMax: targetMaxY },
      targetVisibleWidth,
      targetVisibleHeight,
      widthVariation,
      heightVariation,
      digits: diagnosticDigits,
    },
  };
  registerState.glyphStyleCache.set(cacheKey, result);
  registerState.glyphDiagnostics = result.diagnostics;
  return result;
}

function drawDigitGlyphInCell(ctx, glyph, cellX, cellY, cellW, cellH, fillStyle, glyphStyles) {
  const style = glyphStyles.styles[glyph];
  let tintedMask = style.tintedMasks.get(fillStyle);
  if (!tintedMask) {
    tintedMask = document.createElement("canvas");
    tintedMask.width = style.mask.width;
    tintedMask.height = style.mask.height;
    const tintCtx = tintedMask.getContext("2d");
    tintCtx.drawImage(style.mask, 0, 0);
    tintCtx.globalCompositeOperation = "source-in";
    tintCtx.fillStyle = fillStyle;
    tintCtx.fillRect(0, 0, tintedMask.width, tintedMask.height);
    style.tintedMasks.set(fillStyle, tintedMask);
  }

  const glyphBoxX = cellX + (cellW - glyphStyles.glyphBoxWidth) / 2;
  const targetX = glyphBoxX + glyphStyles.targetMinX;
  const targetY = cellY + glyphStyles.targetMinY;
  ctx.save();
  ctx.beginPath();
  ctx.rect(cellX, cellY, cellW, cellH);
  ctx.clip();
  ctx.drawImage(
    tintedMask,
    0,
    0,
    tintedMask.width,
    tintedMask.height,
    targetX,
    targetY,
    glyphStyles.targetVisibleWidth,
    glyphStyles.targetVisibleHeight
  );
  ctx.restore();
}

export function createRegisterGlyphDiagnosticCanvas(registerState) {
  const canvas = document.createElement("canvas");
  canvas.width = 1120;
  canvas.height = 650;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#252b30";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const sampleDigits = Array.from("0123456789");
  const cellW = 84;
  const cellH = 96;
  const glyphBoxW = 70;
  const rowX = 205;

  const label = (text, x, y) => {
    ctx.fillStyle = "#f3f5f6";
    ctx.font = "600 17px Arial, Helvetica, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x, y);
  };
  const drawWheel = (x, y, digit, red, rollProgress = 0, width = cellW, height = cellH) => {
    const texture = makeRollingDigitTexture(
      registerState,
      Number(digit),
      rollProgress * Math.PI * 2,
      red,
      width,
      height,
      width * (glyphBoxW / cellW)
    );
    ctx.drawImage(texture.image, x, y, width, height);
    texture.dispose();
  };

  label("BLACK / IVORY", 30, 84);
  sampleDigits.forEach((digit, index) => drawWheel(rowX + index * cellW, 36, digit, false));

  label("WHITE / RED", 30, 194);
  sampleDigits.forEach((digit, index) => drawWheel(rowX + index * cellW, 146, digit, true));

  label("ROLLING", 30, 320);
  label("4 -> 5", 205, 278);
  drawWheel(205, 300, "4", false, 0.58, 110, 112);
  label("8 -> 9", 420, 278);
  drawWheel(420, 300, "8", true, 0.46, 110, 112);

  const drawRegister = (digits, x, y) => {
    ctx.fillStyle = "#11161a";
    ctx.fillRect(x - 6, y - 6, digits.length * 76 + 12, 88);
    digits.forEach((digit, index) => drawWheel(x + index * 76, y, digit, index >= digits.length - 2, 0, 76, 76));
  };

  label("7-DIGIT REGISTER", 30, 475);
  drawRegister(["0", "1", "2", "4", "5", "7", "8"], 255, 438);
  label("8-DIGIT REGISTER", 30, 584);
  drawRegister(["0", "1", "2", "4", "5", "7", "8", "9"], 255, 547);

  return canvas;
}

function addWheelSurfaceGrain(ctx, width, height, red) {
  ctx.save();
  ctx.globalAlpha = red ? 0.13 : 0.1;
  for (let i = 0; i < 80; i++) {
    ctx.strokeStyle = i % 3 === 0 ? "#ffffff" : "#000000";
    ctx.lineWidth = rand(0.35, 1.1);
    const x = rand(12, width - 12);
    ctx.beginPath();
    ctx.moveTo(x, rand(8, height - 8));
    ctx.lineTo(x + rand(-3, 3), rand(8, height - 8));
    ctx.stroke();
  }
  ctx.globalAlpha = red ? 0.1 : 0.08;
  for (let i = 0; i < 120; i++) {
    ctx.fillStyle = i % 2 ? "#ffffff" : "#000000";
    ctx.fillRect(rand(10, width - 10), rand(10, height - 10), rand(0.6, 2.2), rand(0.6, 2.2));
  }
  ctx.restore();
}

function texturePlane(texture, width, height, x, y, z) {
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, depthTest: false });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  plane.position.set(x, y, z);
  return plane;
}
