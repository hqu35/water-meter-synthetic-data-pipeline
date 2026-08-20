from __future__ import annotations

import argparse
import random
from pathlib import Path
from typing import Optional

from prompt_scenes import SCENES, sample_scene


MOUNTING_SURFACES = [
    ("a plausible nearby wall or mounting surface", 32),
    ("practical pipe supports and a realistic mounting plane", 24),
    ("a restrained utility mounting surface with believable depth", 24),
    ("surrounding masonry or panels appropriate to the installation", 20),
]

LIGHTING_INTEGRATION = [
    ("match the existing perspective, light direction, and color temperature", 38),
    ("match the existing camera perspective, exposure, and ambient color", 32),
    ("continue the existing illumination with coherent scale and depth", 30),
]


def _weighted_choice(rng: random.Random, choices: list[tuple[str, float]]) -> str:
    values, weights = zip(*choices)
    return rng.choices(values, weights=weights, k=1)[0]


def generate_prompt(seed: Optional[int] = None, scene_category: Optional[str] = None) -> str:
    scene = sample_scene(seed=seed, category=scene_category)
    rng = random.Random(None if seed is None else f"qwen-background:{seed}")
    mounting = _weighted_choice(rng, MOUNTING_SURFACES)
    lighting = _weighted_choice(rng, LIGHTING_INTEGRATION)

    return "\n".join(
        [
            "Edit only the white mask region. The black mask region is the protected CG meter and must remain pixel-exact and unchanged.",
            f"Background: {scene.description}.",
            f"Continue the visible pipe connectors naturally into {mounting}; {lighting}. Add realistic contact shadows around the meter boundary.",
            "Do not alter the protected meter or add dirt, droplets, scratches, reflections, or material changes to it.",
            "Do not add extra meters, gauges, dials, number displays, text, logos, valves, hands, tools, wires, or foreground obstructions.",
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
        (out_dir / f"prompt_{index:04d}.txt").write_text(prompt + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate Qwen background-inpainting prompts.")
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument("--scene", choices=sorted(SCENES), default=None)
    parser.add_argument("--n", type=int, default=None)
    parser.add_argument("--out", type=Path, default=Path("prompts/qwen_background"))
    args = parser.parse_args()

    if args.n is None:
        print(generate_prompt(args.seed, args.scene))
    else:
        write_prompts(args.n, args.out, args.seed, args.scene)


if __name__ == "__main__":
    main()
