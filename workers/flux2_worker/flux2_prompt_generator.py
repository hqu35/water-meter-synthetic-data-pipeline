from __future__ import annotations

import argparse
import random
from pathlib import Path
from typing import Optional

from prompt_scenes import SCENES, sample_scene


GLASS_LIGHTING_AUGMENTATIONS = [
    ("directional glare and physically coherent environmental reflections", 38),
    ("soft reflected highlights and realistic surrounding reflections", 32),
    ("angled specular glare with restrained environmental reflections", 20),
    ("mixed directional highlights and natural glass reflections", 10),
]

GLASS_SURFACE_AUGMENTATIONS = [
    ("sparse water droplets with natural highlights", 25),
    ("faint perimeter condensation and fine water mist", 22),
    ("subtle fingerprints, smudges, and uneven glass roughness", 20),
    ("small dried water marks and sparse droplets", 18),
    ("light condensation with minor handling residue", 15),
]

MATERIAL_AUGMENTATIONS = [
    ("fine roughness variation, dust, fingerprints, and handling wear", 28),
    ("small scratches, subtle weathering, and natural tonal variation", 27),
    ("fine dust in seams and realistic minor surface imperfections", 25),
    ("slight oxidation limited to exposed connectors and pipe joints", 20),
]

PHOTOGRAPHIC_FINISHES = [
    ("natural contact shadows, environmental color spill, and fine sensor noise", 35),
    ("physically coherent reflections, directional highlights, and realistic depth", 30),
    ("natural exposure, restrained highlight rolloff, and mild camera noise", 20),
    ("integrated ambient light, accurate shadows, and documentary photographic detail", 15),
]


def _weighted_choice(rng: random.Random, choices: list[tuple[str, float]]) -> str:
    values, weights = zip(*choices)
    return rng.choices(values, weights=weights, k=1)[0]


def generate_prompt(
    seed: Optional[int] = None,
    scene_category: Optional[str] = None,
) -> str:
    scene = sample_scene(seed=seed, category=scene_category)
    rng = random.Random(None if seed is None else f"flux2:{seed}")

    glass_lighting = _weighted_choice(rng, GLASS_LIGHTING_AUGMENTATIONS)
    glass_surface = _weighted_choice(rng, GLASS_SURFACE_AUGMENTATIONS)
    material = _weighted_choice(rng, MATERIAL_AUGMENTATIONS)
    finish = _weighted_choice(rng, PHOTOGRAPHIC_FINISHES)

    return "\n".join(
        [
            "SPATIAL REFERENCE:",
            (
                "Use Reference 2 as the authoritative image-space layout. "
                "Its black region defines the meter silhouette, position, scale, "
                "orientation, outer contour, and spatial footprint; its white region "
                "defines the surrounding environment. The black and white values encode "
                "spatial regions only and do not define the final colors, materials, or lighting."
            ),
            (
                "Keep the generated meter tightly registered to the black footprint. "
                "Preserve the same image-space bounding box, center, scale, orientation, "
                "outer silhouette, perspective, and framing. Avoid noticeable translation, "
                "rotation, resizing, contour drift, or perspective drift."
            ),
            (
                "The meter should occupy the black footprint, while the generated background "
                "should remain primarily in the white region. Do not replace parts of the black "
                "meter footprint with background, and do not extend new meter geometry into the "
                "white surrounding region."
            ),
            "",
            "STRUCTURE AND ANNOTATIONS:",
            (
                "Use Reference 1 as the exact meter design, annotation, component-layout, "
                "camera-viewpoint, and underlying material-identity reference."
            ),
            (
                "Preserve the meter geometry, digit register window, every digit, printed text, "
                "labels, dials, pointers, screws, connectors, proportions, spacing, internal "
                "layout, and camera viewpoint. The result must depict the same meter rather "
                "than a reconstructed or redesigned meter."
            ),
            "",
            "PHOTOREALISTIC AUGMENTATION:",
            (
                "Apply substantial photorealistic glass, material, surface, lighting, and "
                "camera-response augmentation while preserving the registered meter structure "
                "and annotations."
            ),
            (
                "Retain approximately the same underlying colors, texture identity, and material "
                "character established by the CG reference, while enriching physically plausible "
                "roughness, reflections, wear, depth, and tonal variation."
            ),
            f"Glass lighting: {glass_lighting}.",
            f"Glass surface condition: {glass_surface}.",
            f"Meter material treatment: {material}.",
            (
                "Treat glare, reflections, droplets, condensation, mist, fingerprints, and "
                "smudges as transparent optical layers over the front glass. They may visually "
                "overlap the face, but they must not redraw, replace, relocate, deform, hallucinate, "
                "or make the underlying digits, text, labels, dials, and markings unreadable. "
                "Avoid opaque blockage and strong optical distortion that shifts their apparent positions."
            ),
            "",
            "ENVIRONMENT:",
            (
                f"Transform the white surrounding region into {scene.description}. "
                "Continue all visible connectors naturally into the installation environment."
            ),
            (
                "Match the meter perspective, camera height, lighting direction, exposure, "
                "environmental reflections, contact shadows, and local color spill."
            ),
            f"Photographic finish: {finish}.",
            (
                "The final image should look like a real photograph of the same meter in a "
                "realistic installation, while the meter remains tightly aligned with the "
                "black spatial footprint."
            ),
            "",
            "PROHIBITED CHANGES:",
            (
                "Do not redesign, reconstruct, duplicate, noticeably rotate, translate, resize, "
                "crop, or reposition the meter. Do not change digits, text, markings, components, "
                "or internal layout. Do not allow background to invade the meter footprint, "
                "do not expand meter geometry into the surrounding white region, and do not place "
                "opaque foreground objects over the meter face or digit register."
            ),
        ]
    )


def write_prompts(
    count: int,
    out_dir: Path,
    seed: Optional[int] = None,
    scene_category: Optional[str] = None,
) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)

    for index in range(count):
        prompt_seed = None if seed is None else seed + index
        prompt = generate_prompt(prompt_seed, scene_category)
        (out_dir / f"prompt_{index:04d}.txt").write_text(
            prompt + "\n",
            encoding="utf-8",
        )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate Flux2 water-meter prompts."
    )
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument("--scene", choices=sorted(SCENES), default=None)
    parser.add_argument("--n", type=int, default=None)
    parser.add_argument("--out", type=Path, default=Path("prompts/flux2"))
    args = parser.parse_args()

    if args.n is None:
        print(generate_prompt(args.seed, args.scene))
    else:
        write_prompts(args.n, args.out, args.seed, args.scene)


if __name__ == "__main__":
    main()
