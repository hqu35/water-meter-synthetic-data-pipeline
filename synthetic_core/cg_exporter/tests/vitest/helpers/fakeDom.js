// Minimal fake `document`/Canvas2D used to unit-test renderer modules that
// call `document.createElement("canvas")` for texture generation
// (register.js, meter.js, lighting.js). Real font rasterization is not
// available in plain Node, so `getImageData` returns a canned, deterministic
// "glyph" box (a centered filled rectangle) instead of actually rasterizing
// text. This is enough to exercise the surrounding contract/math (cache
// behavior, bounds math, finite outputs) without claiming pixel-accurate
// text rendering, which stays a browser-only concern.

function parseFontSize(font) {
  const match = /(\d+(?:\.\d+)?)px/.exec(font || "");
  return match ? Number(match[1]) : 16;
}

function makeGradient() {
  return {
    stops: [],
    addColorStop(offset, color) {
      this.stops.push([offset, color]);
    },
  };
}

function makeContext2d(canvas) {
  const ctx = {
    canvas,
    fillStyle: "#000000",
    strokeStyle: "#000000",
    lineWidth: 1,
    font: "10px sans-serif",
    textAlign: "start",
    textBaseline: "alphabetic",
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    calls: [],
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    quadraticCurveTo() {},
    bezierCurveTo() {},
    absarc() {},
    rect() {},
    clip() {},
    save() {},
    restore() {},
    fill() {},
    stroke() {},
    translate() {},
    rotate() {},
    scale() {},
    setTransform() {},
    fillRect(...args) {
      ctx.calls.push(["fillRect", args]);
    },
    clearRect(...args) {
      ctx.calls.push(["clearRect", args]);
    },
    fillText(text) {
      ctx.calls.push(["fillText", text]);
    },
    strokeText(text) {
      ctx.calls.push(["strokeText", text]);
    },
    measureText(text) {
      const size = parseFontSize(ctx.font);
      return { width: String(text).length * size * 0.6 };
    },
    drawImage(...args) {
      ctx.calls.push(["drawImage", args]);
    },
    createLinearGradient() {
      return makeGradient();
    },
    createRadialGradient() {
      return makeGradient();
    },
    getImageData(x, y, w, h) {
      const data = new Uint8ClampedArray(w * h * 4);
      // Paint a deterministic centered box (40%-60% of each axis) fully
      // opaque so every glyph resolves to an identical, finite bounding box.
      const xMin = Math.floor(w * 0.4);
      const xMax = Math.ceil(w * 0.6);
      const yMin = Math.floor(h * 0.4);
      const yMax = Math.ceil(h * 0.6);
      for (let py = yMin; py < yMax; py++) {
        for (let px = xMin; px < xMax; px++) {
          const i = (py * w + px) * 4;
          data[i] = 255;
          data[i + 1] = 255;
          data[i + 2] = 255;
          data[i + 3] = 255;
        }
      }
      return { data, width: w, height: h };
    },
    putImageData() {},
  };
  return ctx;
}

function makeCanvas() {
  const canvas = {
    width: 0,
    height: 0,
    getContext(type) {
      if (type !== "2d") return null;
      if (!canvas.__ctx) canvas.__ctx = makeContext2d(canvas);
      return canvas.__ctx;
    },
  };
  return canvas;
}

export function installFakeDom() {
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement(tag) {
      if (tag === "canvas") return makeCanvas();
      throw new Error(`fakeDom: unsupported element "${tag}"`);
    },
  };
  return function uninstallFakeDom() {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  };
}

export { makeCanvas, makeContext2d };
