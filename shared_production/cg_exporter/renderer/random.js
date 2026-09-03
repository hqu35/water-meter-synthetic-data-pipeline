let rng;

/**
 * Installs the shared pseudo-random number generator used by the renderer.
 * The source must return a floating-point value in the range [0, 1).
 *
 * @param {() => number} source
 * @returns {void}
 */
function setRng(source) {
  rng = source;
}

/**
 * Samples a floating-point value from the half-open interval [min, max).
 *
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function rand(min, max) {
  return min + rng() * (max - min);
}

/**
 * Samples an integer from the inclusive interval [min, max].
 *
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function randInt(min, max) {
  return Math.floor(rand(min, max + 1));
}

/**
 * Selects one element uniformly from a non-empty array.
 *
 * @template T
 * @param {T[]} arr
 * @returns {T}
 */
function choice(arr) {
  return arr[randInt(0, arr.length - 1)];
}

/**
 * Returns a shuffled copy of an array using the Fisher-Yates algorithm.
 * The input array is not modified.
 *
 * @template T
 * @param {T[]} arr
 * @returns {T[]}
 */
function shuffle(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Converts a string into a deterministic unsigned 32-bit FNV-1a hash.
 *
 * @param {string} str
 * @returns {number}
 */
function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Creates a deterministic Mulberry32 pseudo-random number generator.
 *
 * @param {number} a Initial 32-bit seed.
 * @returns {() => number} A stateful generator producing values in [0, 1).
 */
function mulberry32(a) {
  /**
   * Advances the generator state and returns the next pseudo-random value.
   *
   * @returns {number}
   */
  return function next() {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export {
  hashString,
  mulberry32,
  rand,
  randInt,
  choice,
  shuffle,
  setRng,
};
