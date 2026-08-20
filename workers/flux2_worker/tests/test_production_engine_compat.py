from __future__ import annotations

import io
import json
import sys
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

from PIL import Image, ImageDraw


WORKER_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(WORKER_ROOT))

from flux2_prompt_generator import generate_prompt  # noqa: E402
from production_engine import (  # noqa: E402
    HTTPJSONError,
    ProductionConfig,
    ProductionRunner,
    append_cache_buster,
    http_json,
    prepare_workflow,
    require_existing_diffusion_output,
    raise_for_history_error,
    validate_reference_pair,
)


class ProductionEngineCompatibilityTests(unittest.TestCase):
    def test_dual_reference_runtime_workflow(self) -> None:
        prompt = generate_prompt(0, "outdoor_soil")
        final_prompt = append_cache_buster(prompt, "meter_0000_var0_test")
        workflow = prepare_workflow(
            WORKER_ROOT / "workflow/image_flux2_api.json",
            "cg_meters/meter_0000.png",
            "cg_meters/meter_0000_mask.png",
            final_prompt,
            123456,
            512,
            512,
            "flux2_dataset/diffusion_outputs/flux_meter_0000_var0",
        )
        self.assertEqual(workflow["46"]["inputs"]["image"], "cg_meters/meter_0000.png")
        self.assertEqual(workflow["126"]["inputs"]["image"], "cg_meters/meter_0000_mask.png")
        self.assertEqual(workflow["68:22"]["inputs"]["conditioning"], ["68:128", 0])
        self.assertEqual(workflow["68:25"]["inputs"]["noise_seed"], 123456)
        self.assertEqual(workflow["9"]["inputs"]["filename_prefix"], "flux2_dataset/diffusion_outputs/flux_meter_0000_var0")
        self.assertEqual(workflow["68:133"]["inputs"]["image"], ["46", 0])
        self.assertEqual(workflow["68:47"]["inputs"]["width"], ["68:133", 0])
        self.assertEqual(workflow["68:47"]["inputs"]["height"], ["68:133", 1])
        self.assertEqual(workflow["68:48"]["inputs"]["width"], ["68:133", 0])
        self.assertEqual(workflow["68:48"]["inputs"]["height"], ["68:133", 1])
        self.assertEqual(workflow["68:6"]["inputs"]["text"].count("CACHE_BUSTER:"), 1)
        for section in [
            "SPATIAL REFERENCE:",
            "STRUCTURE AND ANNOTATIONS:",
            "PHOTOREALISTIC AUGMENTATION:",
            "ENVIRONMENT:",
            "PROHIBITED CHANGES:",
        ]:
            self.assertIn(section, workflow["68:6"]["inputs"]["text"])

    def test_reference_pair_validation(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            rgb_path = root / "meter_0000.png"
            mask_path = root / "meter_0000_mask.png"
            rgb = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
            draw = ImageDraw.Draw(rgb)
            draw.rectangle((12, 12, 51, 51), fill=(60, 100, 150, 255))
            draw.ellipse((20, 20, 43, 43), fill=(210, 215, 220, 255))
            rgb.save(rgb_path)
            mask = Image.new("RGBA", (64, 64), (255, 255, 255, 255))
            ImageDraw.Draw(mask).ellipse((10, 10, 53, 53), fill=(0, 0, 0, 255))
            mask.save(mask_path)
            image_stats, mask_stats = validate_reference_pair(rgb_path, mask_path, 64, 64, "test")
            self.assertEqual(image_stats["width"], mask_stats["width"])
            self.assertEqual(mask_stats["non_opaque_pixels"], 0)
            self.assertEqual(mask_stats["colored_pixels"], 0)

    def test_history_execution_error_is_actionable(self) -> None:
        history = {
            "status": {
                "status_str": "error",
                "completed": False,
                "messages": [["execution_error", {
                    "node_id": "68:13",
                    "node_type": "SamplerCustomAdvanced",
                    "exception_type": "torch.OutOfMemoryError",
                    "exception_message": "CUDA out of memory",
                }]],
            }
        }
        with self.assertRaisesRegex(RuntimeError, "torch.OutOfMemoryError.*CUDA out of memory"):
            raise_for_history_error(history)

    def test_http_error_body_is_preserved(self) -> None:
        body = json.dumps({
            "error": {"type": "prompt_invalid", "message": "invalid image file"},
            "node_errors": {"126": {"errors": ["missing mask"]}},
        }).encode()
        error = urllib.error.HTTPError(
            "http://127.0.0.1:8188/prompt",
            400,
            "Bad Request",
            {},
            io.BytesIO(body),
        )
        with mock.patch("urllib.request.urlopen", side_effect=error):
            with self.assertRaises(HTTPJSONError) as raised:
                http_json("http://127.0.0.1:8188/prompt", {"prompt": {}})
        message = str(raised.exception)
        self.assertIn("HTTP 400", message)
        self.assertIn("prompt_invalid", message)
        self.assertIn("126", message)

    def test_output_extraction_uses_current_save_node(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            output_root = Path(temp_dir)
            output_file = output_root / "flux2_dataset/diffusion_outputs/result.png"
            output_file.parent.mkdir(parents=True)
            output_file.write_bytes(b"png-placeholder")
            history = {
                "status": {"status_str": "success", "completed": True, "messages": []},
                "outputs": {
                    "9": {
                        "images": [{
                            "filename": output_file.name,
                            "subfolder": "flux2_dataset/diffusion_outputs",
                            "type": "output",
                        }]
                    }
                },
            }
            path, candidates, cached, cached_nodes = require_existing_diffusion_output(
                history,
                output_root,
                save_node_id="9",
            )
            self.assertEqual(path, output_file.resolve())
            self.assertEqual(len(candidates), 1)
            self.assertFalse(cached)
            self.assertEqual(cached_nodes, [])

    def test_resume_preserves_existing_manifest_records(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manifest = root / "manifest/production_manifest.json"
            manifest.parent.mkdir(parents=True)
            manifest.write_text(json.dumps({"records": [{"index": 0, "status": "completed"}]}))
            runner = ProductionRunner(ProductionConfig(n=1, output_root=root, start_index=1))
            self.assertEqual(runner.records, [{"index": 0, "status": "completed"}])

    def test_cache_buster_cannot_be_duplicated(self) -> None:
        prompt = append_cache_buster("prompt", "one")
        self.assertEqual(prompt.count("CACHE_BUSTER:"), 1)
        with self.assertRaisesRegex(ValueError, "already contains"):
            append_cache_buster(prompt, "two")


if __name__ == "__main__":
    unittest.main()
