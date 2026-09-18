import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as THREE from "../../vendor/three.module.js";
import { DESIGN_FAMILIES } from "../../renderer/config.js";
import { buildAnnotationMeta } from "../../renderer/annotations.js";
import { installFakeDom } from "./helpers/fakeDom.js";
import { buildMeterScene } from "./helpers/buildMeterScene.js";
import { scanForNonFinite } from "./helpers/assertFinite.js";

// Fixed seed list (not Math.random/Date.now) so any failure here is
// reproducible by re-running this exact file, per the task's fuzz-pass
// requirement. 10 seeds x 5 families = 50 scenes.
const FUZZ_SEEDS = Array.from({ length: 10 }, (_, i) => `fuzz-seed-${i}`);

let uninstallFakeDom;
beforeEach(() => {
  uninstallFakeDom = installFakeDom();
});
afterEach(() => {
  uninstallFakeDom();
});

function makeAnnotationCamera(width, height) {
  const camera = new THREE.PerspectiveCamera(45, width / height, 1, 3000);
  camera.position.set(0, 0, 1600);
  camera.lookAt(0, 0, 0);
  return camera;
}

for (const family of DESIGN_FAMILIES) {
  describe(`fuzz: family "${family}"`, () => {
    for (const seed of FUZZ_SEEDS) {
      it(`seed "${seed}" produces a valid, finite, well-formed meter`, () => {
        let scene;
        expect(() => {
          scene = buildMeterScene({ seed: `${family}-${seed}`, family });
        }).not.toThrow();

        // No NaN/Infinity anywhere in the finalized config.
        expect(scanForNonFinite(scene.meterConfig)).toEqual([]);

        // Positive dimensions on the digit register.
        expect(scene.digitWindow.w).toBeGreaterThan(0);
        expect(scene.digitWindow.h).toBeGreaterThan(0);

        // Valid digit/annotation count.
        expect([7, 8]).toContain(scene.annotationState.digits.length);
        expect(scene.annotationState.wheelReading).toHaveLength(scene.annotationState.digits.length);

        // Valid register placement (validateFinalLayout ran and passed).
        expect(scene.validation.valid).toBe(true);

        // Finite projected annotations under a representative camera.
        const camera = makeAnnotationCamera(scene.meterConfig.output.width, scene.meterConfig.output.height);
        const annotationMeta = buildAnnotationMeta({
          camera,
          width: scene.meterConfig.output.width,
          height: scene.meterConfig.output.height,
          annotationState: scene.annotationState,
        });
        expect(scanForNonFinite(annotationMeta)).toEqual([]);
      });
    }
  });
}
