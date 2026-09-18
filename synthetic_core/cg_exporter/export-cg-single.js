const path = require("path");
const http = require("http");
const fs = require("fs");
const zlib = require("zlib");
const { chromium } = require("playwright");

const root = __dirname;
const projectRoot = path.resolve(root, "..");
const width = Number(process.env.WIDTH || 512);
const height = Number(process.env.HEIGHT || 512);
const seed = process.env.SEED || "meter_0000";
const family = process.env.FAMILY || "";
const textureMode = process.env.TEXTURE_MODE || "random";
const textureKey = process.env.TEXTURE_KEY || "";
const faceColor = process.env.FACE_COLOR || "";
const pbrRepeat = process.env.PBR_REPEAT || "";
const pbrRoughnessMap = process.env.PBR_ROUGHNESS_MAP || "";
const pbrMetalnessMap = process.env.PBR_METALNESS_MAP || "";
const pbrRoughness = process.env.PBR_ROUGHNESS || "";
const pbrMetalness = process.env.PBR_METALNESS || "";
const pbrNormalScale = process.env.PBR_NORMAL_SCALE || "";
const normalizePbrExtrudeUVs = process.env.NORMALIZE_PBR_EXTRUDE_UVS || "";
const environmentMode = process.env.ENVIRONMENT_MODE || "random";
const environmentKey = process.env.ENVIRONMENT_KEY || "";
const environmentIntensity = process.env.ENVIRONMENT_INTENSITY || "";
const environmentRotation = process.env.ENVIRONMENT_ROTATION || "";
const lightingWithEnvironment = process.env.LIGHTING_WITH_ENVIRONMENT || "";
const transparent = process.env.TRANSPARENT || "";
const digits = process.env.DIGITS || "";
const preserveAlpha = transparent !== "0";
const imageOutput = path.resolve(process.env.IMAGE_OUTPUT || path.join(__dirname, "../output/images/meter_0000.png"));
const imagePathParts = path.parse(imageOutput);
const maskOutput = path.resolve(process.env.MASK_OUTPUT || path.join(imagePathParts.dir, `${imagePathParts.name}_mask.png`));
const metadataOutput = path.resolve(process.env.METADATA_OUTPUT || path.join(__dirname, "../output/metadata/meter_0000.json"));
const port = Number(process.env.PORT || 5601);
const cdpEndpoint = process.env.CDP_ENDPOINT || "http://127.0.0.1:9222";
const debugDir = path.resolve(process.env.DEBUG_DIR || path.join(__dirname, "../output/debug"));
const fullPageDebug = path.join(debugDir, "full_page_debug.png");
const canvasElementDebug = path.join(debugDir, "canvas_element_debug.png");
const validatedBufferDebug = path.join(debugDir, "validated_buffer_debug.png");
const maskDebug = path.join(debugDir, "validated_mask_debug.png");

fs.mkdirSync(path.dirname(imageOutput), { recursive: true });
fs.mkdirSync(path.dirname(maskOutput), { recursive: true });
fs.mkdirSync(path.dirname(metadataOutput), { recursive: true });
fs.mkdirSync(debugDir, { recursive: true });

const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".png": "image/png",
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  const requestPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const staticRoot = requestPath.startsWith("/assets/") || requestPath.startsWith("/HDRI/") ? projectRoot : root;
  const filePath = path.normalize(path.join(staticRoot, requestPath));
  if (filePath !== staticRoot && !filePath.startsWith(`${staticRoot}${path.sep}`)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "content-type": mime[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  });
});

