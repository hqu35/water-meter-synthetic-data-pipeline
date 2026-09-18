from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional


CATEGORIES = [
    {"id": 1, "name": "wheel"},
    {"id": 2, "name": "digit"},
]


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def validate_obb(obb: Any, label: str) -> List[float]:
    if not isinstance(obb, list) or len(obb) != 5:
        raise ValueError(f"{label}: obb must be [cx, cy, w, h, angle], got {obb!r}")
    values = [float(value) for value in obb]
    if values[2] <= 0 or values[3] <= 0:
        raise ValueError(f"{label}: obb width/height must be positive, got {obb!r}")
    return values


def image_size(metadata: dict, metadata_path: Path) -> tuple[int, int]:
    size = metadata.get("size")
    if isinstance(size, list) and len(size) == 2:
        width, height = int(size[0]), int(size[1])
    elif isinstance(metadata.get("image"), dict):
        image = metadata["image"]
        width = int(image.get("width", 0))
        height = int(image.get("height", 0))
    else:
        width = int(metadata.get("width", 0))
        height = int(metadata.get("height", 0))
    if width <= 0 or height <= 0:
        raise ValueError(f"{metadata_path}: width/height must be positive")
    return width, height


def iter_manifest_records(output_root: Path) -> Iterable[dict]:
    manifest_path = output_root / "manifest" / "production_manifest.json"
    if not manifest_path.exists():
        return []
    manifest = read_json(manifest_path)
    records = manifest.get("records", [])
    if not isinstance(records, list):
        return []
    return records


def metadata_stem_from_record(record: dict) -> Optional[str]:
    metadata_path = record.get("cg_metadata_path")
    if metadata_path:
        return Path(metadata_path).stem
    cg_path = record.get("cg_image_absolute_path")
    if cg_path:
        return Path(cg_path).stem
    return None


def build_diffusion_lookup(output_root: Path) -> Dict[str, List[Path]]:
    lookup: Dict[str, List[Path]] = {}
    seen: Dict[str, set[str]] = {}
    for record in iter_manifest_records(output_root):
        if record.get("status") != "completed":
            continue
        stem = metadata_stem_from_record(record)
        if not stem:
            continue
        diffusion_path = record.get("diffusion_output_path")
        if not diffusion_path:
            continue
        path = Path(diffusion_path).expanduser().resolve()
        if path.exists():
            path_key = str(path)
            if path_key not in seen.setdefault(stem, set()):
                lookup.setdefault(stem, []).append(path)
                seen[stem].add(path_key)
    return {stem: sorted(paths) for stem, paths in lookup.items()}


def relative_image_name(path: Path, root: Path) -> str:
    path = path.expanduser().resolve()
    root = root.expanduser().resolve()
    try:
        return path.relative_to(root).as_posix()
    except ValueError:
        return os.path.relpath(path, root).replace(os.sep, "/")


def image_file_names_for_stem(stem: str, image_root: Path, diffusion_lookup: Dict[str, List[Path]]) -> List[str]:
    diffusion_paths = diffusion_lookup.get(stem, [])
    if diffusion_paths:
        return [relative_image_name(path, image_root) for path in diffusion_paths]
    return [f"cg/{stem}.png"]


def wheel_reading(metadata: dict) -> str:
    if "wheel_reading" in metadata:
        return str(metadata.get("wheel_reading", ""))
    image = metadata.get("image")
    if isinstance(image, dict):
        return str(image.get("wheel_reading", ""))
    return ""


def build_coco_obb(output_root: Path, image_root: Path) -> dict:
    metadata_dir = output_root / "metadata"
    if not metadata_dir.exists():
        raise FileNotFoundError(f"Metadata directory not found: {metadata_dir}")

    diffusion_lookup = build_diffusion_lookup(output_root)
    images: List[dict] = []
    annotations: List[dict] = []
    annotation_id = 1
    wheel_count = 0
    digit_count = 0
    metadata_count = 0

    metadata_files = sorted(metadata_dir.glob("*.json"))
    if not metadata_files:
        raise FileNotFoundError(f"No metadata JSON files found in {metadata_dir}")

    image_id = 1
    for metadata_path in metadata_files:
        metadata_count += 1
        metadata = read_json(metadata_path)
        stem = metadata_path.stem
        width, height = image_size(metadata, metadata_path)

        wheel = metadata.get("wheel")
        if not isinstance(wheel, dict) or "obb" not in wheel:
            raise ValueError(f"{metadata_path}: exactly one wheel annotation is required")
        wheel_obb = validate_obb(wheel["obb"], f"{metadata_path}: wheel")

        digits = metadata.get("digits")
        if not isinstance(digits, list) or len(digits) < 1:
            raise ValueError(f"{metadata_path}: digit count must be >= 1")

        file_names = image_file_names_for_stem(stem, image_root, diffusion_lookup)
        for file_name in file_names:
            images.append(
                {
                    "id": image_id,
                    "file_name": file_name,
                    "width": width,
                    "height": height,
                    "wheel_reading": wheel_reading(metadata),
                    "metadata_file": f"metadata/{metadata_path.name}",
                }
            )

            annotations.append(
                {
                    "id": annotation_id,
                    "image_id": image_id,
                    "category_id": 1,
                    "obb": wheel_obb,
                }
            )
            annotation_id += 1
            wheel_count += 1

            for digit in digits:
                if not isinstance(digit, dict):
                    raise ValueError(f"{metadata_path}: digit annotation must be an object")
                digit_obb = validate_obb(digit.get("obb"), f"{metadata_path}: digit pos={digit.get('pos')}")
                annotations.append(
                    {
                        "id": annotation_id,
                        "image_id": image_id,
                        "category_id": 2,
                        "obb": digit_obb,
                        "pos": digit.get("pos"),
                        "gt_float": digit.get("gt_float"),
                    }
                )
                annotation_id += 1
                digit_count += 1

            image_id += 1

    return {
        "images": images,
        "annotations": annotations,
        "categories": CATEGORIES,
        "summary": {
            "metadata_count": metadata_count,
            "coco_image_count": len(images),
            "total_annotations": len(annotations),
            "wheel_count": wheel_count,
            "digit_count": digit_count,
            "average_variations_per_cg": len(images) / metadata_count if metadata_count else 0,
        },
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build COCO-OBB annotations from water meter metadata.")
    parser.add_argument("--output-root", type=Path, required=True)
    parser.add_argument("--image-root", type=Path, required=True)
    parser.add_argument("--out", type=Path, default=None)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    output_root = args.output_root.expanduser().resolve()
    image_root = args.image_root.expanduser().resolve()
    out_path = args.out.expanduser().resolve() if args.out else output_root / "annotations" / "coco_obb.json"

    coco = build_coco_obb(output_root, image_root)
    write_json(out_path, coco)

    summary = coco["summary"]
    print(f"COCO-OBB written: {out_path}")
    print(f"metadata_count: {summary['metadata_count']}")
    print(f"coco_image_count: {summary['coco_image_count']}")
    print(f"total annotations: {summary['total_annotations']}")
    print(f"wheel_count: {summary['wheel_count']}")
    print(f"digit_count: {summary['digit_count']}")
    print(f"average_variations_per_cg: {summary['average_variations_per_cg']:.4f}")


if __name__ == "__main__":
    main()
