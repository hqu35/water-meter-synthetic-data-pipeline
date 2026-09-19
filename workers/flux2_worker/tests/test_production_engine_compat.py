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
    validate_comfy_workflow_dependencies,
    validate_reference_pair,
)


def flux_workflow_with_object_info(turbo_enabled: bool, missing_models: set[str]) -> tuple[dict, dict]:
    workflow = json.loads((WORKER_ROOT / "workflow/image_flux2_api.json").read_text())
    workflow["68:94"]["inputs"]["value"] = turbo_enabled
    model_input_names = {"ckpt_name", "unet_name", "clip_name", "vae_name", "lora_name", "control_net_name"}
    inventory: dict[str, dict[str, set[str]]] = {}
    for node in workflow.values():
        class_type = str(node["class_type"])
        class_inventory = inventory.setdefault(class_type, {})
        for name, value in (node.get("inputs") or {}).items():
            if name not in model_input_names or not isinstance(value, str):
                continue
            available_values = class_inventory.setdefault(name, set())
            if value not in missing_models:
                available_values.add(value)
    object_info = {}
    for class_type in {str(node["class_type"]) for node in workflow.values()}:
        required = {
            name: [sorted(values)]
            for name, values in inventory.get(class_type, {}).items()
        }
        object_info[class_type] = {
            "input": {"required": required},
            "output_node": class_type == "SaveImage",
        }
    return workflow, object_info


