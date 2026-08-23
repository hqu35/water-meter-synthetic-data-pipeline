import * as THREE from "../vendor/three.module.js";
import { choice, hashString, mulberry32, rand, randInt } from "./random.js";
import { HDRI_MANIFEST } from "./lighting.js";
import { FAMILY_TEXTURE_POOLS, PBR_TEXTURE_MANIFEST } from "./materials.js";

export const DESIGN_FAMILIES = [
  "classic_round",
  "industrial_window",
  "protective_shell",
  "modular_industrial",
  "smart_housing",
];
export function createMeterConfig({ seed, presetName, familyParam, width, height, rng }) {
  const base = {
    seed,
    presetName,
    output: { width, height, transparentBackground: true },
    shape: {
      faceShape: "roundedSquare",
      width: 1,
      height: 1,
      ovalAspectRatio: 1.25,
      cornerRadius: 0.32,
      bodyDepth: 86,
      facePlateDepth: 10,
      bezelDepth: 38,
      outerRimHeight: 10,
      innerRimHeight: 6,
      outerRimThickness: 0.12,
      innerRimThickness: 0.06,
      edgeBevelSize: 4,
      edgeBevelSegments: 3,
    },
    facePlate: {
      color: 0xfffbf2,
      roughness: 0.48,
      metalness: 0,
      raisedCenter: false,
      raisedCenterHeight: 2.5,
      recessedDigitWindow: true,
      digitWindowRecessDepth: 3.5,
    },
    housing: {
      materialType: "paintedMetal",
      color: 0xe6e2d8,
      roughness: 0.46,
      metalness: 0.52,
      thicknessScale: 1,
      addOuterProtrusions: true,
      protrusionCount: 4,
      protrusionDepth: 12,
      protrusionWidth: 52,
    },
    trim: {
      style: "black",
      primaryTrimColor: 0x111111,
      secondaryTrimColor: 0x496f91,
      useGoldTrim: false,
      goldColor: 0xc69b3c,
      digitWindowBorderColor: 0x111111,
      dialBorderColor: 0x111111,
      innerOutlineColor: 0x111111,
    },
    glass: {
      enabled: true,
      curvature: 14,
      offsetZ: 96,
      thickness: 8,
      roughness: 0.04,
      transmission: 1,
      ior: 1.5,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
      opacity: 1,
      specularIntensity: 1,
      envMapIntensity: 1,
      tint: 0xffffff,
      useSubtleReflectionOverlay: true,
      reflectionOpacity: 0.16,
      reflectionAngle: 0.58,
      reflectionScaleX: 210,
      reflectionScaleY: 22,
      reflectionOffsetX: 86,
      reflectionOffsetY: 112,
    },
    digitRegister: {
      minDigits: 7,
      maxDigits: 8,
      exactDigits: null,
      selectedDigitCount: null,
      digitCountSource: "weighted",
      redDigitCount: null,
    },
    family: "classic_round",
    layoutPreset: "classic_a",
    registerLayout: {
      anchor: [0, 0.42],
      alternateAnchors: [[0, 0.34]],
      widthScale: 1,
      heightScale: 1,
      anchorJitter: 0.025,
    },
    dialLayout: {
      anchors: [[0, -0.4]],
      radiusRange: [46, 62],
      count: 1,
    },
    cover: { type: "none", side: "up" },
    modules: { type: "none", side: 1, count: 0 },
    connectors: { radiusRange: [27, 42], yRange: [-18, 26], length: 1040 },
    screws: { countRange: [3, 8] },
    trimStructure: { ringCountRange: [1, 3] },
    appearance: {
      addDust: false,
      dustAmount: 0,
      addWaterStains: false,
      waterStainAmount: 0,
      addMildOxidation: false,
      oxidationAmount: 0,
    },
    lighting: {
      keyLightIntensity: 1.54,
      fillLightIntensity: 0.6,
      rimLightIntensity: 0.39,
      keyLightPosition: [-300, 320, 650],
      fillLightPosition: [270, -190, 430],
      rimLightPosition: [0, 380, -260],
      environmentIntensity: 1,
      exposure: 0.95,
    },
  };

  const presets = {
    classic_white: {
      shape: { faceShape: "roundedSquare", cornerRadius: 0.34, bodyDepth: 86, bezelDepth: 38, outerRimHeight: 8 },
      housing: { materialType: "paintedMetal", color: 0xe6e2d8, roughness: 0.44, metalness: 0.48, thicknessScale: 1 },
      trim: { style: "black", primaryTrimColor: 0x111111, secondaryTrimColor: 0x496f91, digitWindowBorderColor: 0x111111 },
      glass: { curvature: 13, roughness: 0.04, reflectionOpacity: 0.14 },
    },
    industrial_brass: {
      shape: { faceShape: "roundedSquare", bodyDepth: 104, bezelDepth: 48, outerRimHeight: 12, outerRimThickness: 0.16 },
      housing: { materialType: "brass", color: 0x9a6d2f, roughness: 0.34, metalness: 0.84, thicknessScale: 1.18 },
      trim: { style: "bronze", primaryTrimColor: 0x2a2118, secondaryTrimColor: 0x8b6b38 },
      facePlate: { color: 0xf0eadb, roughness: 0.55 },
    },
    oval_modern: {
      shape: { faceShape: "oval", ovalAspectRatio: 1.22, bodyDepth: 76, bezelDepth: 30, outerRimHeight: 6, outerRimThickness: 0.08 },
      housing: { materialType: "paintedMetal", color: 0xd9dee0, roughness: 0.38, metalness: 0.45, addOuterProtrusions: false },
      trim: { style: "steel", primaryTrimColor: 0x8f979b, secondaryTrimColor: 0x5f7484, digitWindowBorderColor: 0x20272c },
      glass: { curvature: 11, roughness: 0.035, tint: 0xf4fbff, reflectionOpacity: 0.13 },
    },
    black_gold: {
      shape: { faceShape: rng() > 0.45 ? "roundedSquare" : "oval", ovalAspectRatio: 1.18, bodyDepth: 90, bezelDepth: 40 },
      housing: { materialType: "darkMetal", color: 0x26282b, roughness: 0.38, metalness: 0.75 },
      facePlate: { color: 0x262723, roughness: 0.46, metalness: 0.12 },
      trim: { style: "gold", useGoldTrim: true, primaryTrimColor: 0xc69b3c, secondaryTrimColor: 0xc69b3c, digitWindowBorderColor: 0xc69b3c },
      glass: { curvature: 14, tint: 0xf7f1e8, reflectionOpacity: 0.18 },
    },
    heavy_duty: {
      shape: { faceShape: "circle", bodyDepth: 118, bezelDepth: 56, outerRimHeight: 14, innerRimHeight: 9, outerRimThickness: 0.18 },
      housing: { materialType: "agedMetal", color: 0x756957, roughness: 0.64, metalness: 0.66, thicknessScale: 1.3, addOuterProtrusions: true, protrusionCount: 6 },
      trim: { style: "dark", primaryTrimColor: 0x17191b, secondaryTrimColor: 0x5e676b },
      glass: { curvature: 18, thickness: 9, roughness: 0.055, reflectionOpacity: 0.18 },
    },
    minimal_flat: {
      shape: { faceShape: "roundedSquare", bodyDepth: 64, bezelDepth: 24, outerRimHeight: 4, innerRimHeight: 3, outerRimThickness: 0.06 },
      housing: { materialType: "plastic", color: 0xdedfdc, roughness: 0.48, metalness: 0, thicknessScale: 0.78, addOuterProtrusions: false },
      trim: { style: "gray", primaryTrimColor: 0x2f3438, secondaryTrimColor: 0x9aa2a6 },
      glass: { curvature: 8, roughness: 0.04, reflectionOpacity: 0.11 },
    },
  };

  const legacyFamilyMap = {
    classic_white: "classic_round",
    industrial_brass: "industrial_window",
    oval_modern: "smart_housing",
    black_gold: "modular_industrial",
    heavy_duty: "industrial_window",
    minimal_flat: "smart_housing",
  };
  const requestedFamily = DESIGN_FAMILIES.includes(familyParam)
    ? familyParam
    : DESIGN_FAMILIES.includes(presetName)
      ? presetName
      : null;
  const selectedFamily = requestedFamily || legacyFamilyMap[presetName] || choice(DESIGN_FAMILIES);
  const selectedName = presets[presetName] ? presetName : null;
  const randomized = randomizeMeterConfig(rng);
  deepMerge(base, randomized);
  deepMerge(base, createFamilyProfile(selectedFamily, seed, rng));
  if (presets[selectedName]) deepMerge(base, presets[selectedName]);
  base.family = selectedFamily;
  base.presetName = selectedName || selectedFamily;
  applyTrimStyle(base.trim);
  return base;
}

