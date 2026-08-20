from __future__ import annotations

import argparse
import copy
import json
import os
import random
import shutil
import struct
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
import zlib
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from threading import Event
from typing import Any, Callable, Dict, List, Optional

from flux2_prompt_generator import generate_prompt


PROJECT_ROOT = Path(__file__).resolve().parent
CG_EXPORTER_ROOT = PROJECT_ROOT.parents[1] / "shared_production" / "cg_exporter"
LOCAL_WORKFLOW = PROJECT_ROOT / "workflow/image_flux2_api.json"
DEFAULT_WORKFLOW = LOCAL_WORKFLOW
DEFAULT_COMFY_URL = "http://127.0.0.1:8188"
CG_TIME_SECONDS = 3
DIFFUSION_TIME_SECONDS = 30


class CGExportError(RuntimeError):
    def __init__(self, message: str, error_log: List[str], attempts: int, requested_seed: str) -> None:
        super().__init__(message)
        self.error_log = error_log
        self.attempts = attempts
        self.requested_seed = requested_seed


class JobCancelled(RuntimeError):
    pass


class HTTPJSONError(RuntimeError):
    def __init__(self, status_code: int, url: str, response_body: str, details: str) -> None:
        super().__init__(f"HTTP {status_code} from {url}: {details}")
        self.status_code = status_code
        self.url = url
        self.response_body = response_body


def utc_now() -> str:
    return datetime.utcnow().isoformat(timespec="seconds") + "Z"


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def http_json(url: str, data: Optional[dict] = None, timeout: int = 20) -> Any:
    body = None
    headers = {}
    if data is not None:
        body = json.dumps(data).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=body, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        details = raw or str(exc.reason)
        try:
            payload = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            payload = None
        if isinstance(payload, dict):
            error = payload.get("error")
            if isinstance(error, dict):
                error_type = error.get("type") or error.get("error_type") or "unknown_error"
                error_message = error.get("message") or error.get("error_message") or str(error)
            else:
                error_type = payload.get("error_type") or "unknown_error"
                error_message = payload.get("error_message") or payload.get("message") or str(error or payload)
            node_errors = payload.get("node_errors")
            details = f"error_type={error_type}; error_message={error_message}; node_errors={node_errors}"
        raise HTTPJSONError(exc.code, url, raw, details) from exc
    return json.loads(raw) if raw else {}


def check_comfy_reachable(comfy_url: str) -> None:
    comfy_url = comfy_url.rstrip("/")
    try:
        http_json(f"{comfy_url}/system_stats", timeout=8)
    except Exception as exc:
        raise RuntimeError(f"ComfyUI is not reachable at {comfy_url}: {exc}") from exc


def find_node_env() -> tuple[str, Dict[str, str]]:
    env = os.environ.copy()
    node_bin = env.get("NODE_BIN")
    if node_bin:
        return node_bin, env

    bundled = Path.home() / ".cache/codex-runtimes/codex-primary-runtime/dependencies/node"
    bundled_node = bundled / "bin/node"
    bundled_modules = bundled / "node_modules"
    if bundled_node.exists():
        if bundled_modules.exists():
            env["NODE_PATH"] = str(bundled_modules)
        return str(bundled_node), env

    return "node", env


def ensure_dataset_dirs(output_root: Path) -> Dict[str, Path]:
    dirs = {
        "cg": output_root / "cg",
        "masks": output_root / "masks",
        "metadata": output_root / "metadata",
        "prompts": output_root / "prompts",
        "diffusion_outputs": output_root / "diffusion_outputs",
        "manifest": output_root / "manifest",
        "logs": output_root / "logs",
        "debug_workflows": output_root / "debug_workflows",
    }
    for path in dirs.values():
        path.mkdir(parents=True, exist_ok=True)
    return dirs


def output_has_existing_data(output_root: Path) -> bool:
    if not output_root.exists():
        return False
    for sub in ["cg", "masks", "metadata", "prompts", "diffusion_outputs", "manifest", "logs", "debug_workflows"]:
        path = output_root / sub
        if path.exists() and any(path.iterdir()):
            return True
    return False


