from __future__ import annotations

import random
from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class Scene:
    category: str
    description: str


SCENES = {
    "utility_room": Scene(
        "utility_room",
        "a practical utility room with painted concrete, exposed plumbing, and soft overhead light",
    ),
    "industrial_pipe_room": Scene(
        "industrial_pipe_room",
        "an industrial pipe room with galvanized pipes, brackets, and cool mixed workshop light",
    ),
    "basement_service_corridor": Scene(
        "basement_service_corridor",
        "a basement service corridor with concrete walls, pipe runs, and subdued fluorescent light",
    ),
    "garage_workshop": Scene(
        "garage_workshop",
        "a garage or workshop installation with a masonry wall, utility pipes, and neutral daylight",
    ),
    "apartment_plumbing_cabinet": Scene(
        "apartment_plumbing_cabinet",
        "an apartment plumbing cabinet with compact pipework, painted panels, and soft indoor light",
    ),
    "outdoor_concrete": Scene(
        "outdoor_concrete",
        "an outdoor concrete utility installation with connected pipes and diffuse natural daylight",
    ),
    "outdoor_soil": Scene(
        "outdoor_soil",
        "an outdoor ground-level installation beside soil, concrete edging, and practical water pipes",
    ),
    "storage_room": Scene(
        "storage_room",
        "a storage-room installation with an unfinished wall, exposed pipes, and dim ambient light",
    ),
    "agricultural_shed": Scene(
        "agricultural_shed",
        "an agricultural shed installation with rough masonry, irrigation pipes, and soft daylight",
    ),
}

SCENE_WEIGHTS = {
    "utility_room": 18,
    "industrial_pipe_room": 17,
    "basement_service_corridor": 12,
    "garage_workshop": 12,
    "apartment_plumbing_cabinet": 12,
    "outdoor_concrete": 10,
    "outdoor_soil": 6,
    "storage_room": 7,
    "agricultural_shed": 6,
}


def sample_scene(seed: Optional[int] = None, category: Optional[str] = None) -> Scene:
    """Return a deterministic scene for a seed, or the explicitly requested category."""
    if category is not None:
        try:
            return SCENES[category]
        except KeyError as exc:
            valid = ", ".join(sorted(SCENES))
            raise ValueError(f"Unknown scene category {category!r}. Choose one of: {valid}") from exc

    rng = random.Random(seed)
    categories = list(SCENE_WEIGHTS)
    weights = [SCENE_WEIGHTS[name] for name in categories]
    return SCENES[rng.choices(categories, weights=weights, k=1)[0]]