export function createFamilyProfile(family, seed, rng) {
  const layouts = {
    classic_round: [
      { name: "classic_a", register: [0, 0.43], dials: [[0, -0.4]] },
      { name: "classic_b", register: [0, 0.42], dials: [[0.31, -0.34]] },
      { name: "classic_c", register: [0, 0.44], dials: [[-0.28, -0.38], [0.28, -0.38]] },
      { name: "classic_d", register: [-0.03, 0.2], dials: [[-0.34, -0.39]] },
      { name: "classic_e", register: [0.02, 0.48], dials: [[0, -0.28]] },
    ],
    industrial_window: [
      { name: "industrial_a", register: [0, 0.32], dials: [[0, -0.36]] },
      { name: "industrial_b", register: [0, 0.16], dials: [[-0.32, -0.39]] },
      { name: "industrial_c", register: [0.04, 0.4], dials: [[0.3, -0.33]] },
      { name: "industrial_d", register: [-0.03, 0.28], dials: [[-0.32, -0.37], [0.32, -0.37]] },
      { name: "industrial_e", register: [0, 0.1], dials: [[0, -0.4]] },
    ],
    protective_shell: [
      { name: "protective_a", register: [-0.14, 0.4], dials: [[-0.24, -0.35]] },
      { name: "protective_b", register: [0, 0.42], dials: [[0, -0.37]] },
      { name: "protective_c", register: [-0.13, 0.39], dials: [[0.28, -0.34]] },
      { name: "protective_d", register: [0.06, 0.18], dials: [[-0.31, -0.4]] },
      { name: "protective_e", register: [0, 0.44], dials: [[0.18, -0.3]] },
    ],
    modular_industrial: [
      { name: "modular_a", register: [0, 0.43], dials: [[0, -0.36]] },
      { name: "modular_b", register: [-0.12, 0.4], dials: [[0.3, -0.34]] },
      { name: "modular_c", register: [0, 0.34], dials: [[-0.28, -0.4], [0.28, -0.4]] },
      { name: "modular_d", register: [0.02, 0.48], dials: [[0, -0.28]] },
      { name: "modular_e", register: [0.12, 0.34], dials: [[-0.31, -0.35]] },
    ],
    smart_housing: [
      { name: "smart_a", register: [0, 0.38], dials: [[0, -0.36]] },
      { name: "smart_b", register: [-0.13, 0.38], dials: [[-0.26, -0.34]] },
      { name: "smart_c", register: [0.02, 0.4], dials: [[0.29, -0.32]] },
      { name: "smart_d", register: [0, 0.15], dials: [[-0.32, -0.38]] },
      { name: "smart_e", register: [0, 0.43], dials: [[0.18, -0.29]] },
    ],
  };
  const layout = choice(layouts[family] || layouts.classic_round);
  // Select 1-3 dials independently from the layout anchor count. A dedicated
  // seeded stream keeps the result reproducible and stable across other RNG changes.
  const dialCountRng = mulberry32(hashString(`${seed}|${family}|${layout.name}|dial-count`));
  const dialCount = 1 + Math.floor(dialCountRng() * 3);
  const common = {
    family,
    layoutPreset: layout.name,
    registerLayout: {
      anchor: layout.register,
      alternateAnchors: [[0, 0.36], [0, 0.24]],
      anchorJitter: 0.018,
      redDigitCount: randInt(0, 3),
    },
    dialLayout: {
      anchors: layout.dials,
      count: dialCount,
    },
  };

  const profiles = {
    classic_round: {
      shape: { faceShape: "circle", width: 1, height: 1, outerRange: [398, 438], rimRange: [34, 52], bodyDepth: rand(72, 112) },
      housing: { materialType: "paintedMetal", color: choice([0xe8e5dc, 0xd8dde0, 0xf0eee6]), addOuterProtrusions: rng() > 0.42 },
      registerLayout: { widthScale: rand(0.9, 1.02), heightScale: rand(0.94, 1.04) },
      dialLayout: { radiusRange: [46, 62] },
      cover: { type: choice(["none", "hinged_lid"]), side: choice(["up", "left", "right"]) },
      modules: { type: "none", side: 1, count: 0 },
      connectors: { radiusRange: [27, 37], yRange: [-12, 18], length: 1020 },
      screws: { countRange: [3, 6] },
      trimStructure: { ringCountRange: [2, 3] },
      trim: { style: choice(["black", "blueGray", "steel"]) },
    },
    industrial_window: {
      shape: { faceShape: choice(["roundedSquare", "circle"]), width: rand(1.02, 1.1), height: rand(0.84, 0.94), outerRange: [405, 442], rimRange: [46, 64], bodyDepth: rand(104, 132), bezelDepth: rand(44, 60) },
      housing: { materialType: choice(["agedMetal", "paintedMetal", "brass"]), color: choice([0x777b78, 0x66717a, 0x8b7552]), thicknessScale: rand(1.12, 1.34), addOuterProtrusions: true },
      registerLayout: { widthScale: rand(1.02, 1.12), heightScale: rand(0.88, 0.98) },
      dialLayout: { radiusRange: [42, 56] },
      cover: { type: "window_lip", side: "up" },
      modules: { type: "industrial_plate", side: choice([-1, 1]), count: 1 },
      connectors: { radiusRange: [34, 45], yRange: [-8, 16], length: 1080 },
      screws: { countRange: [2, 5] },
      trimStructure: { ringCountRange: [1, 2] },
      trim: { style: choice(["dark", "steel", "bronze"]) },
    },
    protective_shell: {
      shape: { faceShape: "roundedSquare", width: rand(1.06, 1.14), height: rand(0.88, 0.98), cornerRadius: rand(0.3, 0.42), outerRange: [395, 430], rimRange: [44, 60], bodyDepth: rand(86, 116) },
      housing: { materialType: "plastic", color: choice([0xe5e8e8, 0xd7e0e5, 0xf0eee8]), metalness: 0, thicknessScale: rand(1.02, 1.2), addOuterProtrusions: false },
      registerLayout: { widthScale: rand(0.9, 1), heightScale: rand(0.92, 1.02) },
      dialLayout: { radiusRange: [44, 59] },
      cover: { type: "molded_shell", side: choice([-1, 1]) },
      modules: { type: "side_cap", side: choice([-1, 1]), count: 1 },
      connectors: { radiusRange: [28, 39], yRange: [-14, 18], length: 1040 },
      screws: { countRange: [2, 4] },
      trimStructure: { ringCountRange: [1, 2] },
      trim: { style: choice(["blueGray", "gray", "black"]) },
    },
    modular_industrial: {
      shape: { faceShape: choice(["circle", "roundedSquare"]), width: rand(1, 1.08), height: rand(0.92, 1.02), outerRange: [400, 440], rimRange: [42, 60], bodyDepth: rand(98, 128) },
      housing: { materialType: choice(["paintedMetal", "darkMetal"]), color: choice([0x73787b, 0xddd8cc, 0x3f4549]), thicknessScale: rand(1.08, 1.3), addOuterProtrusions: true },
      registerLayout: { widthScale: rand(0.92, 1.05), heightScale: rand(0.92, 1.04) },
      dialLayout: { radiusRange: [44, 60] },
      cover: { type: "partial_lower", side: choice([-1, 1]) },
      modules: { type: "lower_module", side: choice([-1, 1]), count: randInt(1, 2) },
      connectors: { radiusRange: [31, 42], yRange: [-12, 20], length: 1060 },
      screws: { countRange: [3, 6] },
      trimStructure: { ringCountRange: [2, 3] },
      trim: { style: choice(["dark", "bronze", "black"]) },
    },
    smart_housing: {
      shape: { faceShape: "roundedSquare", width: rand(1.08, 1.16), height: rand(0.82, 0.94), cornerRadius: rand(0.28, 0.4), outerRange: [390, 425], rimRange: [38, 54], bodyDepth: rand(72, 102) },
      housing: { materialType: "plastic", color: choice([0xe7e9e8, 0xd9e2e7, 0xf2f1eb]), metalness: 0, thicknessScale: rand(0.92, 1.12), addOuterProtrusions: false },
      registerLayout: { widthScale: rand(0.84, 0.96), heightScale: rand(0.9, 1) },
      dialLayout: { radiusRange: [42, 56] },
      cover: { type: "modern_panel", side: choice([-1, 1]) },
      modules: { type: "communication", side: choice([-1, 1]), count: randInt(1, 2) },
      connectors: { radiusRange: [25, 34], yRange: [-12, 16], length: 1020 },
      screws: { countRange: [2, 4] },
      trimStructure: { ringCountRange: [1, 2] },
      trim: { style: choice(["gray", "blueGray", "whiteEnamel"]) },
    },
  };
  return deepMerge(common, profiles[family] || profiles.classic_round);
}

