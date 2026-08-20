from __future__ import annotations

import argparse
import json
import math
import random
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont


WORKSPACE_ROOT = Path(__file__).resolve().parents[3]
V2_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_COCO = WORKSPACE_ROOT / "output/coco_obb.json"
DEFAULT_IMAGE_ROOT = WORKSPACE_ROOT / "output"
DEFAULT_OUT = V2_ROOT / "validation/sample_results"


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def resolve_image(file_name: str, image_root: Path, coco_path: Path) -> Path | None:
    relative = Path(file_name)
    candidates = [
        image_root / relative,
        coco_path.parent / relative,
        WORKSPACE_ROOT / relative,
        WORKSPACE_ROOT / "output/images" / relative.name,
        WORKSPACE_ROOT / "output/cg" / relative.name,
    ]
    for candidate in candidates:
        if candidate.is_file():
            return candidate.resolve()
    return None


def obb_points(obb: list[float]) -> list[tuple[float, float]]:
    cx, cy, width, height, angle = map(float, obb)
    cos_a = math.cos(angle)
    sin_a = math.sin(angle)
    corners = []
    for dx, dy in [
        (-width / 2, -height / 2),
        (width / 2, -height / 2),
        (width / 2, height / 2),
        (-width / 2, height / 2),
    ]:
        corners.append((cx + dx * cos_a - dy * sin_a, cy + dx * sin_a + dy * cos_a))
    return corners


def load_font(size: int = 14) -> ImageFont.ImageFont:
    for candidate in [
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]:
        if Path(candidate).exists():
            return ImageFont.truetype(candidate, size)
    return ImageFont.load_default()


def annotation_color(category_name: str) -> tuple[int, int, int]:
    name = category_name.lower()
    if name in {"wheel", "register", "digit_reader", "digit register"}:
        return (25, 110, 255)
    if name == "digit":
        return (235, 45, 45)
    if name in {"meter", "object"}:
        return (25, 190, 90)
    return (255, 170, 20)


def draw_annotations(
    image_path: Path,
    image_record: dict[str, Any],
    annotations: list[dict[str, Any]],
    categories: dict[int, str],
    out_path: Path,
) -> dict[str, Any]:
    source = Image.open(image_path).convert("RGBA")
    background = Image.new("RGBA", source.size, (225, 228, 230, 255))
    background.alpha_composite(source)
    image = background.convert("RGB")
    expected_size = (int(image_record["width"]), int(image_record["height"]))
    if image.size != expected_size:
        raise ValueError(f"Image dimensions {image.size} do not match COCO {expected_size}")

    draw = ImageDraw.Draw(image)
    font = load_font()
    digit_font = load_font(12)
    category_counts: dict[str, int] = {}

    for annotation in annotations:
        category_name = categories.get(int(annotation["category_id"]), f"category_{annotation['category_id']}")
        category_counts[category_name] = category_counts.get(category_name, 0) + 1
        color = annotation_color(category_name)
        if "obb" in annotation:
            obb = annotation["obb"]
            if len(obb) != 5:
                raise ValueError(f"Annotation {annotation.get('id')} has invalid OBB: {obb}")
            points = obb_points(obb)
            draw.line(points + [points[0]], fill=color, width=3)
            label_x, label_y = points[0]
        elif "bbox" in annotation:
            x, y, width, height = map(float, annotation["bbox"])
            draw.rectangle((x, y, x + width, y + height), outline=color, width=3)
            label_x, label_y = x, y
        else:
            continue

        label_font = font
        if category_name.lower() == "digit" and "pos" in annotation:
            label = f"p{annotation['pos']}"
            label_font = digit_font
            label_y = max(0, label_y - 13)
        else:
            label = category_name
        text_box = draw.textbbox((label_x, label_y), label, font=label_font)
        draw.rectangle(text_box, fill=(0, 0, 0))
        draw.text((label_x, label_y), label, fill=color, font=label_font)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    image.save(out_path, optimize=True)
    return {
        "image_id": image_record["id"],
        "file_name": image_record["file_name"],
        "source_image": str(image_path),
        "visualization": str(out_path.resolve()),
        "annotation_count": len(annotations),
        "category_counts": category_counts,
        "image_size": list(image.size),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Visualize existing COCO boxes on one existing rendered image.")
    parser.add_argument("--coco", type=Path, default=DEFAULT_COCO)
    parser.add_argument("--image-root", type=Path, default=DEFAULT_IMAGE_ROOT)
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--seed", type=int, default=20260721)
    args = parser.parse_args()

    coco = read_json(args.coco)
    categories = {int(item["id"]): str(item["name"]) for item in coco.get("categories", [])}
    annotations_by_image: dict[int, list[dict[str, Any]]] = {}
    for annotation in coco.get("annotations", []):
        annotations_by_image.setdefault(int(annotation["image_id"]), []).append(annotation)

    candidates: list[tuple[dict[str, Any], Path]] = []
    for image_record in coco.get("images", []):
        image_path = resolve_image(str(image_record["file_name"]), args.image_root, args.coco)
        if image_path and annotations_by_image.get(int(image_record["id"])):
            candidates.append((image_record, image_path))
    if not candidates:
        raise FileNotFoundError("No COCO image record could be resolved to an existing rendered image.")

    image_record, image_path = random.Random(args.seed).choice(candidates)
    image_annotations = annotations_by_image[int(image_record["id"])]
    out_path = args.out_dir / f"{image_path.stem}_annotation_check.png"
    report = draw_annotations(image_path, image_record, image_annotations, categories, out_path)
    report.update(
        {
            "coco_path": str(args.coco.resolve()),
            "selection_seed": args.seed,
            "available_image_count": len(candidates),
            "categories_in_coco": categories,
            "note": "Visualization uses only existing COCO annotations; no annotations were generated.",
        }
    )
    report_path = args.out_dir / f"{image_path.stem}_annotation_check.json"
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
