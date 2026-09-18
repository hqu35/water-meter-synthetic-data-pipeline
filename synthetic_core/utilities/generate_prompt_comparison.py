from __future__ import annotations

import argparse
from pathlib import Path

from flux2_prompt_generator import generate_prompt as generate_flux2_prompt
from prompt_scenes import sample_scene
from qwen_background_prompt_generator import generate_prompt as generate_qwen_prompt


def write_comparison(count: int, seed: int, output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    sections = []
    for index in range(count):
        prompt_seed = seed + index
        scene = sample_scene(prompt_seed)
        sections.extend(
            [
                "=" * 80,
                f"SAMPLE {index:02d} | seed={prompt_seed} | scene={scene.category}",
                "",
                "[FLUX2]",
                generate_flux2_prompt(prompt_seed, scene.category),
                "",
                "[QWEN BACKGROUND]",
                generate_qwen_prompt(prompt_seed, scene.category),
                "",
            ]
        )
    output.write_text("\n".join(sections), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Write paired Flux2/Qwen prompt samples.")
    parser.add_argument("--n", type=int, default=10)
    parser.add_argument("--seed", type=int, default=1000)
    parser.add_argument("--out", type=Path, default=Path("prompt_samples/prompt_comparison.txt"))
    args = parser.parse_args()
    write_comparison(max(10, args.n), args.seed, args.out)
    print(args.out.resolve())


if __name__ == "__main__":
    main()

