const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { before, test } = require("node:test");

const rendererRoot = path.resolve(__dirname, "../renderer");
let configModule;
let randomModule;
let outputModule;

before(async () => {
  [configModule, randomModule, outputModule] = await Promise.all([
    import(pathToFileURL(path.join(rendererRoot, "config.js"))),
    import(pathToFileURL(path.join(rendererRoot, "random.js"))),
    import(pathToFileURL(path.join(rendererRoot, "output.js"))),
  ]);
});

function makeConfig(seed, family) {
  const rng = randomModule.mulberry32(randomModule.hashString(seed));
  randomModule.setRng(rng);
  return configModule.createMeterConfig({ seed, family, width: 512, height: 512, rng });
}

test("family is the only external design identity", () => {
  const explicit = makeConfig("explicit-seed", "industrial_window");
  const missing = makeConfig("missing-seed", undefined);
  const invalid = makeConfig("legacy-seed", "classic_white");

  assert.equal(explicit.family, "industrial_window");
  assert.ok(configModule.DESIGN_FAMILIES.includes(missing.family));
  assert.ok(configModule.DESIGN_FAMILIES.includes(invalid.family));
  assert.notEqual(invalid.family, "classic_white");
  assert.equal("presetName" in explicit, false);

  const sequence = [0.99];
  let calls = 0;
  const sequenceRng = () => sequence[calls++] ?? 0;
  randomModule.setRng(sequenceRng);
  const firstDrawSelection = configModule.createMeterConfig({
    seed: "first-draw",
    family: undefined,
    width: 512,
    height: 512,
    rng: sequenceRng,
  });
  assert.equal(firstDrawSelection.family, "smart_housing", "random family selection must consume the first RNG draw");
});

test("new family configuration baseline is deterministic", () => {
  const deterministicA = makeConfig("stable-seed", "protective_shell");
  const deterministicB = makeConfig("stable-seed", "protective_shell");
  const missingA = makeConfig("missing-seed", undefined);
  const missingB = makeConfig("missing-seed", undefined);

  assert.deepEqual(deterministicA, deterministicB);
  assert.equal(missingA.family, missingB.family);
  assert.equal(typeof deterministicA.layoutPreset, "string");
  assert.match(deterministicA.layoutPreset, /^protective_/);
});

test("metadata contains family and layout_preset but no preset", () => {
  const metadata = outputModule.buildOutputMetadata({
    seedParam: "metadata-seed",
    config: {
      family: "industrial_window",
      layoutPreset: "industrial_c",
      digitRegister: { selectedDigitCount: 8, digitCountSource: "test", redDigitCount: 1 },
      pbr: { mode: "off", selectedTextureKey: null, loaded: false },
      facePlate: { key: "gray", color: 0, dark: false, selectionSource: "test" },
      lighting: { withEnvironment: "current" },
    },
    width: 512,
    height: 512,
    occupied: [],
    registerGlyphDiagnostics: null,
    layoutState: { dials: [], validation: null },
    resolvePbrRepeat: () => null,
    normalizePbrExtrudeUVs: true,
    pbrUvNormalizationStats: [],
    environmentState: { mode: "room", requestedKey: null, selectedKey: null, loaded: false, fallback: false, intensity: 1, rotationDegrees: 0 },
    materials: {},
    annotationMeta: {},
  });

  assert.equal(metadata.family, "industrial_window");
  assert.equal(metadata.layout_preset, "industrial_c");
  assert.equal("preset" in metadata, false);
  assert.equal("lighting_mode" in metadata, false);
  assert.equal("presetName" in metadata.finalized_configuration, false);
  assert.equal("mode" in metadata.finalized_configuration.lighting, false);
});

test("lighting configuration preserves the current seeded behavior without a mode", () => {
  const seed = "lighting-seed";
  const expectedRng = randomModule.mulberry32(randomModule.hashString(`${seed}|lighting-reduced`));
  const configA = { lighting: { exposure: 99 } };
  const configB = { lighting: { exposure: -1 } };

  configModule.applyLightingConfiguration(configA, seed);
  configModule.applyLightingConfiguration(configB, seed);

  assert.deepEqual(configA, configB);
  assert.deepEqual(configA.lighting, {
    keyLightIntensity: 1.54,
    fillLightIntensity: 0.6,
    rimLightIntensity: 0.39,
    exposure: 0.92 + expectedRng() * 0.06,
  });
  assert.equal("mode" in configA.lighting, false);
});