class ProductionEngineCompatibilityTests(unittest.TestCase):
    def test_preflight_turbo_disabled_allows_missing_lora(self) -> None:
        lora = "Flux_2-Turbo-LoRA_comfyui.safetensors"
        workflow, object_info = flux_workflow_with_object_info(False, {lora})
        with mock.patch("production_engine.http_json", return_value=object_info):
            report = validate_comfy_workflow_dependencies("http://comfy.test", workflow)
        self.assertNotIn(lora, report["required_models"])
        self.assertIn(lora, report["optional_models"])
        self.assertIn(lora, report["missing_optional_models"])

    def test_preflight_turbo_enabled_rejects_missing_lora(self) -> None:
        lora = "Flux_2-Turbo-LoRA_comfyui.safetensors"
        workflow, object_info = flux_workflow_with_object_info(True, {lora})
        with mock.patch("production_engine.http_json", return_value=object_info):
            with self.assertRaisesRegex(RuntimeError, "missing model files.*Flux_2-Turbo-LoRA"):
                validate_comfy_workflow_dependencies("http://comfy.test", workflow)

    def test_preflight_turbo_enabled_accepts_available_lora(self) -> None:
        lora = "Flux_2-Turbo-LoRA_comfyui.safetensors"
        workflow, object_info = flux_workflow_with_object_info(True, set())
        with mock.patch("production_engine.http_json", return_value=object_info):
            report = validate_comfy_workflow_dependencies("http://comfy.test", workflow)
        self.assertIn(lora, report["required_models"])
        self.assertNotIn(lora, report["optional_models"])

    def test_preflight_rejects_missing_active_base_model(self) -> None:
        base_model = "flux2_dev_fp8mixed.safetensors"
        workflow, object_info = flux_workflow_with_object_info(False, {base_model})
        with mock.patch("production_engine.http_json", return_value=object_info):
            with self.assertRaisesRegex(RuntimeError, "missing model files.*flux2_dev_fp8mixed"):
                validate_comfy_workflow_dependencies("http://comfy.test", workflow)

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
        history = {
            "status": {"status_str": "success", "completed": True, "messages": []},
            "outputs": {
                "9": {
                    "images": [{
                        "filename": "result.png",
                        "subfolder": "water_meter_pipeline/demo_001/flux2/sample_000001",
                        "type": "output",
                    }]
                }
            },
        }
        candidate, candidates, cached, cached_nodes = require_existing_diffusion_output(
            history,
            save_node_id="9",
        )
        self.assertEqual(candidate["filename"], "result.png")
        self.assertEqual(len(candidates), 1)
        self.assertFalse(cached)
        self.assertEqual(cached_nodes, [])

    def test_resume_preserves_existing_manifest_records(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manifest = root / "demo_001/batch_manifest.json"
            manifest.parent.mkdir(parents=True)
            sample = {"seed": "meter_0000", "flux2": {"status": "completed"}}
            manifest.write_text(json.dumps({"samples": {"sample_000001": sample}}))
            runner = ProductionRunner(ProductionConfig(n=1, output_root=root, batch_id="demo_001", start_index=1))
            self.assertEqual(runner.samples["sample_000001"], sample)

    def test_flux_manifest_write_preserves_qwen_branch(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manifest_path = root / "demo_001/batch_manifest.json"
            manifest_path.parent.mkdir(parents=True)
            manifest_path.write_text(json.dumps({
                "batch_id": "demo_001",
                "samples": {"sample_000001": {"qwen": {"status": "completed"}}},
            }))
            runner = ProductionRunner(ProductionConfig(n=1, output_root=root, batch_id="demo_001"))
            runner.samples["sample_000001"]["flux2"] = {"status": "completed"}
            runner.save_manifest()
            saved = json.loads(manifest_path.read_text())
            self.assertEqual(saved["samples"]["sample_000001"]["qwen"]["status"], "completed")
            self.assertEqual(saved["samples"]["sample_000001"]["flux2"]["status"], "completed")

    def test_cache_buster_cannot_be_duplicated(self) -> None:
        prompt = append_cache_buster("prompt", "one")
        self.assertEqual(prompt.count("CACHE_BUSTER:"), 1)
        with self.assertRaisesRegex(ValueError, "already contains"):
            append_cache_buster(prompt, "two")

    def test_portable_batch_manifest_and_output_layout(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            config = ProductionConfig(n=1, width=64, height=64, output_root=root, batch_id="portable_test")
            runner = ProductionRunner(config)
            cg_dir = root / "portable_test/cg/sample_000001"
            cg_dir.mkdir(parents=True, exist_ok=True)
            rgb = Image.new("RGBA", (64, 64), (60, 100, 150, 255))
            ImageDraw.Draw(rgb).rectangle((16, 16, 47, 47), fill=(210, 215, 220, 255))
            rgb.save(cg_dir / "image.png")
            mask = Image.new("RGBA", (64, 64), (255, 255, 255, 255))
            ImageDraw.Draw(mask).ellipse((8, 8, 55, 55), fill=(0, 0, 0, 255))
            mask.save(cg_dir / "image_mask.png")
            (cg_dir / "metadata.json").write_text(json.dumps({"seed": "meter_0000"}))

            history = {
                "status": {"status_str": "success", "completed": True, "messages": []},
                "outputs": {"9": {"images": [{"filename": "result.png", "subfolder": "remote", "type": "output"}]}},
            }

            def fake_download(_url: str, _candidate: dict, destination: Path) -> None:
                destination.parent.mkdir(parents=True, exist_ok=True)
                Image.new("RGB", (64, 64), (30, 60, 90)).save(destination)

            with mock.patch("production_engine.check_comfy_reachable"), \
                    mock.patch("production_engine.validate_comfy_workflow_dependencies"), \
                    mock.patch("production_engine.upload_comfy_image", side_effect=lambda _url, path, sub: f"{sub}/{path.name}"), \
                    mock.patch("production_engine.submit_comfy_workflow", return_value="prompt-1"), \
                    mock.patch("production_engine.wait_for_comfy", return_value=history), \
                    mock.patch("production_engine.download_comfy_image", side_effect=fake_download):
                status = runner.run()

            self.assertEqual(status.status, "completed")
            output = root / "portable_test/ai_augmented/flux2/sample_000001/image.png"
            self.assertTrue(output.is_file())
            manifest = json.loads((root / "portable_test/batch_manifest.json").read_text())
            sample = manifest["samples"]["sample_000001"]
            self.assertEqual(sample["cg"]["image"], "cg/sample_000001/image.png")
            self.assertEqual(sample["flux2"]["variations"][0]["image"], "ai_augmented/flux2/sample_000001/image.png")
            self.assertFalse(Path(sample["cg"]["image"]).is_absolute())
            self.assertFalse(Path(sample["flux2"]["variations"][0]["image"]).is_absolute())


if __name__ == "__main__":
    unittest.main()
