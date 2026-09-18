import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/vitest/**/*.test.js"],
    exclude: ["tests/vitest/helpers/**"],
    globals: false,
    // Full meter-scene construction (ExtrudeGeometry with bevels/curves) is
    // real geometric work, not I/O, so individual scenes can take ~1s each.
    testTimeout: 20000,
  },
});