def png_stats(path: Path) -> dict:
    buffer = path.read_bytes()
    if buffer[:8] != b"\x89PNG\r\n\x1a\n":
        raise RuntimeError(f"Not a PNG file: {path}")
    pos = 8
    width = 0
    height = 0
    bit_depth = 0
    color_type = 0
    idat: List[bytes] = []
    while pos < len(buffer):
        length = struct.unpack(">I", buffer[pos:pos + 4])[0]
        pos += 4
        chunk_type = buffer[pos:pos + 4]
        pos += 4
        chunk = buffer[pos:pos + length]
        pos += length + 4
        if chunk_type == b"IHDR":
            width, height, bit_depth, color_type, *_ = struct.unpack(">IIBBBBB", chunk)
        elif chunk_type == b"IDAT":
            idat.append(chunk)
        elif chunk_type == b"IEND":
            break
    if bit_depth != 8 or color_type not in (2, 6):
        raise RuntimeError(f"Unsupported PNG format for {path}: bit_depth={bit_depth} color_type={color_type}")

    channels = 4 if color_type == 6 else 3
    stride = width * channels
    raw = zlib.decompress(b"".join(idat))
    offset = 0
    prev = [0] * stride
    mins = [255, 255, 255]
    maxs = [0, 0, 0]
    sums = [0, 0, 0]
    white_pixels = 0
    black_pixels = 0
    pixels = 0
    visible_pixels = 0
    transparent_pixels = 0
    non_opaque_pixels = 0
    colored_pixels = 0
    exact_white_pixels = 0
    exact_black_pixels = 0
    corner_pixels: List[List[int]] = []
    center_pixel: List[int] = []

    def paeth(a: int, b: int, c: int) -> int:
        p = a + b - c
        pa = abs(p - a)
        pb = abs(p - b)
        pc = abs(p - c)
        if pa <= pb and pa <= pc:
            return a
        if pb <= pc:
            return b
        return c

    for y in range(height):
        filter_type = raw[offset]
        offset += 1
        scan = list(raw[offset:offset + stride])
        offset += stride
        recon = [0] * stride
        for x, value in enumerate(scan):
            left = recon[x - channels] if x >= channels else 0
            up = prev[x]
            up_left = prev[x - channels] if x >= channels else 0
            if filter_type == 0:
                reconstructed = value
            elif filter_type == 1:
                reconstructed = value + left
            elif filter_type == 2:
                reconstructed = value + up
            elif filter_type == 3:
                reconstructed = value + ((left + up) // 2)
            elif filter_type == 4:
                reconstructed = value + paeth(left, up, up_left)
            else:
                raise RuntimeError(f"Unsupported PNG filter {filter_type} in {path}")
            recon[x] = reconstructed & 255
        for x in range(0, stride, channels):
            alpha = recon[x + 3] if channels == 4 else 255
            pixel_x = x // channels
            rgb = recon[x:x + 3]
            rgba = [*rgb, alpha]
            pixels += 1
            if alpha != 255:
                non_opaque_pixels += 1
            if (pixel_x, y) in {
                (0, 0),
                (width - 1, 0),
                (0, height - 1),
                (width - 1, height - 1),
            }:
                corner_pixels.append(rgba)
            if pixel_x == width // 2 and y == height // 2:
                center_pixel = rgba
            if alpha <= 8:
                transparent_pixels += 1
                continue
            if not (rgb[0] == rgb[1] == rgb[2]):
                colored_pixels += 1
            for channel in range(3):
                mins[channel] = min(mins[channel], rgb[channel])
                maxs[channel] = max(maxs[channel], rgb[channel])
                sums[channel] += rgb[channel]
            if all(value >= 248 for value in rgb):
                white_pixels += 1
            if all(value <= 7 for value in rgb):
                black_pixels += 1
            if rgb == [255, 255, 255]:
                exact_white_pixels += 1
            if rgb == [0, 0, 0]:
                exact_black_pixels += 1
            visible_pixels += 1
        prev = recon

    if visible_pixels == 0:
        return {
            "width": width,
            "height": height,
            "pixels": pixels,
            "visible_pixels": visible_pixels,
            "transparent_ratio": transparent_pixels / pixels,
            "non_opaque_pixels": non_opaque_pixels,
            "colored_pixels": colored_pixels,
            "file_size": len(buffer),
            "mean_rgb": [0, 0, 0],
            "extrema": [(0, 0), (0, 0), (0, 0)],
            "white_ratio": 0,
            "black_ratio": 1,
            "nonwhite_ratio": 0,
            "nonblack_ratio": 0,
            "exact_white_pixels": exact_white_pixels,
            "exact_black_pixels": exact_black_pixels,
            "corner_pixels": corner_pixels,
            "center_pixel": center_pixel,
        }

    return {
        "width": width,
        "height": height,
        "pixels": pixels,
        "visible_pixels": visible_pixels,
        "transparent_ratio": transparent_pixels / pixels,
        "non_opaque_pixels": non_opaque_pixels,
        "colored_pixels": colored_pixels,
        "file_size": len(buffer),
        "mean_rgb": [value / visible_pixels for value in sums],
        "extrema": list(zip(mins, maxs)),
        "white_ratio": white_pixels / visible_pixels,
        "black_ratio": black_pixels / visible_pixels,
        "nonwhite_ratio": 1 - white_pixels / visible_pixels,
        "nonblack_ratio": 1 - black_pixels / visible_pixels,
        "exact_white_pixels": exact_white_pixels,
        "exact_black_pixels": exact_black_pixels,
        "corner_pixels": corner_pixels,
        "center_pixel": center_pixel,
    }


def validate_cg_png(
    path: Path,
    label: str,
    expected_width: Optional[int] = None,
    expected_height: Optional[int] = None,
) -> dict:
    if not path.exists():
        raise RuntimeError(f"{label} does not exist: {path}")
    stats = png_stats(path)
    print(f"[massive_production] {label} png stats={json.dumps(stats)}")
    if stats["file_size"] <= 0:
        raise RuntimeError(f"{label} is empty: {path}")
    if expected_width is not None and stats["width"] != expected_width:
        raise RuntimeError(f"{label} width {stats['width']} does not match expected {expected_width}")
    if expected_height is not None and stats["height"] != expected_height:
        raise RuntimeError(f"{label} height {stats['height']} does not match expected {expected_height}")
    if stats["white_ratio"] > 0.99:
        raise RuntimeError(f"{label} is blank/near-white: {json.dumps(stats)}")
    if stats["black_ratio"] > 0.99:
        raise RuntimeError(f"{label} is blank/near-black: {json.dumps(stats)}")
    channel_ranges = [maximum - minimum for minimum, maximum in stats["extrema"]]
    if all(value < 8 for value in channel_ranges):
        raise RuntimeError(f"{label} has low pixel variation: {json.dumps(stats)}")
    return stats


def validate_mask_png(path: Path, label: str, expected_width: int, expected_height: int) -> dict:
    if not path.exists():
        raise RuntimeError(f"{label} does not exist: {path}")
    stats = png_stats(path)
    print(f"[massive_production] {label} png stats={json.dumps(stats)}")
    if stats["file_size"] <= 0:
        raise RuntimeError(f"{label} is empty: {path}")
    if (stats["width"], stats["height"]) != (expected_width, expected_height):
        raise RuntimeError(
            f"{label} dimensions {(stats['width'], stats['height'])} do not match "
            f"expected {(expected_width, expected_height)}"
        )
    if stats["non_opaque_pixels"]:
        raise RuntimeError(f"{label} contains {stats['non_opaque_pixels']} non-opaque pixels")
    if stats["colored_pixels"]:
        raise RuntimeError(f"{label} contains {stats['colored_pixels']} non-grayscale pixels")
    if not stats["corner_pixels"] or any(pixel[:3] != [255, 255, 255] for pixel in stats["corner_pixels"]):
        raise RuntimeError(f"{label} does not have a white background at all four corners")
    if stats["white_ratio"] < 0.05 or stats["black_ratio"] < 0.01:
        raise RuntimeError(f"{label} must contain both white background and black meter region: {json.dumps(stats)}")
    return stats


def validate_reference_pair(
    image_path: Path,
    mask_path: Path,
    width: int,
    height: int,
    label: str,
) -> tuple[dict, dict]:
    image_stats = validate_cg_png(image_path, f"{label} RGB", width, height)
    mask_stats = validate_mask_png(mask_path, f"{label} mask", width, height)
    if (image_stats["width"], image_stats["height"]) != (mask_stats["width"], mask_stats["height"]):
        raise RuntimeError(f"{label} RGB and mask dimensions do not match")
    return image_stats, mask_stats


def generate_cg_image(
    index: int,
    width: int,
    height: int,
    requested_seed: str,
    comfy_input_dir: Path,
    dataset_cg_path: Path,
    dataset_mask_path: Path,
    metadata_path: Path,
    attempt_callback: Optional[Callable[[int, str], None]] = None,
) -> tuple[Path, dict]:
    comfy_cg_dir = comfy_input_dir / "cg_meters"
    comfy_cg_dir.mkdir(parents=True, exist_ok=True)
    comfy_image_path = comfy_cg_dir / f"meter_{index:04d}.png"
    comfy_mask_path = comfy_cg_dir / f"meter_{index:04d}_mask.png"

    node, env = find_node_env()
    command = [node, str(CG_EXPORTER_ROOT / "export-cg-single.js")]
    attempt_seeds = [
        requested_seed,
        requested_seed,
        f"{requested_seed}_retry1",
        f"{requested_seed}_retry2",
        f"{requested_seed}_retry3",
    ]
    error_log: List[str] = []
    last_error = ""
    for attempt, actual_seed in enumerate(attempt_seeds, start=1):
        if attempt_callback:
            attempt_callback(attempt, actual_seed)
        attempt_env = env.copy()
        attempt_env.update(
            {
                "WIDTH": str(width),
                "HEIGHT": str(height),
                "SEED": actual_seed,
                "TEXTURE_MODE": "random",
                "ENVIRONMENT_MODE": "random",
                "IMAGE_OUTPUT": str(comfy_image_path),
                "MASK_OUTPUT": str(comfy_mask_path),
                "METADATA_OUTPUT": str(metadata_path),
                "PORT": str(5601 + (index % 1000)),
            }
        )
        print(f"[massive_production] CG export index={index} requested_seed={requested_seed} attempt={attempt} actual_seed={actual_seed}")
        print(f"[massive_production] CG export command={' '.join(command)}")
        print(f"[massive_production] CG final image path={comfy_image_path}")
        print(f"[massive_production] CG final metadata path={metadata_path}")
        try:
            result = subprocess.run(
                command,
                cwd=str(CG_EXPORTER_ROOT),
                env=attempt_env,
                check=True,
                text=True,
                capture_output=True,
            )
            if result.stdout:
                print(result.stdout.rstrip())
            if result.stderr:
                print(result.stderr.rstrip(), file=sys.stderr)
            comfy_stats, comfy_mask_stats = validate_reference_pair(
                comfy_image_path,
                comfy_mask_path,
                width,
                height,
                "ComfyUI input",
            )
            if not metadata_path.exists():
                raise RuntimeError(f"CG metadata does not exist: {metadata_path}")
            try:
                read_json(metadata_path)
            except Exception as exc:
                raise RuntimeError(f"CG metadata is unreadable: {metadata_path}: {exc}") from exc
            dataset_cg_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(comfy_image_path, dataset_cg_path)
            dataset_mask_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(comfy_mask_path, dataset_mask_path)
            dataset_stats, dataset_mask_stats = validate_reference_pair(
                dataset_cg_path,
                dataset_mask_path,
                width,
                height,
                "dataset",
            )
            print(f"[massive_production] CG export success index={index} attempt={attempt} actual_seed={actual_seed}")
            return comfy_image_path, {
                "requested_seed": requested_seed,
                "cg_seed_used": actual_seed,
                "cg_export_attempts": attempt,
                "cg_export_error_log": error_log,
                "cg_comfy_png_stats": comfy_stats,
                "cg_comfy_mask_png_stats": comfy_mask_stats,
                "cg_dataset_png_stats": dataset_stats,
                "cg_dataset_mask_png_stats": dataset_mask_stats,
                "cg_mask_absolute_path": str(dataset_mask_path.resolve()),
                "cg_mask_comfy_absolute_path": str(comfy_mask_path.resolve()),
            }
        except Exception as exc:
            if isinstance(exc, subprocess.CalledProcessError):
                stdout = exc.stdout or ""
                stderr = exc.stderr or ""
                last_error = f"attempt {attempt} failed: exit={exc.returncode}; stdout={stdout[-3000:]}; stderr={stderr[-3000:]}"
            else:
                last_error = f"attempt {attempt} failed: {exc}"
            error_log.append(last_error)
            print(f"[massive_production] CG export failure index={index} attempt={attempt} actual_seed={actual_seed}: {last_error}", file=sys.stderr)
            time.sleep(1)
    raise CGExportError(
        f"CG export failed after {len(attempt_seeds)} attempts for index={index} requested_seed={requested_seed}. "
        f"Last error: {last_error}",
        error_log,
        len(attempt_seeds),
        requested_seed,
    )


def set_if_exists(workflow: dict, node_id: str, input_name: str, value: Any) -> None:
    node = workflow.get(node_id)
    if isinstance(node, dict) and isinstance(node.get("inputs"), dict):
        node["inputs"][input_name] = value


def set_required_input(
    workflow: dict,
    node_id: str,
    input_name: str,
    value: Any,
    expected_class_type: str,
) -> None:
    node = workflow.get(node_id)
    if not isinstance(node, dict):
        raise ValueError(f"Required workflow node {node_id} ({expected_class_type}) is missing")
    actual_class_type = node.get("class_type")
    if actual_class_type != expected_class_type:
        raise ValueError(
            f"Workflow node {node_id} must be {expected_class_type}, got {actual_class_type!r}"
        )
    inputs = node.get("inputs")
    if not isinstance(inputs, dict):
        raise ValueError(f"Required workflow node {node_id} has no inputs object")
    if input_name not in inputs:
        raise ValueError(f"Required input {node_id}.{input_name} is missing")
    inputs[input_name] = value


def validate_flux2_reference_graph(workflow: dict) -> None:
    required_connections = {
        ("68:44", "pixels"): ["46", 0],
        ("68:125", "pixels"): ["126", 0],
        ("68:43", "conditioning"): ["68:26", 0],
        ("68:43", "latent"): ["68:44", 0],
        ("68:128", "conditioning"): ["68:43", 0],
        ("68:128", "latent"): ["68:125", 0],
        ("68:22", "conditioning"): ["68:128", 0],
    }
    for (node_id, input_name), expected in required_connections.items():
        node = workflow.get(node_id)
        actual = node.get("inputs", {}).get(input_name) if isinstance(node, dict) else None
        if actual != expected:
            raise ValueError(
                f"Flux2 dual-reference graph is invalid at {node_id}.{input_name}: "
                f"expected {expected}, got {actual}"
            )


def append_cache_buster(prompt: str, cache_buster: str) -> str:
    if "CACHE_BUSTER:" in prompt:
        raise ValueError("Generated prompt already contains CACHE_BUSTER")
    return f"{prompt.rstrip()}\nCACHE_BUSTER: {cache_buster}"


def configure_output_size(workflow: dict, width: int, height: int) -> None:
    size_node = workflow.get("68:133")
    if isinstance(size_node, dict) and size_node.get("class_type") == "GetImageSize":
        image_input = size_node.get("inputs", {}).get("image")
        if image_input != ["46", 0]:
            raise ValueError(f"GetImageSize node 68:133 must read RGB node 46, got {image_input}")
        expected_connections = {
            ("68:47", "width"): ["68:133", 0],
            ("68:47", "height"): ["68:133", 1],
            ("68:48", "width"): ["68:133", 0],
            ("68:48", "height"): ["68:133", 1],
        }
        for (node_id, input_name), expected in expected_connections.items():
            actual = workflow.get(node_id, {}).get("inputs", {}).get(input_name)
            if actual != expected:
                raise ValueError(
                    f"Workflow size connection {node_id}.{input_name} must be {expected}, got {actual}"
                )
        return

    set_required_input(workflow, "68:47", "width", width, "EmptyFlux2LatentImage")
    set_required_input(workflow, "68:47", "height", height, "EmptyFlux2LatentImage")
    set_required_input(workflow, "68:48", "width", width, "Flux2Scheduler")
    set_required_input(workflow, "68:48", "height", height, "Flux2Scheduler")


def keep_flux_guidance_safe(workflow: dict) -> None:
    for node in workflow.values():
        if not isinstance(node, dict):
            continue
        inputs = node.get("inputs")
        if not isinstance(inputs, dict):
            continue
        class_type = str(node.get("class_type", "")).lower()
        for key in ["guidance", "flux_guidance"]:
            if key in inputs and isinstance(inputs[key], (int, float)) and inputs[key] > 20:
                inputs[key] = 4
        if "fluxguidance" in class_type:
            for key, value in list(inputs.items()):
                if isinstance(value, (int, float)) and value > 20:
                    inputs[key] = 4


def prepare_workflow(
    workflow_path: Path,
    image_rel: str,
    mask_rel: str,
    prompt: str,
    seed: int,
    width: int,
    height: int,
    prefix: str,
) -> dict:
    workflow = copy.deepcopy(read_json(workflow_path))
    validate_flux2_reference_graph(workflow)
    set_required_input(workflow, "46", "image", image_rel, "LoadImage")
    set_required_input(workflow, "126", "image", mask_rel, "LoadImage")
    set_required_input(workflow, "68:6", "text", prompt, "CLIPTextEncode")
    set_required_input(workflow, "68:25", "noise_seed", seed, "RandomNoise")
    set_required_input(workflow, "9", "filename_prefix", prefix, "SaveImage")
    configure_output_size(workflow, width, height)
    keep_flux_guidance_safe(workflow)
    validate_flux2_reference_graph(workflow)
    return workflow


def submit_comfy_workflow(comfy_url: str, workflow: dict) -> str:
    try:
        result = http_json(
            f"{comfy_url.rstrip('/')}/prompt",
            {"prompt": workflow, "client_id": str(uuid.uuid4())},
            timeout=30,
        )
    except HTTPJSONError as exc:
        raise RuntimeError(f"ComfyUI rejected workflow: {exc}") from exc
    if result.get("node_errors"):
        raise RuntimeError(f"ComfyUI rejected workflow with node_errors: {result['node_errors']}")
    prompt_id = result.get("prompt_id")
    if not prompt_id:
        raise RuntimeError(f"ComfyUI /prompt response did not include prompt_id: {result}")
    return prompt_id


def wait_for_comfy(comfy_url: str, prompt_id: str, cancel_event: Optional[Event], timeout_seconds: int = 3600) -> dict:
    start = time.time()
    while True:
        if cancel_event and cancel_event.is_set():
            raise JobCancelled("Job cancelled")
        if time.time() - start > timeout_seconds:
            raise TimeoutError(f"Timed out waiting for ComfyUI prompt {prompt_id}")
        history = http_json(f"{comfy_url.rstrip('/')}/history/{prompt_id}", timeout=20)
        if prompt_id in history:
            history_entry = history[prompt_id]
            raise_for_history_error(history_entry)
            status = history_entry.get("status", {}) if isinstance(history_entry, dict) else {}
            if isinstance(status, dict) and status.get("completed") is False:
                time.sleep(2)
                continue
            return history_entry
        time.sleep(2)


def raise_for_history_error(history_entry: dict) -> None:
    status = history_entry.get("status", {})
    status_str = status.get("status_str") if isinstance(status, dict) else None
    completed = status.get("completed") if isinstance(status, dict) else None
    messages = status.get("messages", []) if isinstance(status, dict) else []
    if isinstance(messages, list):
        for message in messages:
            if not isinstance(message, list) or len(message) < 2:
                continue
            event_name, payload = message[0], message[1]
            if event_name != "execution_error" or not isinstance(payload, dict):
                continue
            node_id = payload.get("node_id") or "unknown"
            node_type = payload.get("node_type") or "unknown"
            exception_type = payload.get("exception_type") or "unknown"
            exception_message = payload.get("exception_message") or payload.get("message") or "unknown"
            raise RuntimeError(
                "ComfyUI execution failed: "
                f"node_id={node_id}; node_type={node_type}; "
                f"exception_type={exception_type}; exception_message={exception_message}"
            )
    if status_str in {"error", "failed"}:
        raise RuntimeError(
            f"ComfyUI execution failed: status_str={status_str}; completed={completed}; "
            f"messages={json.dumps(messages, ensure_ascii=False)}"
        )


def execution_cached_nodes(history_entry: dict) -> List[str]:
    nodes: List[str] = []
    status = history_entry.get("status", {})
    messages = status.get("messages", []) if isinstance(status, dict) else []
    if isinstance(messages, list):
        for message in messages:
            if not isinstance(message, list) or len(message) < 2:
                continue
            event_name, payload = message[0], message[1]
            if event_name != "execution_cached" or not isinstance(payload, dict):
                continue
            for node_id in payload.get("nodes", []) or []:
                nodes.append(str(node_id))
    if not nodes and "execution_cached" in json.dumps(history_entry, ensure_ascii=False):
        nodes.append("__unknown__")
    return nodes


def collect_diffusion_output_candidates(history_entry: dict, comfy_output_root: Path) -> List[dict]:
    outputs = history_entry.get("outputs", {})
    candidates: List[dict] = []
    if isinstance(outputs, dict):
        for node_id, output in outputs.items():
            if not isinstance(output, dict):
                continue
            for image in output.get("images", []) or []:
                if not isinstance(image, dict):
                    continue
                filename = image.get("filename")
                if not filename:
                    continue
                subfolder = image.get("subfolder") or ""
                image_type = image.get("type") or "output"
                base = comfy_output_root if image_type == "output" else comfy_output_root.parent / image_type
                path = (base / subfolder / filename).resolve()
                candidates.append(
                    {
                        "node_id": node_id,
                        "filename": filename,
                        "subfolder": subfolder,
                        "type": image_type,
                        "path": path,
                        "exists": path.exists(),
                    }
                )
    return candidates


def require_existing_diffusion_output(
    history_entry: dict,
    comfy_output_root: Path,
    save_node_id: str = "9",
) -> tuple[Path, List[dict], bool, List[str]]:
    raise_for_history_error(history_entry)
    cached_nodes = execution_cached_nodes(history_entry)
    cached = bool(cached_nodes)
    candidates = collect_diffusion_output_candidates(history_entry, comfy_output_root)
    printable = [
        {**candidate, "path": str(candidate["path"])}
        for candidate in candidates
    ]
    print(f"[massive_production] execution_cached={cached} cached_nodes={cached_nodes}")
    print(f"[massive_production] history output candidates={json.dumps(printable, ensure_ascii=False)}")
    if save_node_id in cached_nodes:
        raise RuntimeError(f"ComfyUI cached SaveImage node {save_node_id}; diffusion did not produce a new output.")
    save_candidates = [candidate for candidate in candidates if str(candidate["node_id"]) == save_node_id]
    selected_candidates = save_candidates or candidates
    if not selected_candidates:
        status = history_entry.get("status", {})
        if isinstance(status, dict) and status.get("status_str") == "success" and status.get("completed") is True:
            raise RuntimeError("ComfyUI completed successfully but history has no output image info.")
        raise RuntimeError("ComfyUI history has no output image info.")
    existing = [candidate["path"] for candidate in selected_candidates if candidate["exists"]]
    if existing:
        return max(existing, key=lambda path: path.stat().st_mtime), candidates, cached, cached_nodes
    raise RuntimeError("ComfyUI reported success but output file does not exist.")


@dataclass
class ProductionConfig:
    n: int
    variations: int = 1
    width: int = 512
    height: int = 512
    workflow: Path = DEFAULT_WORKFLOW
    comfy_url: str = DEFAULT_COMFY_URL
    comfy_input_dir: Path = Path("")
    output_root: Path = Path("synthetic_data_meter_V1")
    overwrite: bool = False
    start_index: int = 0


@dataclass
class ProductionStatus:
    status: str = "idle"
    current_image_index: int = 0
    total_images: int = 0
    current_variation: int = 0
    variations_per_cg: int = 1
    completed_count: int = 0
    failed_count: int = 0
    progress: float = 0.0
    estimated_remaining_seconds: int = 0
    latest_cg_image: str = ""
    latest_comfy_output_prefix: str = ""
    message: str = ""
    started_at: str = ""
    finished_at: str = ""
    cancelled: bool = False
    current_prompt: str = ""
    current_diffusion_seed: Optional[int] = None
    current_output_filename: str = ""
    current_output_directory: str = ""
    latest_diffusion_image: str = ""
    output_root: str = ""
    comfy_output_directory: str = ""
    manifest_path: str = ""
    elapsed_seconds: int = 0
    average_seconds_per_output: float = 0.0
    cg_count: int = 0
    metadata_count: int = 0
    diffusion_count: int = 0
    current_cg_export_attempt: int = 0
    current_cg_seed_used: str = ""
    cg_export_attempts: int = 0
    failed_indices: List[int] = field(default_factory=list)
    gallery: List[dict] = field(default_factory=list)


class ProductionRunner:
    def __init__(
        self,
        config: ProductionConfig,
        cancel_event: Optional[Event] = None,
        status_callback: Optional[Callable[[ProductionStatus], None]] = None,
    ) -> None:
        self.config = config
        self.cancel_event = cancel_event or Event()
        self.status_callback = status_callback
        self.status = ProductionStatus(total_images=config.n, variations_per_cg=config.variations)
        self.records: List[dict] = []
        self.dirs = ensure_dataset_dirs(config.output_root)
        self.manifest_path = self.dirs["manifest"] / "production_manifest.json"
        self.started_monotonic = 0.0
        if config.start_index > 0 and self.manifest_path.exists():
            existing_manifest = read_json(self.manifest_path)
            existing_records = existing_manifest.get("records", []) if isinstance(existing_manifest, dict) else []
            if not isinstance(existing_records, list):
                raise ValueError(f"Existing manifest records are invalid: {self.manifest_path}")
            self.records = existing_records

    def comfy_output_root(self) -> Path:
        return self.config.comfy_input_dir.parent / "output"

    def output_directory_for_prefix(self, prefix: str) -> Path:
        return self.comfy_output_root() / Path(prefix).parent

    def update(self, **kwargs: Any) -> None:
        for key, value in kwargs.items():
            setattr(self.status, key, value)
        total_steps = max(1, self.config.n * max(1, self.config.variations))
        done_steps = self.status.completed_count + self.status.failed_count
        self.status.progress = min(1.0, done_steps / total_steps)
        remaining_steps = max(0, total_steps - done_steps)
        elapsed = int(time.time() - self.started_monotonic) if self.started_monotonic else 0
        self.status.elapsed_seconds = elapsed
        if done_steps > 0 and elapsed > 0:
            avg = elapsed / done_steps
            self.status.average_seconds_per_output = round(avg, 2)
            self.status.estimated_remaining_seconds = int(remaining_steps * avg)
        else:
            self.status.estimated_remaining_seconds = remaining_steps * DIFFUSION_TIME_SECONDS
            if self.status.status == "generating_cg":
                self.status.estimated_remaining_seconds += max(0, self.config.n - self.status.current_image_index) * CG_TIME_SECONDS
        self.status.cg_count = len(list(self.dirs["cg"].glob("*.png"))) if self.dirs["cg"].exists() else 0
        self.status.metadata_count = len(list(self.dirs["metadata"].glob("*.json"))) if self.dirs["metadata"].exists() else 0
        self.status.diffusion_count = self.status.completed_count
        self.status.output_root = str(self.config.output_root.resolve())
        self.status.comfy_output_directory = str(self.comfy_output_root().resolve())
        self.status.manifest_path = str(self.manifest_path.resolve())
        if self.status_callback:
            self.status_callback(self.status)

    def save_manifest(self) -> None:
        write_json(
            self.manifest_path,
            {
                "created_at": self.status.started_at,
                "updated_at": utc_now(),
                "config": {
                    "n": self.config.n,
                    "variations": self.config.variations,
                    "width": self.config.width,
                    "height": self.config.height,
                    "workflow": str(self.config.workflow),
                    "comfy_url": self.config.comfy_url,
                    "comfy_input_dir": str(self.config.comfy_input_dir),
                    "output_root": str(self.config.output_root),
                    "start_index": self.config.start_index,
                },
                "records": self.records,
            },
        )

    def finish_cancelled(self, message: str = "Cancelled") -> ProductionStatus:
        self.update(status="cancelled", cancelled=True, finished_at=utc_now(), message=message)
        self.save_manifest()
        return self.status

    def run(self) -> ProductionStatus:
        cfg = self.config
        self.started_monotonic = time.time()
        self.update(status="checking", started_at=utc_now(), message="Checking inputs")
        if not cfg.workflow.exists():
            raise FileNotFoundError(f"Workflow file not found: {cfg.workflow}")
        if not cfg.comfy_input_dir:
            raise ValueError("comfy_input_dir is required")
        if output_has_existing_data(cfg.output_root) and not cfg.overwrite and cfg.start_index == 0:
            raise FileExistsError(f"Output root already contains data: {cfg.output_root}. Enable overwrite or use resume start_index.")
        check_comfy_reachable(cfg.comfy_url)

        for index in range(cfg.start_index, cfg.start_index + cfg.n):
            if self.cancel_event.is_set():
                return self.finish_cancelled()

            stem = f"meter_{index:04d}"
            seed_text = stem
            dataset_cg_path = self.dirs["cg"] / f"{stem}.png"
            dataset_mask_path = self.dirs["masks"] / f"{stem}_mask.png"
            metadata_path = self.dirs["metadata"] / f"{stem}.json"
            prompt_path = self.dirs["prompts"] / f"{stem}.txt"
            comfy_rel = f"cg_meters/{stem}.png"
            mask_rel = f"cg_meters/{stem}_mask.png"

            try:
                self.update(status="generating_cg", current_image_index=index, current_variation=0, message=f"Generating CG {stem}")
                def on_cg_attempt(attempt: int, actual_seed: str) -> None:
                    self.update(
                        status="generating_cg",
                        current_image_index=index,
                        current_cg_export_attempt=attempt,
                        current_cg_seed_used=actual_seed,
                        message=f"Generating CG {stem}, attempt {attempt}, seed {actual_seed}",
                    )

                comfy_cg_path, cg_export_info = generate_cg_image(
                    index=index,
                    width=cfg.width,
                    height=cfg.height,
                    requested_seed=seed_text,
                    comfy_input_dir=cfg.comfy_input_dir,
                    dataset_cg_path=dataset_cg_path,
                    dataset_mask_path=dataset_mask_path,
                    metadata_path=metadata_path,
                    attempt_callback=on_cg_attempt,
                )
                self.update(
                    latest_cg_image=str(dataset_cg_path),
                    cg_export_attempts=cg_export_info["cg_export_attempts"],
                    current_cg_seed_used=cg_export_info["cg_seed_used"],
                )

                prompt = generate_prompt(seed=index)
                prompt_path.write_text(prompt + "\n", encoding="utf-8")
                comfy_mask_path = Path(cg_export_info["cg_mask_comfy_absolute_path"])

                for variation in range(cfg.variations):
                    if self.cancel_event.is_set():
                        return self.finish_cancelled()

                    started_at = utc_now()
                    diffusion_seed = random.Random(f"{index}-{variation}").randrange(0, 2**32)
                    prefix = f"{cfg.output_root.name}/diffusion_outputs/flux_{stem}_var{variation}"
                    expected_output_directory = self.output_directory_for_prefix(prefix)
                    cache_buster = f"{stem}_var{variation}_{uuid.uuid4().hex}"
                    final_prompt = append_cache_buster(prompt, cache_buster)
                    variation_prompt_path = self.dirs["prompts"] / f"{stem}_var{variation}.txt"
                    variation_prompt_path.write_text(final_prompt + "\n", encoding="utf-8")
                    workflow_debug_path = self.dirs["debug_workflows"] / f"workflow_{stem}_var{variation}.json"
                    record = {
                        "index": index,
                        "variation_index": variation,
                        "cg_image_absolute_path": str(comfy_cg_path.resolve()),
                        "cg_image_comfy_relative_path": comfy_rel,
                        "cg_mask_comfy_relative_path": mask_rel,
                        "cg_mask_absolute_path": cg_export_info["cg_mask_absolute_path"],
                        "cg_mask_comfy_absolute_path": cg_export_info["cg_mask_comfy_absolute_path"],
                        "cg_metadata_path": str(metadata_path.resolve()),
                        "requested_seed": cg_export_info["requested_seed"],
                        "cg_seed_used": cg_export_info["cg_seed_used"],
                        "cg_export_attempts": cg_export_info["cg_export_attempts"],
                        "cg_export_error_log": cg_export_info["cg_export_error_log"],
                        "prompt": final_prompt,
                        "prompt_path": str(variation_prompt_path.resolve()),
                        "diffusion_seed": diffusion_seed,
                        "comfy_output_prefix": prefix,
                        "expected_output_directory": str(expected_output_directory.resolve()),
                        "workflow_debug_path": str(workflow_debug_path.resolve()),
                        "prompt_id": "",
                        "execution_cached": None,
                        "execution_cached_nodes": [],
                        "history_output_images": [],
                        "diffusion_output_path": "",
                        "status": "running",
                        "error_message": "",
                        "started_at": started_at,
                        "finished_at": "",
                    }
                    self.records.append(record)
                    self.save_manifest()

                    try:
                        validate_reference_pair(
                            comfy_cg_path,
                            comfy_mask_path,
                            cfg.width,
                            cfg.height,
                            f"pre-submit {stem}",
                        )
                        self.update(
                            status="submitting_comfy",
                            current_image_index=index,
                            current_variation=variation,
                            latest_comfy_output_prefix=prefix,
                            current_prompt=final_prompt,
                            current_diffusion_seed=diffusion_seed,
                            current_output_filename=f"{Path(prefix).name}_*.png",
                            current_output_directory=str(expected_output_directory.resolve()),
                            message=f"Submitting {stem} variation {variation}",
                        )
                        workflow = prepare_workflow(
                            cfg.workflow,
                            comfy_rel,
                            mask_rel,
                            final_prompt,
                            diffusion_seed,
                            cfg.width,
                            cfg.height,
                            prefix,
                        )
                        write_json(workflow_debug_path, workflow)
                        prompt_id = submit_comfy_workflow(cfg.comfy_url, workflow)
                        record["prompt_id"] = prompt_id
                        print(f"[massive_production] prompt_id={prompt_id}")
                        print(f"[massive_production] workflow_debug_path={workflow_debug_path.resolve()}")
                        self.update(status="waiting_comfy", message=f"Waiting for ComfyUI prompt {prompt_id}")
                        history = wait_for_comfy(cfg.comfy_url, prompt_id, self.cancel_event)
                        diffusion_path, output_candidates, execution_cached, cached_nodes = require_existing_diffusion_output(
                            history,
                            self.comfy_output_root(),
                            save_node_id="9",
                        )
                        record["execution_cached"] = execution_cached
                        record["execution_cached_nodes"] = cached_nodes
                        record["history_output_images"] = [
                            {
                                **candidate,
                                "path": str(candidate["path"]),
                            }
                            for candidate in output_candidates
                        ]
                        dataset_diffusion_path = self.dirs["diffusion_outputs"] / diffusion_path.name
                        if dataset_diffusion_path.resolve() != diffusion_path.resolve():
                            shutil.copy2(diffusion_path, dataset_diffusion_path)
                        record["comfy_diffusion_output_path"] = str(diffusion_path)
                        record["diffusion_output_path"] = str(dataset_diffusion_path.resolve())
                        self.status.latest_diffusion_image = str(dataset_diffusion_path.resolve())
                        self.status.current_output_filename = dataset_diffusion_path.name
                        print(f"[massive_production] output filename={diffusion_path.name}")
                        print(f"[massive_production] resolved output path={diffusion_path}")
                        print(f"[massive_production] output exists={diffusion_path.exists()}")
                        record["status"] = "completed"
                        record["finished_at"] = utc_now()
                        self.status.gallery.append(
                            {
                                "index": index,
                                "variation_index": variation,
                                "cg_image": str(dataset_cg_path.resolve()),
                                "diffusion_image": str(dataset_diffusion_path.resolve()),
                                "status": "completed",
                            }
                        )
                        self.update(completed_count=self.status.completed_count + 1, status="running", message=f"Completed {stem} var {variation}")
                    except JobCancelled:
                        record["status"] = "cancelled"
                        record["error_message"] = "Job cancelled"
                        record["finished_at"] = utc_now()
                        self.save_manifest()
                        return self.finish_cancelled()
                    except Exception as exc:
                        record["status"] = "failed"
                        record["error_message"] = str(exc)
                        record["finished_at"] = utc_now()
                        failed_indices = list(dict.fromkeys([*self.status.failed_indices, index]))
                        self.update(
                            failed_count=self.status.failed_count + 1,
                            failed_indices=failed_indices,
                            status="running",
                            message=f"Failed {stem} var {variation}: {exc}",
                        )
                    finally:
                        self.save_manifest()

            except JobCancelled:
                return self.finish_cancelled()
            except Exception as exc:
                cg_error_log = exc.error_log if isinstance(exc, CGExportError) else []
                cg_attempts = exc.attempts if isinstance(exc, CGExportError) else 0
                requested_seed = exc.requested_seed if isinstance(exc, CGExportError) else seed_text
                failed_indices = list(dict.fromkeys([*self.status.failed_indices, index]))
                self.records.append(
                    {
                        "index": index,
                        "variation_index": -1,
                        "cg_image_absolute_path": str(dataset_cg_path.resolve()),
                        "cg_image_comfy_relative_path": comfy_rel,
                        "cg_mask_comfy_relative_path": mask_rel,
                        "cg_mask_absolute_path": str(dataset_mask_path.resolve()),
                        "cg_mask_comfy_absolute_path": str((cfg.comfy_input_dir / mask_rel).resolve()),
                        "cg_metadata_path": str(metadata_path.resolve()),
                        "requested_seed": requested_seed,
                        "cg_seed_used": "",
                        "cg_export_attempts": cg_attempts,
                        "cg_export_error_log": cg_error_log,
                        "prompt": "",
                        "diffusion_seed": None,
                        "comfy_output_prefix": "",
                        "expected_output_directory": str((cfg.output_root / "diffusion_outputs").resolve()),
                        "status": "failed",
                        "error_message": str(exc),
                        "started_at": utc_now(),
                        "finished_at": utc_now(),
                    }
                )
                self.update(
                    failed_count=self.status.failed_count + max(1, cfg.variations),
                    failed_indices=failed_indices,
                    status="running",
                    message=f"Failed CG {stem} after {cg_attempts or 'unknown'} attempts: {exc}",
                )
                self.save_manifest()

        final_status = "completed_with_failures" if self.status.failed_count else "completed"
        final_message = "Production completed with failures" if self.status.failed_count else "Production completed"
        self.update(status=final_status, finished_at=utc_now(), message=final_message)
        self.save_manifest()
        return self.status


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run local synthetic water meter production.")
    parser.add_argument("--n", type=int, required=True)
    parser.add_argument("--variations", type=int, default=1)
    parser.add_argument("--width", type=int, default=512)
    parser.add_argument("--height", type=int, default=512)
    parser.add_argument("--workflow", type=Path, default=DEFAULT_WORKFLOW)
    parser.add_argument("--comfy-url", default=DEFAULT_COMFY_URL)
    parser.add_argument("--comfy-input-dir", type=Path, required=True)
    parser.add_argument("--output-root", type=Path, default=Path("synthetic_data_meter_V1"))
    parser.add_argument("--overwrite", action="store_true")
    parser.add_argument("--start-index", type=int, default=0)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    config = ProductionConfig(
        n=args.n,
        variations=args.variations,
        width=args.width,
        height=args.height,
        workflow=args.workflow,
        comfy_url=args.comfy_url,
        comfy_input_dir=args.comfy_input_dir,
        output_root=args.output_root,
        overwrite=args.overwrite,
        start_index=args.start_index,
    )
    runner = ProductionRunner(config)
    try:
        status = runner.run()
        print(json.dumps(status.__dict__, indent=2))
    except Exception as exc:
        print(f"Production failed: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
