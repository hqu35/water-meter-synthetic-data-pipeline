let rng;

function setRng(source) {
  rng = source;
}

function rand(min, max) {
  return min + rng() * (max - min);
}

function randInt(min, max) {
  return Math.floor(rand(min, max + 1));
}

function choice(arr) {
  return arr[randInt(0, arr.length - 1)];
}

// Fisher-Yates shuffle -> P = 1/n!
function shuffle(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
// FNV-1a hash 
function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // cnovert to unsigned 32 bit
  return h >>> 0;
}
// PRNG
function mulberry32(a) {
  return function next() {
    let t = (a += 0x6d2b79f5);
    // avalanch mixing step
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    // output [0,1)
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