export function randomizeMeterConfig(rng) {
  const faceShape = choice(["roundedSquare", "circle", "oval"]);
  const trimStyle = choice(["black", "steel", "gold", "bronze", "blueGray", "whiteEnamel"]);
  return {
    shape: {
      faceShape,
      ovalAspectRatio: rand(1.12, 1.32),
      cornerRadius: rand(0.24, 0.42),
      bodyDepth: rand(68, 112),
      facePlateDepth: rand(7, 13),
      bezelDepth: rand(28, 52),
      outerRimHeight: rand(4, 14),
      innerRimHeight: rand(3, 9),
      outerRimThickness: rand(0.07, 0.18),
      innerRimThickness: rand(0.045, 0.09),
      edgeBevelSize: rand(2.5, 6),
    },
    housing: {
      materialType: choice(["paintedMetal", "brass", "darkMetal", "plastic", "agedMetal"]),
      thicknessScale: rand(0.82, 1.24),
      addOuterProtrusions: rng() > 0.28,
      protrusionCount: randInt(3, 6),
      protrusionDepth: rand(7, 16),
      protrusionWidth: rand(42, 70),
    },
    trim: { style: trimStyle },
    glass: {
      curvature: rand(8, 18),
      roughness: rand(0.025, 0.065),
      opacity: 1,
      tint: choice([0xffffff, 0xf4fbff, 0xf7f1e8]),
      reflectionOpacity: rand(0.1, 0.19),
      reflectionAngle: rand(0.36, 0.78),
      reflectionOffsetX: rand(55, 125),
      reflectionOffsetY: rand(70, 155),
    },
    lighting: { exposure: rand(0.95, 1.12) },
  };
}

