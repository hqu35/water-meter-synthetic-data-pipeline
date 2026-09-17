import { describe, it, expect, beforeEach } from "vitest";
import {
  hashString,
  mulberry32,
  rand,
  randInt,
  choice,
  shuffle,
  setRng,
} from "../../renderer/random.js";

describe("hashString", () => {
  it("is deterministic for the same string", () => {
    expect(hashString("meter_0000")).toBe(hashString("meter_0000"));
  });

  it("produces different outputs for different representative strings", () => {
    const values = new Set(
      ["meter_0000", "meter_0001", "classic_round", "smart_housing", "seed-42"].map(hashString)
    );
    expect(values.size).toBe(5);
  });

  it("handles the empty string", () => {
    expect(hashString("")).toBe(2166136261 >>> 0);
  });

  it("handles unicode strings without throwing", () => {
    expect(Number.isFinite(hashString("水表-\u{1F4A7}"))).toBe(true);
  });

  it("always returns a finite unsigned 32-bit integer", () => {
    for (const input of ["a", "b", "long-seed-string-1234567890", "", "🙂"]) {
      const h = hashString(input);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(0xffffffff);
    }
  });
});

describe("mulberry32", () => {
  it("produces an identical sequence for the same seed", () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    const seqA = Array.from({ length: 20 }, () => a());
    const seqB = Array.from({ length: 20 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it("produces different representative sequences for different seeds", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    expect(seqA).not.toEqual(seqB);
  });

  it("always yields values in [0, 1)", () => {
    const gen = mulberry32(hashString("range-check"));
    for (let i = 0; i < 5000; i++) {
      const v = gen();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      expect(Number.isFinite(v)).toBe(true);
    }
  });

  it("advances state between calls (does not repeat immediately)", () => {
    const gen = mulberry32(999);
    const first = gen();
    const second = gen();
    expect(first).not.toBe(second);
  });

  it("remains finite over a long sequence", () => {
    const gen = mulberry32(hashString("long-run"));
    let allFinite = true;
    for (let i = 0; i < 100000; i++) {
      if (!Number.isFinite(gen())) {
        allFinite = false;
        break;
      }
    }
    expect(allFinite).toBe(true);
  });
});

describe("setRng / rand", () => {
  beforeEach(() => {
    setRng(mulberry32(1));
  });

  it("uses the injected deterministic RNG source", () => {
    const sequence = [0.1, 0.9, 0.5];
    let i = 0;
    setRng(() => sequence[i++]);
    expect(rand(0, 10)).toBeCloseTo(1);
    expect(rand(0, 10)).toBeCloseTo(9);
    expect(rand(0, 10)).toBeCloseTo(5);
  });

  it("stays within [min, max) for a normal range", () => {
    setRng(mulberry32(hashString("rand-range")));
    for (let i = 0; i < 1000; i++) {
      const v = rand(5, 15);
      expect(v).toBeGreaterThanOrEqual(5);
      expect(v).toBeLessThan(15);
    }
  });

  it("returns the constant value when min == max", () => {
    setRng(() => 0.73);
    expect(rand(4, 4)).toBe(4);
  });

  it("supports negative ranges", () => {
    setRng(() => 0.5);
    expect(rand(-10, -4)).toBeCloseTo(-7);
  });

  it("supports fractional ranges", () => {
    setRng(() => 0.25);
    expect(rand(0.1, 0.5)).toBeCloseTo(0.2);
  });

  it("documents actual behavior for a reversed range (min > max): output is not clamped into [max, min]", () => {
    // rand(min, max) = min + r * (max - min). With min > max this produces
    // a value BELOW min (moving toward max), i.e. it still lies within the
    // interval [max, min] but the function does not special-case the order.
    setRng(() => 0.5);
    const v = rand(10, 4);
    expect(v).toBeCloseTo(7);
    expect(v).toBeLessThanOrEqual(10);
    expect(v).toBeGreaterThanOrEqual(4);
  });
});

describe("randInt", () => {
  it("includes both the lower and upper bound", () => {
    setRng(() => 0);
    expect(randInt(3, 9)).toBe(3);
    setRng(() => 0.999999999);
    expect(randInt(3, 9)).toBe(9);
  });

  it("returns the single value for a single-value interval", () => {
    setRng(() => 0.42);
    expect(randInt(7, 7)).toBe(7);
  });

  it("handles negative integer ranges", () => {
    setRng(() => 0);
    expect(randInt(-5, -1)).toBe(-5);
    setRng(() => 0.999999999);
    expect(randInt(-5, -1)).toBe(-1);
  });

  it("never leaves [min, max] across many repeated samples", () => {
    setRng(mulberry32(hashString("randint-bounds")));
    for (let i = 0; i < 2000; i++) {
      const v = randInt(0, 9);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(9);
      expect(Number.isInteger(v)).toBe(true);
    }
  });
});

describe("choice", () => {
  it("returns a member of the input array", () => {
    setRng(mulberry32(hashString("choice-membership")));
    const arr = ["a", "b", "c", "d"];
    for (let i = 0; i < 50; i++) {
      expect(arr).toContain(choice(arr));
    }
  });

  it("always returns the sole element of a singleton array", () => {
    setRng(() => 0.99);
    expect(choice(["only"])).toBe("only");
  });

  it("documents current behavior for an empty array: returns undefined rather than throwing", () => {
    setRng(() => 0.5);
    expect(choice([])).toBeUndefined();
  });

  it("is deterministic for a seeded RNG", () => {
    const arr = ["a", "b", "c", "d", "e"];
    setRng(mulberry32(hashString("choice-determinism")));
    const a = choice(arr);
    setRng(mulberry32(hashString("choice-determinism")));
    const b = choice(arr);
    expect(a).toBe(b);
  });
});

describe("shuffle", () => {
  it("returns an array with the same elements (multiset-equal)", () => {
    setRng(mulberry32(hashString("shuffle-elements")));
    const arr = [1, 2, 3, 4, 5];
    const shuffled = shuffle(arr);
    expect([...shuffled].sort()).toEqual([...arr].sort());
  });

  it("does not mutate the input array", () => {
    setRng(mulberry32(hashString("shuffle-no-mutate")));
    const arr = [1, 2, 3, 4, 5];
    const copy = [...arr];
    shuffle(arr);
    expect(arr).toEqual(copy);
  });

  it("handles an empty array", () => {
    setRng(() => 0.5);
    expect(shuffle([])).toEqual([]);
  });

  it("handles a singleton array", () => {
    setRng(() => 0.5);
    expect(shuffle(["only"])).toEqual(["only"]);
  });

  it("preserves duplicate values", () => {
    setRng(mulberry32(hashString("shuffle-duplicates")));
    const arr = [1, 1, 2, 2, 3];
    const shuffled = shuffle(arr);
    expect([...shuffled].sort()).toEqual([...arr].sort());
  });

  it("is deterministic for a seeded RNG", () => {
    const arr = [1, 2, 3, 4, 5, 6];
    setRng(mulberry32(hashString("shuffle-determinism")));
    const a = shuffle(arr);
    setRng(mulberry32(hashString("shuffle-determinism")));
    const b = shuffle(arr);
    expect(a).toEqual(b);
  });
});
