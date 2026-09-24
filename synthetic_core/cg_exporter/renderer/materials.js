import * as THREE from "../vendor/three.module.js";

export const PBR_TEXTURE_MANIFEST = Object.freeze(Object.fromEntries(
  ["Metal021", "Metal034", "Metal048A", "Metal050C", "Metal053C", "Metal062C"].map((key) => [key, {
    color: `../assets/textures/pbr/${key}/${key}_1K-PNG_Color.png`,
    roughness: `../assets/textures/pbr/${key}/${key}_1K-PNG_Roughness.png`,
    metalness: `../assets/textures/pbr/${key}/${key}_1K-PNG_Metalness.png`,
    normal: `../assets/textures/pbr/${key}/${key}_1K-PNG_NormalGL.png`,
  }])
));

export const FAMILY_TEXTURE_POOLS = Object.freeze({
  classic_round: ["Metal021", "Metal034", "Metal048A"],
  industrial_window: ["Metal021", "Metal034", "Metal048A", "Metal050C", "Metal053C", "Metal062C"],
  protective_shell: ["Metal034", "Metal050C"],
  modular_industrial: ["Metal021", "Metal048A", "Metal050C", "Metal053C", "Metal062C"],
  smart_housing: ["Metal034", "Metal048A", "Metal062C"],
});

const PBR_TEXTURE_CALIBRATION = Object.freeze({
  Metal053C: { roughness: 0.65, metalness: 1, normalScale: 0.28 },
  Metal062C: { roughness: 0.65, metalness: 1, normalScale: 0.28 },
});

const TEXTURED_ROLES_BY_FAMILY = Object.freeze({
  classic_round: ["metalHousing", "metalBezel", "metalConnector"],
  industrial_window: ["metalHousing", "metalBezel", "metalConnector", "metalMechanical"],
  protective_shell: ["metalBezel", "metalConnector", "metalMechanical"],
  modular_industrial: ["metalHousing", "metalBezel", "metalConnector", "metalMechanical"],
  smart_housing: ["metalBezel", "metalConnector", "metalMechanical"],
});

const textureLoader = new THREE.TextureLoader();
const texturePromiseCache = new Map();

function loadTextureCached(url) {
  if (!texturePromiseCache.has(url)) {
    texturePromiseCache.set(url, new Promise((resolve, reject) => {
      textureLoader.load(url, resolve, undefined, (error) => reject(new Error(`${url}: ${error?.message || "load failed"}`)));
    }));
  }
  return texturePromiseCache.get(url);
}

export async function loadPbrTextureSet(textureKey) {
  const entry = PBR_TEXTURE_MANIFEST[textureKey];
  if (!entry) return null;
  try {
    const [map, roughnessMap, metalnessMap, normalMap] = await Promise.all([
      loadTextureCached(entry.color),
      loadTextureCached(entry.roughness),
      loadTextureCached(entry.metalness),
      loadTextureCached(entry.normal),
    ]);
    map.colorSpace = THREE.SRGBColorSpace;
    return { map, roughnessMap, metalnessMap, normalMap };
  } catch (error) {
    console.error(`[water-meter] PBR texture load failed for ${textureKey}: ${error.message}`);
    return null;
  }
}

function clonePbrMap(texture, repeat, colorMap = false) {
  const clone = texture.clone();
  clone.wrapS = THREE.RepeatWrapping;
  clone.wrapT = THREE.RepeatWrapping;
  clone.repeat.set(repeat[0], repeat[1]);
  if (colorMap) clone.colorSpace = THREE.SRGBColorSpace;
  clone.needsUpdate = true;
  return clone;
}

function mat(color, roughness = 0.55, metalness = 0.25, opacity = 1) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness,
    transparent: opacity < 1,
    opacity,
    side: THREE.DoubleSide,
  });
}

export function createHousingMaterial(config) {
  switch (config.materialType) {
    case "brass":
      return mat(0x9a6d2f, 0.32, 0.85);
    case "darkMetal":
      return mat(0x303236, 0.38, 0.75);
    case "plastic":
      return new THREE.MeshPhysicalMaterial({
        color: config.color,
        metalness: 0,
        roughness: config.roughness,
        clearcoat: 0.18,
        clearcoatRoughness: 0.22,
        side: THREE.DoubleSide,
      });
    case "agedMetal":
      return mat(0x756957, 0.62, 0.65);
    default:
      return mat(config.color, config.roughness, config.metalness);
  }
}

function createFacePlateMaterial(config) {
  return mat(config.color, config.roughness, config.metalness);
}

export function createTrimMaterial(config, key = "primaryTrimColor") {
  const color = config.useGoldTrim ? config.goldColor : config[key] || config.primaryTrimColor;
  const metalness = config.useGoldTrim || config.style === "steel" || config.style === "bronze" ? 0.78 : 0.38;
  const roughness = config.useGoldTrim ? 0.28 : config.style === "steel" ? 0.34 : 0.5;
  return mat(color, roughness, metalness);
}

function createGlassMaterial(config) {
  const material = new THREE.MeshPhysicalMaterial({
    color: config.tint,
    metalness: 0,
    roughness: config.roughness,
    transmission: config.transmission,
    thickness: config.thickness,
    ior: config.ior,
    transparent: true,
    opacity: 1,
    clearcoat: config.clearcoat,
    clearcoatRoughness: config.clearcoatRoughness,
    specularIntensity: config.specularIntensity,
    envMapIntensity: config.envMapIntensity,
    side: THREE.FrontSide,
    depthWrite: false,
  });
  return material;
}

