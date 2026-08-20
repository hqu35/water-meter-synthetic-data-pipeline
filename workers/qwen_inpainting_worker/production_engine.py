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

from qwen_background_prompt_generator import generate_prompt


PROJECT_ROOT = Path(__file__).resolve().parent
CG_EXPORTER_ROOT = PROJECT_ROOT.parents[1] / "shared_production" / "cg_exporter"
LOCAL_WORKFLOW = PROJECT_ROOT / "workflow/qwen_inpainting_api.json"
DEFAULT_WORKFLOW = LOCAL_WORKFLOW
CG_TIME_SECONDS = 3
DIFFUSION_TIME_SECONDS = 30


class CGExportError(RuntimeError):
    def __init__(self, message: str, error_log: List[str], attempts: int, requested_seed: str) -> None:
        super().__init__(message)
        self.error_log = error_log
        self.attempts = attempts
        self.requested_seed = requested_seed


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
    with urllib.request.urlopen(req, timeout=timeout) as response:
        raw = response.read().decode("utf-8")
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

    for _ in range(height):
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
            pixels += 1
            if alpha <= 8:
                transparent_pixels += 1
                continue
            rgb = recon[x:x + 3]
            for channel in range(3):
                mins[channel] = min(mins[channel], rgb[channel])
                maxs[channel] = max(maxs[channel], rgb[channel])
                sums[channel] += rgb[channel]
            if all(value >= 248 for value in rgb):
                white_pixels += 1
            if all(value <= 7 for value in rgb):
                black_pixels += 1
            visible_pixels += 1
        prev = recon

    if visible_pixels == 0:
        return {
            "width": width,
            "height": height,
            "pixels": pixels,
            "visible_pixels": visible_pixels,
            "transparent_ratio": transparent_pixels / pixels,
            "file_size": len(buffer),
            "mean_rgb": [0, 0, 0],
            "extrema": [(0, 0), (0, 0), (0, 0)],
            "white_ratio": 0,
            "black_ratio": 1,
            "nonwhite_ratio": 0,
            "nonblack_ratio": 0,
        }

    return {
        "width": width,
        "height": height,
        "pixels": pixels,
        "visible_pixels": visible_pixels,
        "transparent_ratio": transparent_pixels / pixels,
        "file_size": len(buffer),
        "mean_rgb": [value / visible_pixels for value in sums],
        "extrema": list(zip(mins, maxs)),
        "white_ratio": white_pixels / visible_pixels,
        "black_ratio": black_pixels / visible_pixels,
        "nonwhite_ratio": 1 - white_pixels / visible_pixels,
        "nonblack_ratio": 1 - black_pixels / visible_pixels,
    }