export function deepMerge(target, source) {
  for (const [key, value] of Object.entries(source || {})) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      target[key] ||= {};
      deepMerge(target[key], value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

export function getFacePlatePalettes() {
  return {
    industrial_window: [
      { key: "gold", color: 0xb58a45, roughness: 0.6, metalness: 0.24 },
      { key: "bronze", color: 0x8b7552, roughness: 0.64, metalness: 0.2 },
      { key: "gray", color: 0x85898a, roughness: 0.68, metalness: 0.08 },
      { key: "silver", color: 0xb9bec1, roughness: 0.62, metalness: 0.1 },
      { key: "off-white", color: 0xe8e5dc, roughness: 0.72, metalness: 0.02 },
      { key: "white", color: 0xf0f1ee, roughness: 0.7, metalness: 0 },
      { key: "charcoal", color: 0x34383a, roughness: 0.62, metalness: 0.12 },
      { key: "black", color: 0x1f2224, roughness: 0.58, metalness: 0.14 },
    ],
    classic_round: [
      { key: "off-white", color: 0xe8e5dc, roughness: 0.72, metalness: 0.02 },
      { key: "white", color: 0xf0f1ee, roughness: 0.7, metalness: 0 },
      { key: "silver", color: 0xb9bec1, roughness: 0.66, metalness: 0.08 },
      { key: "gray", color: 0x85898a, roughness: 0.7, metalness: 0.06 },
    ],
    protective_shell: [
      { key: "off-white", color: 0xe8e5dc, roughness: 0.74, metalness: 0 },
      { key: "white", color: 0xf0f1ee, roughness: 0.72, metalness: 0 },
      { key: "silver", color: 0xb9bec1, roughness: 0.7, metalness: 0.04 },
    ],
    modular_industrial: [
      { key: "silver", color: 0xb9bec1, roughness: 0.64, metalness: 0.1 },
      { key: "gray", color: 0x85898a, roughness: 0.68, metalness: 0.08 },
      { key: "charcoal", color: 0x34383a, roughness: 0.6, metalness: 0.14 },
      { key: "off-white", color: 0xe8e5dc, roughness: 0.72, metalness: 0.02 },
    ],
    smart_housing: [
      { key: "white", color: 0xf0f1ee, roughness: 0.72, metalness: 0 },
      { key: "off-white", color: 0xe8e5dc, roughness: 0.74, metalness: 0 },
      { key: "silver", color: 0xb9bec1, roughness: 0.7, metalness: 0.04 },
      { key: "gray", color: 0x85898a, roughness: 0.72, metalness: 0.04 },
    ],
  };
}

export function applyFacePlateVariation(config, seed, overrideKey) {
  const palettes = getFacePlatePalettes();
  const palette = palettes[config.family] || palettes.classic_round;
  const aliases = { "silver-gray": "silver", "cool-white": "white", "near-black": "black", "neutral-gray": "gray" };
  const requestedKey = aliases[overrideKey] || overrideKey;
  const override = requestedKey ? palette.find((entry) => entry.key === requestedKey) : null;
  const faceRng = mulberry32(hashString(`${seed}|${config.family}|face-plate`));
  const selected = override || palette[Math.floor(faceRng() * palette.length)];
  const color = new THREE.Color(selected.color);
  const luminance = color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
  const dark = luminance < 0.28;
  Object.assign(config.facePlate, selected, {
    selectionSource: override ? "override" : "seeded",
    dark,
    primaryLabelColor: dark ? "#f2f3ef" : "#111820",
    secondaryLabelColor: dark ? "#d8e7f2" : "#145faf",
  });
}

export function applyLightingMode(config, seed, mode) {
  if (mode === "old") {
    Object.assign(config.lighting, {
      keyLightIntensity: 2.2,
      fillLightIntensity: 0.85,
      rimLightIntensity: 0.55,
      exposure: 1.05,
      mode: "old",
    });
    return;
  }
  const lightingRng = mulberry32(hashString(`${seed}|lighting-reduced`));
  Object.assign(config.lighting, {
    keyLightIntensity: 1.54,
    fillLightIntensity: 0.6,
    rimLightIntensity: 0.39,
    exposure: 0.92 + lightingRng() * 0.06,
    mode: "reduced",
  });
}

export function applyLightingWithEnvironment(config, requestedMode) {
  const mode = ["current", "weak", "off"].includes(requestedMode) ? requestedMode : "current";
  const scale = mode === "weak" ? 0.45 : mode === "off" ? 0 : 1;
  config.lighting.keyLightIntensity *= scale;
  config.lighting.fillLightIntensity *= scale;
  config.lighting.rimLightIntensity *= scale;
  config.lighting.withEnvironment = mode;
}

export function selectEnvironment(seed, family, preset, requestedMode, requestedKey, intensityValue, rotationValue) {
  const mode = ["room", "single", "random"].includes(requestedMode) ? requestedMode : "room";
  const keys = Object.keys(HDRI_MANIFEST);
  let selectedKey = null;
  if (mode === "single") {
    if (requestedKey && HDRI_MANIFEST[requestedKey]) {
      selectedKey = requestedKey;
    } else {
      console.warn(`[water-meter] Invalid environment key "${requestedKey || ""}"; falling back to RoomEnvironment.`);
    }
  } else if (mode === "random") {
    const environmentRng = mulberry32(hashString(`${seed}|${family}|${preset}|environment`));
    selectedKey = keys[Math.floor(environmentRng() * keys.length)];
  }

  const hasIntensityOverride = intensityValue !== null && intensityValue !== "";
  const intensityNumber = Number(intensityValue);
  const intensityRng = mulberry32(hashString(`${seed}|${family}|environment-intensity`));
  const intensity = hasIntensityOverride && Number.isFinite(intensityNumber)
    ? THREE.MathUtils.clamp(intensityNumber, 0.5, 1.4)
    : selectedKey ? 0.65 + intensityRng() * 0.3 : 1;

  const hasRotationOverride = rotationValue !== null && rotationValue !== "";
  const rotationNumber = Number(rotationValue);
  const rotations = [0, 45];
  const rotationRng = mulberry32(hashString(`${seed}|${family}|environment-rotation`));
  const rotationDegrees = hasRotationOverride && Number.isFinite(rotationNumber)
    ? THREE.MathUtils.clamp(rotationNumber, -180, 180)
    : rotations[Math.floor(rotationRng() * rotations.length)];

  return {
    mode,
    requestedKey: requestedKey || null,
    selectedKey,
    intensity,
    rotationDegrees,
  };
}

export function applyDigitCountParams(config, { exactDigitsParam, digitMinParam, digitMaxParam }) {
  const clampDigit = (value) => Math.max(7, Math.min(8, Math.round(value)));
  if (exactDigitsParam !== null && Number.isFinite(Number(exactDigitsParam))) {
    config.digitRegister.exactDigits = clampDigit(Number(exactDigitsParam));
    config.digitRegister.minDigits = config.digitRegister.exactDigits;
    config.digitRegister.maxDigits = config.digitRegister.exactDigits;
    config.digitRegister.selectedDigitCount = config.digitRegister.exactDigits;
    config.digitRegister.digitCountSource = "url_override";
    return;
  }
  if (digitMinParam !== null && Number.isFinite(Number(digitMinParam))) {
    config.digitRegister.minDigits = clampDigit(Number(digitMinParam));
  }
  if (digitMaxParam !== null && Number.isFinite(Number(digitMaxParam))) {
    config.digitRegister.maxDigits = clampDigit(Number(digitMaxParam));
  }
  if (config.digitRegister.minDigits > config.digitRegister.maxDigits) {
    [config.digitRegister.minDigits, config.digitRegister.maxDigits] = [config.digitRegister.maxDigits, config.digitRegister.minDigits];
  }
}

export function selectDigitCount(meterConfig, rng) {
  const digitCfg = meterConfig.digitRegister;
  if (digitCfg.exactDigits) {
    digitCfg.selectedDigitCount = digitCfg.exactDigits;
    digitCfg.digitCountSource = "url_override";
    return digitCfg.exactDigits;
  }

  const r = rng();
  let count = r < 0.7 ? 8 : 7;

  count = Math.max(digitCfg.minDigits, Math.min(digitCfg.maxDigits, count));
  digitCfg.selectedDigitCount = count;
  digitCfg.digitCountSource = "seeded_weighted_70_30";
  return count;
}

export function selectPbrTexture(seed, family, requestedMode, requestedKey) {
  const mode = ["off", "single", "random"].includes(requestedMode) ? requestedMode : "off";
  if (mode === "off") return { mode, textureKey: null };
  if (mode === "single") {
    if (requestedKey && PBR_TEXTURE_MANIFEST[requestedKey]) return { mode, textureKey: requestedKey };
    console.warn(`[water-meter] unknown PBR texture key ${requestedKey || "<missing>"}; using plain fallback`);
    return { mode, textureKey: null };
  }
  const pool = FAMILY_TEXTURE_POOLS[family] || [];
  if (!pool.length) return { mode, textureKey: null };
  const textureRng = mulberry32(hashString(`${seed}|${family}|pbr-texture`));
  return { mode, textureKey: pool[Math.floor(textureRng() * pool.length)] };
}

export function applyTrimStyle(trim) {
  const styles = {
    black: [0x111111, 0x496f91],
    dark: [0x17191b, 0x5e676b],
    gray: [0x2f3438, 0x9aa2a6],
    steel: [0x8f979b, 0x5f7484],
    gold: [trim.goldColor || 0xc69b3c, 0xc69b3c],
    bronze: [0x4a3422, 0x8b6b38],
    blueGray: [0x263947, 0x5f7d8f],
    whiteEnamel: [0xf2f0e7, 0x9ba2a0],
  };
  const [primary, secondary] = styles[trim.style] || styles.black;
  trim.primaryTrimColor = primary;
  trim.secondaryTrimColor = secondary;
  if (trim.style === "gold") trim.useGoldTrim = true;
  if (trim.useGoldTrim) {
    trim.primaryTrimColor = trim.goldColor;
    trim.secondaryTrimColor = trim.goldColor;
  }
  trim.digitWindowBorderColor = trim.primaryTrimColor;
  trim.dialBorderColor = trim.primaryTrimColor;
  trim.innerOutlineColor = trim.primaryTrimColor;
}