export function createMaterials({ config, loadedPbrTextureSet, runtime }) {
  function resolvePbrRepeat(role) {
    const diagnosticRepeat = Number(runtime.pbrRepeatParam);
    if (Number.isFinite(diagnosticRepeat) && diagnosticRepeat > 0) {
      return role === "metalConnector" ? [diagnosticRepeat, 1] : [diagnosticRepeat, diagnosticRepeat];
    }
    return role === "metalConnector" ? [2, 1] : [1, 1];
  }

  function familyAllowsTexturedRole(family, role) {
    return Boolean(config.pbr.loaded && TEXTURED_ROLES_BY_FAMILY[family]?.includes(role));
  }

  function createTexturedMetalMaterial(textureKey, options = {}) {
    if (!loadedPbrTextureSet || textureKey !== config.pbr.selectedTextureKey) return null;
    const repeat = options.repeat || [2, 2];
    const calibration = PBR_TEXTURE_CALIBRATION[textureKey] || {};
    const diagnosticRoughness = runtime.pbrRoughnessParam !== null && runtime.pbrRoughnessParam !== ""
      ? Number(runtime.pbrRoughnessParam)
      : Number.NaN;
    const diagnosticMetalness = runtime.pbrMetalnessParam !== null && runtime.pbrMetalnessParam !== ""
      ? Number(runtime.pbrMetalnessParam)
      : Number.NaN;
    const diagnosticNormalScale = runtime.pbrNormalScaleParam !== null && runtime.pbrNormalScaleParam !== ""
      ? Number(runtime.pbrNormalScaleParam)
      : Number.NaN;
    const normalScale = Number.isFinite(diagnosticNormalScale)
      ? diagnosticNormalScale
      : (options.normalScale ?? 0.7);
    const material = new THREE.MeshStandardMaterial({
      color: options.color || 0xffffff,
      map: clonePbrMap(loadedPbrTextureSet.map, repeat, true),
      roughnessMap: runtime.pbrRoughnessMapParam === "off"
        ? null
        : clonePbrMap(loadedPbrTextureSet.roughnessMap, repeat),
      metalnessMap: runtime.pbrMetalnessMapParam === "off"
        ? null
        : clonePbrMap(loadedPbrTextureSet.metalnessMap, repeat),
      normalMap: clonePbrMap(loadedPbrTextureSet.normalMap, repeat),
      roughness: Number.isFinite(diagnosticRoughness)
        ? diagnosticRoughness
        : (options.roughness ?? 1),
      metalness: Number.isFinite(diagnosticMetalness)
        ? diagnosticMetalness
        : (options.metalness ?? 1),
      normalScale: new THREE.Vector2(normalScale, normalScale),
      side: THREE.DoubleSide,
    });
    material.userData.pbrRole = options.role || "metalPbr";
    material.userData.normalizeExtrudeUVs = true;
    material.userData.extrudeCalibration = {
      roughness: Number.isFinite(diagnosticRoughness)
        ? diagnosticRoughness
        : (calibration.roughness ?? material.roughness),
      metalness: Number.isFinite(diagnosticMetalness)
        ? diagnosticMetalness
        : (calibration.metalness ?? material.metalness),
      normalScale: Number.isFinite(diagnosticNormalScale)
        ? diagnosticNormalScale
        : (calibration.normalScale ?? material.normalScale.x),
    };
    return material;
  }

  const materials = {
    white: createHousingMaterial(config.housing),
    warmWhite: mat(0xfffbf2, 0.36, 0.58),
    facePlate: createFacePlateMaterial(config.facePlate),
    dark: mat(0x20272c, 0.5, 0.45),
    black: createTrimMaterial(config.trim, "digitWindowBorderColor"),
    rubber: mat(0x15191c, 0.78, 0.28),
    blue: mat(0x1268b4, 0.38, 0.55),
    red: mat(0xc41f25, 0.42, 0.55),
    gray: createTrimMaterial(config.trim, "secondaryTrimColor"),
    metal: mat(0x8d9290, 0.55, 0.7),
    brass: mat(0xa0743c, 0.5, 0.72),
    glass: createGlassMaterial(config.glass),
    glassEdge: createTrimMaterial(config.trim, "secondaryTrimColor"),
  };
  const selectedTextureKey = config.pbr.selectedTextureKey;
  materials.metalHousing = familyAllowsTexturedRole(config.family, "metalHousing")
    ? createTexturedMetalMaterial(selectedTextureKey, { role: "metalHousing", repeat: resolvePbrRepeat("metalHousing"), normalScale: 0.55 })
    : null;
  materials.metalBezel = familyAllowsTexturedRole(config.family, "metalBezel")
    ? createTexturedMetalMaterial(selectedTextureKey, { role: "metalBezel", repeat: resolvePbrRepeat("metalBezel"), normalScale: 0.48 })
    : null;
  materials.metalConnector = familyAllowsTexturedRole(config.family, "metalConnector")
    ? createTexturedMetalMaterial(selectedTextureKey, { role: "metalConnector", repeat: resolvePbrRepeat("metalConnector"), normalScale: 0.62 })
    : null;
  materials.metalMechanical = familyAllowsTexturedRole(config.family, "metalMechanical")
    ? createTexturedMetalMaterial(selectedTextureKey, { role: "metalMechanical", repeat: resolvePbrRepeat("metalMechanical"), normalScale: 0.52 })
    : null;
  materials.metalDetail = config.pbr.loaded
    ? createTexturedMetalMaterial(selectedTextureKey, { role: "metalDetail", repeat: [1, 1], normalScale: 0.58 })
    : null;

  return {
    materials,
    resolvePbrRepeat,
    metalRoleMaterial(role, fallback) {
      return materials[role] || fallback;
    },
  };
}