def validate_cg_png(path: Path, label: str) -> dict:
    if not path.exists():
        raise RuntimeError(f"{label} does not exist: {path}")
    stats = png_stats(path)
    print(f"[massive_production] {label} png stats={json.dumps(stats)}")
    if stats["white_ratio"] > 0.99:
        raise RuntimeError(f"{label} is blank/near-white: {json.dumps(stats)}")
    if stats["black_ratio"] > 0.99:
        raise RuntimeError(f"{label} is blank/near-black: {json.dumps(stats)}")
    channel_ranges = [maximum - minimum for minimum, maximum in stats["extrema"]]
    if all(value < 8 for value in channel_ranges):
        raise RuntimeError(f"{label} has low pixel variation: {json.dumps(stats)}")
    return stats


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
            comfy_stats = validate_cg_png(comfy_image_path, f"CG ComfyUI input {comfy_image_path.name}")
            if not comfy_mask_path.exists():
                raise RuntimeError(f"CG mask does not exist: {comfy_mask_path}")
            if not metadata_path.exists():
                raise RuntimeError(f"CG metadata does not exist: {metadata_path}")
            dataset_cg_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(comfy_image_path, dataset_cg_path)
            dataset_mask_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(comfy_mask_path, dataset_mask_path)
            dataset_stats = validate_cg_png(dataset_cg_path, f"dataset CG {dataset_cg_path.name}")
            print(f"[massive_production] CG export success index={index} attempt={attempt} actual_seed={actual_seed}")
            return comfy_image_path, {
                "requested_seed": requested_seed,
                "cg_seed_used": actual_seed,
                "cg_export_attempts": attempt,
                "cg_export_error_log": error_log,
                "cg_comfy_png_stats": comfy_stats,
                "cg_dataset_png_stats": dataset_stats,
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


def prepare_workflow(workflow_path: Path, image_rel: str, prompt: str, seed: int, width: int, height: int, prefix: str) -> dict:
    workflow = copy.deepcopy(read_json(workflow_path))
    mask_rel = image_rel.replace(".png", "_mask.png")
    set_if_exists(workflow, "71", "image", image_rel)
    set_if_exists(workflow, "266", "image", mask_rel)
    set_if_exists(workflow, "6", "text", prompt)
    set_if_exists(workflow, "3", "seed", seed)
    set_if_exists(workflow, "60", "filename_prefix", f"{prefix}_raw")
    set_if_exists(workflow, "163", "filename_prefix", prefix)
    set_if_exists(workflow, "263", "resize_type.width", width)
    set_if_exists(workflow, "263", "resize_type.height", height)
    return workflow


def submit_comfy_workflow(comfy_url: str, workflow: dict) -> str:
    result = http_json(f"{comfy_url.rstrip('/')}/prompt", {"prompt": workflow, "client_id": str(uuid.uuid4())}, timeout=30)
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
            raise RuntimeError("Job cancelled")
        if time.time() - start > timeout_seconds:
            raise TimeoutError(f"Timed out waiting for ComfyUI prompt {prompt_id}")
        history = http_json(f"{comfy_url.rstrip('/')}/history/{prompt_id}", timeout=20)
        if prompt_id in history:
            return history[prompt_id]
        time.sleep(2)


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


def require_existing_diffusion_output(history_entry: dict, comfy_output_root: Path) -> tuple[Path, List[dict], bool, List[str]]:
    cached_nodes = execution_cached_nodes(history_entry)
    cached = bool(cached_nodes)
    candidates = collect_diffusion_output_candidates(history_entry, comfy_output_root)
    printable = [
        {**candidate, "path": str(candidate["path"])}
        for candidate in candidates
    ]
    print(f"[massive_production] execution_cached={cached} cached_nodes={cached_nodes}")
    print(f"[massive_production] history output candidates={json.dumps(printable, ensure_ascii=False)}")
    if "163" in cached_nodes:
        raise RuntimeError("ComfyUI cached final SaveImage node 163; diffusion did not produce a new output.")
    if not candidates:
        raise RuntimeError("ComfyUI history has no output image info.")
    final_candidates = [candidate for candidate in candidates if str(candidate["node_id"]) == "163"]
    if not final_candidates:
        raise RuntimeError("ComfyUI history has no final Qwen output from SaveImage node 163.")
    existing = [candidate["path"] for candidate in final_candidates if candidate["exists"]]
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
    comfy_url: str = "http://127.0.0.1:8190"
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
                self.update(status="cancelled", cancelled=True, finished_at=utc_now(), message="Cancelled")
                self.save_manifest()
                return self.status

            stem = f"meter_{index:04d}"
            seed_text = stem
            dataset_cg_path = self.dirs["cg"] / f"{stem}.png"
            dataset_mask_path = self.dirs["masks"] / f"{stem}_mask.png"
            metadata_path = self.dirs["metadata"] / f"{stem}.json"
            prompt_path = self.dirs["prompts"] / f"{stem}.txt"
            comfy_rel = f"cg_meters/{stem}.png"

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

                for variation in range(cfg.variations):
                    if self.cancel_event.is_set():
                        raise RuntimeError("Job cancelled")

                    started_at = utc_now()
                    diffusion_seed = random.Random(f"{index}-{variation}").randrange(0, 2**32)
                    prefix = f"{cfg.output_root.name}/diffusion_outputs/qwen_{stem}_var{variation}"
                    expected_output_directory = self.output_directory_for_prefix(prefix)
                    cache_buster = f"{stem}_var{variation}_{uuid.uuid4().hex}"
                    final_prompt = f"{prompt}\nCACHE_BUSTER: {cache_buster}"
                    variation_prompt_path = self.dirs["prompts"] / f"{stem}_var{variation}.txt"
                    variation_prompt_path.write_text(final_prompt + "\n", encoding="utf-8")
                    workflow_debug_path = self.dirs["debug_workflows"] / f"workflow_{stem}_var{variation}.json"
                    record = {
                        "index": index,
                        "variation_index": variation,
                        "cg_image_absolute_path": str(comfy_cg_path.resolve()),
                        "cg_image_comfy_relative_path": comfy_rel,
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
                        workflow = prepare_workflow(cfg.workflow, comfy_rel, final_prompt, diffusion_seed, cfg.width, cfg.height, prefix)
                        write_json(workflow_debug_path, workflow)
                        prompt_id = submit_comfy_workflow(cfg.comfy_url, workflow)
                        record["prompt_id"] = prompt_id
                        print(f"[massive_production] prompt_id={prompt_id}")
                        print(f"[massive_production] workflow_debug_path={workflow_debug_path.resolve()}")
                        self.update(status="waiting_comfy", message=f"Waiting for ComfyUI prompt {prompt_id}")
                        history = wait_for_comfy(cfg.comfy_url, prompt_id, self.cancel_event)
                        diffusion_path, output_candidates, execution_cached, cached_nodes = require_existing_diffusion_output(history, self.comfy_output_root())
                        record["execution_cached"] = execution_cached
                        record["execution_cached_nodes"] = cached_nodes
                        record["history_output_images"] = [
                            {
                                **candidate,
                                "path": str(candidate["path"]),
                            }
                            for candidate in output_candidates
                        ]
                        record["diffusion_output_path"] = str(diffusion_path)
                        self.status.latest_diffusion_image = str(diffusion_path)
                        self.status.current_output_filename = diffusion_path.name
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
                                "diffusion_image": str(diffusion_path) if diffusion_path else "",
                                "status": "completed",
                            }
                        )
                        self.update(completed_count=self.status.completed_count + 1, status="running", message=f"Completed {stem} var {variation}")
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
                        "cg_mask_absolute_path": str(dataset_mask_path.resolve()),
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
                    failed_count=self.status.failed_count + 1,
                    failed_indices=failed_indices,
                    status="running",
                    message=f"Failed CG {stem} after {cg_attempts or 'unknown'} attempts: {exc}",
                )
                self.save_manifest()

        self.update(status="completed", finished_at=utc_now(), message="Production completed")
        self.save_manifest()
        return self.status


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run local synthetic water meter production.")
    parser.add_argument("--n", type=int, required=True)
    parser.add_argument("--variations", type=int, default=1)
    parser.add_argument("--width", type=int, default=512)
    parser.add_argument("--height", type=int, default=512)
    parser.add_argument("--workflow", type=Path, default=DEFAULT_WORKFLOW)
    parser.add_argument("--comfy-url", default="http://127.0.0.1:8188")
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