function pngStats(buffer) {
  const signature = buffer.subarray(0, 8).toString("hex");
  if (signature !== "89504e470d0a1a0a") throw new Error("Not a PNG buffer");
  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  while (pos < buffer.length) {
    const length = buffer.readUInt32BE(pos);
    pos += 4;
    const type = buffer.subarray(pos, pos + 4).toString("ascii");
    pos += 4;
    const chunk = buffer.subarray(pos, pos + length);
    pos += length + 4;
    if (type === "IHDR") {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      bitDepth = chunk[8];
      colorType = chunk[9];
    }
    if (type === "IDAT") idat.push(chunk);
    if (type === "IEND") break;
  }
  if (bitDepth !== 8) throw new Error(`Unsupported PNG bit depth ${bitDepth}`);
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : null;
  if (!channels) throw new Error(`Unsupported PNG color type ${colorType}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  let offset = 0;
  let prev = Buffer.alloc(stride);
  const mins = [255, 255, 255];
  const maxs = [0, 0, 0];
  const sums = [0, 0, 0];
  let whitePixels = 0;
  let blackPixels = 0;
  let pixels = 0;
  let visiblePixels = 0;
  let transparentPixels = 0;
  let nonOpaquePixels = 0;
  let unexpectedColoredPixels = 0;
  let exactWhitePixels = 0;
  let exactBlackPixels = 0;
  let backgroundPixel = null;
  let centerPixel = null;

  function paeth(a, b, c) {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    if (pb <= pc) return b;
    return c;
  }

  for (let y = 0; y < height; y++) {
    const filter = raw[offset++];
    const scan = raw.subarray(offset, offset + stride);
    offset += stride;
    const recon = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? recon[x - channels] : 0;
      const up = prev[x];
      const upLeft = x >= channels ? prev[x - channels] : 0;
      let value = scan[x];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += Math.floor((left + up) / 2);
      else if (filter === 4) value += paeth(left, up, upLeft);
      else if (filter !== 0) throw new Error(`Unsupported PNG filter ${filter}`);
      recon[x] = value & 255;
    }
    for (let x = 0; x < stride; x += channels) {
      const alpha = channels === 4 ? recon[x + 3] : 255;
      const rgb = channels === 1 ? [recon[x], recon[x], recon[x]] : [recon[x], recon[x + 1], recon[x + 2]];
      const rgba = [...rgb, alpha];
      const pixelX = x / channels;
      if (y === 0 && pixelX === 0) backgroundPixel = rgba;
      if (y === Math.floor(height / 2) && pixelX === Math.floor(width / 2)) centerPixel = rgba;
      pixels++;
      if (alpha !== 255) nonOpaquePixels++;
      if (rgb[0] !== rgb[1] || rgb[1] !== rgb[2]) unexpectedColoredPixels++;
      if (rgb.every((value) => value === 255) && alpha === 255) exactWhitePixels++;
      if (rgb.every((value) => value === 0) && alpha === 255) exactBlackPixels++;
      if (alpha <= 8) {
        transparentPixels++;
        continue;
      }
      for (let c = 0; c < 3; c++) {
        mins[c] = Math.min(mins[c], rgb[c]);
        maxs[c] = Math.max(maxs[c], rgb[c]);
        sums[c] += rgb[c];
      }
      if (rgb.every((v) => v >= 248)) whitePixels++;
      if (rgb.every((v) => v <= 7)) blackPixels++;
      visiblePixels++;
    }
    prev = recon;
  }
  if (visiblePixels === 0) {
    return {
      width,
      height,
      pixels,
      visiblePixels,
      transparentRatio: transparentPixels / pixels,
      fileSize: buffer.length,
      meanRgb: [0, 0, 0],
      extrema: [[0, 0], [0, 0], [0, 0]],
      whiteRatio: 0,
      blackRatio: 1,
      nonWhiteRatio: 0,
      nonBlackRatio: 0,
      nonOpaquePixels,
      unexpectedColoredPixels,
      exactWhitePixels,
      exactBlackPixels,
      backgroundPixel,
      centerPixel,
    };
  }
  return {
    width,
    height,
    pixels,
    visiblePixels,
    transparentRatio: transparentPixels / pixels,
    fileSize: buffer.length,
    meanRgb: sums.map((sum) => sum / visiblePixels),
    extrema: mins.map((min, i) => [min, maxs[i]]),
    whiteRatio: whitePixels / visiblePixels,
    blackRatio: blackPixels / visiblePixels,
    nonWhiteRatio: 1 - whitePixels / visiblePixels,
    nonBlackRatio: 1 - blackPixels / visiblePixels,
    nonOpaquePixels,
    unexpectedColoredPixels,
    exactWhitePixels,
    exactBlackPixels,
    backgroundPixel,
    centerPixel,
  };
}

function assertNotBlank(stats, label) {
  if (stats.whiteRatio > 0.99) {
    throw new Error(`${label} is blank/near-white: ${JSON.stringify(stats)}`);
  }
  if (stats.blackRatio > 0.99) {
    throw new Error(`${label} is blank/near-black: ${JSON.stringify(stats)}`);
  }
  const channelRanges = stats.extrema.map(([min, max]) => max - min);
  if (channelRanges.every((range) => range < 8)) {
    throw new Error(`${label} has almost no pixel variation: ${JSON.stringify(stats)}`);
  }
}

function validateSavedOutput(label) {
  const buffer = fs.readFileSync(imageOutput);
  const stats = pngStats(buffer);
  console.log(`[export-cg-single] ${label} saved-file stats ${JSON.stringify(stats)}`);
  assertNotBlank(stats, label);
  fs.writeFileSync(validatedBufferDebug, buffer);
  return stats;
}

function validateSavedMask(normalStats, label) {
  const expectedMaskName = `${path.parse(imageOutput).name}_mask.png`;
  if (path.basename(maskOutput) !== expectedMaskName) {
    throw new Error(`Mask filename mismatch: expected ${expectedMaskName}, got ${path.basename(maskOutput)}`);
  }

  const buffer = fs.readFileSync(maskOutput);
  const stats = pngStats(buffer);
  console.log(`[export-cg-single] ${label} saved-file stats ${JSON.stringify(stats)}`);
  if (stats.width !== normalStats.width || stats.height !== normalStats.height) {
    throw new Error(`Mask dimensions ${stats.width}x${stats.height} do not match normal image ${normalStats.width}x${normalStats.height}`);
  }
  if (!stats.backgroundPixel || !stats.backgroundPixel.every((value) => value === 255)) {
    throw new Error(`Mask background pixel is not opaque white: ${JSON.stringify(stats.backgroundPixel)}`);
  }
  if (!stats.centerPixel || stats.centerPixel[0] !== 0 || stats.centerPixel[1] !== 0 || stats.centerPixel[2] !== 0 || stats.centerPixel[3] !== 255) {
    throw new Error(`Mask center pixel is not opaque black: ${JSON.stringify(stats.centerPixel)}`);
  }
  if (stats.nonOpaquePixels !== 0 || stats.transparentRatio !== 0) {
    throw new Error(`Mask contains non-opaque pixels: ${JSON.stringify(stats)}`);
  }
  if (stats.unexpectedColoredPixels !== 0) {
    throw new Error(`Mask contains colored pixels instead of grayscale mask values: ${JSON.stringify(stats)}`);
  }
  if (stats.exactWhitePixels === 0 || stats.exactBlackPixels === 0) {
    throw new Error(`Mask must contain both pure white and pure black pixels: ${JSON.stringify(stats)}`);
  }
  fs.writeFileSync(maskDebug, buffer);
  return stats;
}

async function preparePage(context, target, logs) {
  const page = await context.newPage();
  await page.setViewportSize({ width, height });
  page.on("console", (message) => logs.push(`${message.type()}: ${message.text()}`));
  page.on("pageerror", (error) => logs.push(`pageerror: ${error.message}`));
  console.log(`[export-cg-single] opening ${target}`);
  await page.goto(target, { waitUntil: "networkidle", timeout: 45000 });
  console.log(`[export-cg-single] opened ${page.url()}`);
  try {
    await page.waitForSelector("canvas", { state: "attached", timeout: 45000 });
  } catch (error) {
    console.error(`[export-cg-single] canvas was not created; browser logs=${JSON.stringify(logs)}`);
    throw error;
  }
  try {
    await page.waitForFunction(() => window.__waterMeterReady === true, null, { timeout: 45000 });
  } catch (error) {
    console.error(`[export-cg-single] page did not become ready; browser logs=${JSON.stringify(logs)}`);
    throw error;
  }
  await page.waitForTimeout(250);

  const canvas = await page.$("canvas");
  const canvasInfo = await page.evaluate(() => {
    const canvases = Array.from(document.querySelectorAll("canvas"));
    return {
      canvasCount: canvases.length,
      sizes: canvases.map((canvas) => ({
        width: canvas.width,
        height: canvas.height,
        clientWidth: canvas.clientWidth,
        clientHeight: canvas.clientHeight,
      })),
    };
  });
  console.log(`[export-cg-single] canvas count ${canvasInfo.canvasCount}`);
  console.log(`[export-cg-single] canvas sizes ${JSON.stringify(canvasInfo.sizes)}`);
  await page.screenshot({ path: fullPageDebug, fullPage: true, omitBackground: preserveAlpha });
  return { page, canvas, canvasInfo };
}

async function tryCanvasElementScreenshot(canvas, label) {
  console.log(`[export-cg-single] trying ${label}`);
  await canvas.screenshot({ path: imageOutput, omitBackground: preserveAlpha });
  fs.copyFileSync(imageOutput, canvasElementDebug);
  return validateSavedOutput(label);
}

async function tryFullPageCanvasCrop(page, canvas, label) {
  console.log(`[export-cg-single] trying ${label}`);
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas bounding box unavailable");
  console.log(`[export-cg-single] ${label} crop ${JSON.stringify(box)}`);
  await page.screenshot({
    path: imageOutput,
    clip: {
      x: Math.max(0, box.x),
      y: Math.max(0, box.y),
      width: Math.max(1, box.width),
      height: Math.max(1, box.height),
    },
    omitBackground: preserveAlpha,
  });
  return validateSavedOutput(label);
}

async function exportBinaryMask(page, canvas, normalStats) {
  await page.evaluate(() => window.__renderWaterMeterMask());
  await page.waitForFunction(() => window.__waterMeterMaskReady === true, null, { timeout: 10000 });

  const maskErrors = [];
  try {
    const methods = [
      async () => {
        const label = "cdp:mask-canvas-element-screenshot";
        console.log(`[export-cg-single] trying ${label}`);
        await canvas.screenshot({ path: maskOutput, omitBackground: false });
        return validateSavedMask(normalStats, label);
      },
      async () => {
        const label = "cdp:mask-full-page-canvas-crop";
        console.log(`[export-cg-single] trying ${label}`);
        const box = await canvas.boundingBox();
        if (!box) throw new Error("Canvas bounding box unavailable for mask export");
        await page.screenshot({
          path: maskOutput,
          clip: {
            x: Math.max(0, box.x),
            y: Math.max(0, box.y),
            width: Math.max(1, box.width),
            height: Math.max(1, box.height),
          },
          omitBackground: false,
        });
        return validateSavedMask(normalStats, label);
      },
    ];

    for (const method of methods) {
      try {
        return await method();
      } catch (error) {
        const message = error && error.stack ? error.stack : String(error);
        maskErrors.push(message);
        console.warn(`[export-cg-single] mask attempt failed: ${message}`);
      }
    }
    throw new Error(`All binary mask screenshot methods failed:\n${maskErrors.join("\n\n")}`);
  } finally {
    await page.evaluate(() => window.__restoreWaterMeterRender()).catch(() => {});
  }
}

async function runConnectedBrowser(target) {
  let browser;
  let page;
  const logs = [];
  try {
    console.log(`[export-cg-single] connecting CDP ${cdpEndpoint}`);
    browser = await chromium.connectOverCDP(cdpEndpoint);
    const contexts = browser.contexts();
    if (contexts.length === 0) {
      throw new Error(`External Chrome at ${cdpEndpoint} has no browser context`);
    }
    const prepared = await preparePage(contexts[0], target, logs);
    page = prepared.page;
    const { canvas, canvasInfo } = prepared;
    const attempts = [
      () => tryCanvasElementScreenshot(canvas, "cdp:canvas-element-screenshot"),
      () => tryFullPageCanvasCrop(page, canvas, "cdp:full-page-canvas-crop"),
    ];

    const errors = [];
    for (const attempt of attempts) {
      try {
        const savedStats = await attempt();
        const maskStats = await exportBinaryMask(page, canvas, savedStats);
        const meta = await page.evaluate(() => window.__waterMeterMeta);
        return { profile: "external-chrome-cdp", canvasInfo, savedStats, maskStats, meta, logs, errors };
      } catch (error) {
        const message = error && error.stack ? error.stack : String(error);
        errors.push(message);
        console.warn(`[export-cg-single] attempt failed: ${message}`);
      }
    }
    throw new Error(`All CDP screenshot methods failed:\n${errors.join("\n\n")}`);
  } finally {
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}

server.listen(port, "127.0.0.1", async () => {
  try {
    const targetParams = new URLSearchParams({ export: "1", w: String(width), h: String(height), seed });
    if (family) targetParams.set("family", family);
    if (textureMode) targetParams.set("textureMode", textureMode);
    if (textureKey) targetParams.set("textureKey", textureKey);
    if (faceColor) targetParams.set("faceColor", faceColor);
    if (pbrRepeat) targetParams.set("pbrRepeat", pbrRepeat);
    if (pbrRoughnessMap) targetParams.set("pbrRoughnessMap", pbrRoughnessMap);
    if (pbrMetalnessMap) targetParams.set("pbrMetalnessMap", pbrMetalnessMap);
    if (pbrRoughness) targetParams.set("pbrRoughness", pbrRoughness);
    if (pbrMetalness) targetParams.set("pbrMetalness", pbrMetalness);
    if (pbrNormalScale) targetParams.set("pbrNormalScale", pbrNormalScale);
    if (normalizePbrExtrudeUVs) targetParams.set("normalizePbrExtrudeUVs", normalizePbrExtrudeUVs);
    if (environmentMode) targetParams.set("environmentMode", environmentMode);
    if (environmentKey) targetParams.set("environmentKey", environmentKey);
    if (environmentIntensity) targetParams.set("environmentIntensity", environmentIntensity);
    if (environmentRotation) targetParams.set("environmentRotation", environmentRotation);
    if (lightingWithEnvironment) targetParams.set("lightingWithEnvironment", lightingWithEnvironment);
    if (transparent) targetParams.set("transparent", transparent);
    if (digits) targetParams.set("digits", digits);
    const target = `http://127.0.0.1:${port}/?${targetParams.toString()}`;

    const result = await runConnectedBrowser(target);

    fs.writeFileSync(metadataOutput, `${JSON.stringify(result.meta, null, 2)}\n`);
    console.log(JSON.stringify({
      imageOutput,
      maskOutput,
      metadataOutput,
      debug: { fullPageDebug, canvasElementDebug, validatedBufferDebug, maskDebug },
      seed,
      width,
      height,
      exportProfile: result.profile,
      canvasInfo: result.canvasInfo,
      savedStats: result.savedStats,
      maskStats: result.maskStats,
      attemptErrors: result.errors,
      logs: result.logs,
    }, null, 2));
  } finally {
    server.close();
  }
});
