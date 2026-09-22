from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from PIL import Image, ImageDraw


WORKER_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(WORKER_ROOT))

from qwen_background_prompt_generator import generate_prompt  # noqa: E402
from production_engine import ProductionConfig, ProductionRunner  # noqa: E402


class QwenPortabilityContractTests(unittest.TestCase):
    def test_prompt_requires_spatially_legible_environment(self) -> None:
        prompt = generate_prompt(0, "utility_room")
        self.assertIn("spatially legible installation environment rather than a backdrop", prompt)
        self.assertIn("at least three scene-appropriate geometric or semantic cues", prompt)
        self.assertIn("single-plane", prompt)
        self.assertIn("featureless gray or brown", prompt)
        self.assertIn("Environmental valves and fittings may appear", prompt)
        self.assertIn("protected CG meter", prompt)
        self.assertIn("must remain pixel-exact and unchanged", prompt)

    def test_portable_batch_manifest_and_mask_input(self) -> None:
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
                "outputs": {"163": {"images": [{"filename": "result.png", "subfolder": "remote", "type": "output"}]}},
            }
            submitted = {}

            def fake_submit(_url: str, workflow: dict) -> str:
                submitted.update(workflow)
                return "prompt-1"

            def fake_download(_url: str, _candidate: dict, destination: Path) -> None:
                destination.parent.mkdir(parents=True, exist_ok=True)
                Image.new("RGB", (64, 64), (30, 60, 90)).save(destination)

            with mock.patch("production_engine.check_comfy_reachable"), \
                    mock.patch("production_engine.validate_comfy_workflow_dependencies"), \
                    mock.patch("production_engine.upload_comfy_image", side_effect=lambda _url, path, sub: f"{sub}/{path.name}"), \
                    mock.patch("production_engine.submit_comfy_workflow", side_effect=fake_submit), \
                    mock.patch("production_engine.wait_for_comfy", return_value=history), \
                    mock.patch("production_engine.download_comfy_image", side_effect=fake_download):
                status = runner.run()

            self.assertEqual(status.status, "completed")
            self.assertTrue((root / "portable_test/ai_augmented/qwen/sample_000001/image.png").is_file())
            self.assertTrue(submitted["71"]["inputs"]["image"].endswith("/image.png"))
            self.assertTrue(submitted["266"]["inputs"]["image"].endswith("/image_mask.png"))
            manifest = json.loads((root / "portable_test/batch_manifest.json").read_text())
            sample = manifest["samples"]["sample_000001"]
            self.assertEqual(sample["cg"]["mask"], "cg/sample_000001/image_mask.png")
            self.assertEqual(sample["qwen"]["variations"][0]["image"], "ai_augmented/qwen/sample_000001/image.png")


if __name__ == "__main__":
    unittest.main()
