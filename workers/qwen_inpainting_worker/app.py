from __future__ import annotations

import json
import os
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, Optional

from production_engine import DEFAULT_WORKFLOW, ProductionConfig, ProductionRunner, ProductionStatus


HOST = os.environ.get("WORKER_HOST", "127.0.0.1")
PORT = int(os.environ.get("WORKER_PORT", "9001"))
PROJECT_ROOT = Path(__file__).resolve().parent
DEFAULT_COMFY_URL = os.environ.get("COMFY_URL", "http://127.0.0.1:8191")
DEFAULT_COMFY_INPUT_DIR = os.environ.get("COMFY_INPUT_DIR", "/home/ryanqu/ComfyUI/input")
DEFAULT_OUTPUT_ROOT = os.environ.get(
    "OUTPUT_ROOT",
    "/home/ryanqu/massive_production_version_2/qwen_inpainting_dataset",
)


class JobManager:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.thread: Optional[threading.Thread] = None
        self.cancel_event = threading.Event()
        self.status = ProductionStatus()
        self.error = ""

    def start(self, payload: Dict[str, Any]) -> None:
        with self.lock:
            if self.thread and self.thread.is_alive():
                raise RuntimeError("A production job is already running")
            self.cancel_event = threading.Event()
            self.error = ""
            config = ProductionConfig(
                n=int(payload.get("n", 20)),
                variations=int(payload.get("variations", 1)),
                width=int(payload.get("width", 512)),
                height=int(payload.get("height", 512)),
                workflow=Path(payload.get("workflow") or DEFAULT_WORKFLOW),
                comfy_url=str(payload.get("comfy_url") or DEFAULT_COMFY_URL),
                comfy_input_dir=Path(payload.get("comfy_input_dir") or DEFAULT_COMFY_INPUT_DIR),
                output_root=Path(payload.get("output_root") or DEFAULT_OUTPUT_ROOT),
                overwrite=bool(payload.get("overwrite", False)),
                start_index=int(payload.get("start_index", 0)),
            )
            self.status = ProductionStatus(total_images=config.n, variations_per_cg=config.variations, status="queued")
            runner = ProductionRunner(config, self.cancel_event, self._update_status)
            self.thread = threading.Thread(target=self._run, args=(runner,), daemon=True)
            self.thread.start()

    def _update_status(self, status: ProductionStatus) -> None:
        with self.lock:
            self.status = status
        print(f"[production] {status.status}: {status.message}", flush=True)

    def _run(self, runner: ProductionRunner) -> None:
        try:
            runner.run()
        except Exception as exc:
            with self.lock:
                self.error = str(exc)
                self.status.status = "failed"
                self.status.message = str(exc)
                self.status.finished_at = self.status.finished_at or ""
            print(f"[production] failed: {exc}", flush=True)

    def cancel(self) -> None:
        self.cancel_event.set()
        with self.lock:
            self.status.cancelled = True
            self.status.message = "Cancel requested"

    def snapshot(self) -> dict:
        with self.lock:
            data = dict(self.status.__dict__)
            data["error"] = self.error
            data["running"] = bool(self.thread and self.thread.is_alive())
            return data


JOB = JobManager()


HTML = f"""<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Qwen Inpainting Water Meter Production</title>
  <style>
    body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 28px; background: #111820; color: #eef3f8; }}
    .grid {{ display: grid; grid-template-columns: repeat(2, minmax(280px, 1fr)); gap: 14px 22px; max-width: 980px; }}
    label {{ display: grid; gap: 5px; font-size: 13px; color: #b9c7d6; }}
    input {{ padding: 9px 10px; border-radius: 6px; border: 1px solid #344252; background: #182231; color: #fff; }}
    button {{ padding: 10px 16px; margin-right: 10px; border: 0; border-radius: 6px; background: #2f80ed; color: white; font-weight: 700; cursor: pointer; }}
    button.cancel {{ background: #b42318; }}
    .panel {{ margin-top: 22px; padding: 18px; border: 1px solid #2a3746; border-radius: 8px; background: #151f2b; max-width: 980px; }}
    progress {{ width: 100%; height: 18px; }}
    .row {{ display: grid; grid-template-columns: 190px 1fr; gap: 10px; margin: 7px 0; }}
    img {{ max-width: 240px; border: 1px solid #3b4858; border-radius: 6px; background: #fff; }}
    img.preview {{ cursor: zoom-in; }}
    .previews {{ display: grid; grid-template-columns: repeat(2, minmax(220px, 1fr)); gap: 16px; }}
    .gallery {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 14px; }}
    .pair {{ border: 1px solid #2a3746; border-radius: 8px; padding: 10px; background: #101722; }}
    .pair-images {{ display: grid; grid-template-columns: 1fr 24px 1fr; align-items: center; gap: 7px; }}
    .pair img {{ width: 100%; max-width: none; }}
    .path {{ color: #a7d3ff; word-break: break-all; }}
    details {{ margin-top: 8px; }}
    summary {{ cursor: pointer; color: #cfe3ff; }}
    pre {{ white-space: pre-wrap; background: #0d131c; border: 1px solid #263344; padding: 10px; border-radius: 6px; max-height: 220px; overflow: auto; }}
    code {{ color: #a7d3ff; }}
  </style>
</head>
<body>
  <h1>Qwen Inpainting Water Meter Production</h1>
  <div class="grid">
    <label>Number of images N<input id="n" type="number" value="100"></label>
    <label>Variations per CG<input id="variations" type="number" value="1"></label>
    <label>Width<input id="width" type="number" value="512"></label>
    <label>Height<input id="height" type="number" value="512"></label>
    <label>ComfyUI URL<input id="comfy_url" value="{DEFAULT_COMFY_URL}"></label>
    <label>ComfyUI input directory<input id="comfy_input_dir" value="{DEFAULT_COMFY_INPUT_DIR}"></label>
    <label>Workflow API JSON path<input id="workflow" value="{DEFAULT_WORKFLOW}"></label>
    <label>Output dataset folder<input id="output_root" value="{DEFAULT_OUTPUT_ROOT}"></label>
    <label>Resume start_index<input id="start_index" type="number" value="0"></label>
    <label>Overwrite existing dataset<input id="overwrite" type="checkbox"></label>
  </div>
  <p style="margin-top:18px;">
    <button onclick="startJob()">Generate</button>
    <button class="cancel" onclick="cancelJob()">Stop / Cancel</button>
  </p>

  <div class="panel">
    <h2>Progress</h2>
    <progress id="bar" value="0" max="1"></progress>
    <div class="row"><b>Status</b><span id="status">idle</span></div>
    <div class="row"><b>Image index</b><span id="idx">0 / 0</span></div>
    <div class="row"><b>Variation</b><span id="var">0</span></div>
    <div class="row"><b>Completed</b><span id="done">0</span></div>
    <div class="row"><b>Failed</b><span id="failed">0</span></div>
    <div class="row"><b>ETA</b><span id="eta">0s</span></div>
    <div class="row"><b>Elapsed</b><span id="elapsed">0s</span></div>
    <div class="row"><b>CG export attempt</b><span id="cg_attempt"></span></div>
    <div class="row"><b>CG seed used</b><span id="cg_seed"></span></div>
    <div class="row"><b>Failed indices</b><span id="failed_indices"></span></div>
    <div class="row"><b>Current diffusion seed</b><span id="seed"></span></div>
    <div class="row"><b>Current output file</b><span id="outfile"></span></div>
    <div class="row"><b>Current output dir</b><span id="outdir" class="path"></span></div>
    <div class="row"><b>Message</b><span id="msg"></span></div>
    <details><summary>Current prompt</summary><pre id="prompt"></pre></details>
    <div class="previews" style="margin-top:16px;">
      <div><h3>Latest CG</h3><a id="cg_link" target="_blank"><img id="cg" class="preview" style="display:none"></a></div>
      <div><h3>Latest Diffusion</h3><a id="diff_link" target="_blank"><img id="diff" class="preview" style="display:none"></a></div>
    </div>
  </div>

  <div class="panel" id="complete_panel" style="display:none;">
    <h2>Production completed successfully.</h2>
    <div class="row"><b>CG images</b><span id="summary_cg"></span></div>
    <div class="row"><b>Diffusion images</b><span id="summary_diff"></span></div>
    <div class="row"><b>Metadata JSON</b><span id="summary_meta"></span></div>
    <div class="row"><b>Manifest</b><span id="summary_manifest" class="path"></span></div>
    <div class="row"><b>Total elapsed time</b><span id="summary_elapsed"></span></div>
    <div class="row"><b>Average time/output</b><span id="summary_avg"></span></div>
    <p>
      <button onclick="showPath('Dataset folder', latestStatus.output_root)">Open Dataset Folder</button>
      <button onclick="showPath('ComfyUI output folder', latestStatus.comfy_output_directory)">Open ComfyUI Output Folder</button>
      <button onclick="showPath('Manifest', latestStatus.manifest_path)">Open Manifest</button>
    </p>
  </div>

  <div class="panel">
    <h2>Gallery</h2>
    <p style="color:#b9c7d6;">CG → Diffusion pairs update after completed outputs, useful for spotting hallucinated geometry or unwanted rotation.</p>
    <div id="gallery" class="gallery"></div>
  </div>

<script>
function secondsToText(s) {{
  s = Math.max(0, Math.round(s || 0));
  const m = Math.floor(s / 60), r = s % 60;
  return m ? `${{m}}m ${{r}}s` : `${{r}}s`;
}}
let latestStatus = {{}};
function fileUrl(path) {{
  return path ? '/api/file?path=' + encodeURIComponent(path) : '';
}}
function showPath(title, path) {{
  if (!path) return;
  alert(title + ':\\n' + path);
}}
function formPayload() {{
  return {{
    n: Number(document.getElementById('n').value),
    variations: Number(document.getElementById('variations').value),
    width: Number(document.getElementById('width').value),
    height: Number(document.getElementById('height').value),
    comfy_url: document.getElementById('comfy_url').value,
    comfy_input_dir: document.getElementById('comfy_input_dir').value,
    workflow: document.getElementById('workflow').value,
    output_root: document.getElementById('output_root').value,
    start_index: Number(document.getElementById('start_index').value),
    overwrite: document.getElementById('overwrite').checked
  }};
}}
async function startJob() {{
  const res = await fetch('/api/start', {{ method: 'POST', body: JSON.stringify(formPayload()) }});
  const data = await res.json();
  if (!res.ok) alert(data.error || 'Failed to start');
}}
async function cancelJob() {{
  await fetch('/api/cancel', {{ method: 'POST' }});
}}
async function poll() {{
  const data = await (await fetch('/api/status')).json();
  latestStatus = data;
  document.getElementById('bar').value = data.progress || 0;
  document.getElementById('status').textContent = data.status || 'idle';
  document.getElementById('idx').textContent = `${{data.current_image_index || 0}} / ${{data.total_images || 0}}`;
  document.getElementById('var').textContent = data.current_variation || 0;
  document.getElementById('done').textContent = data.completed_count || 0;
  document.getElementById('failed').textContent = data.failed_count || 0;
  document.getElementById('eta').textContent = secondsToText(data.estimated_remaining_seconds);
  document.getElementById('elapsed').textContent = secondsToText(data.elapsed_seconds);
  document.getElementById('cg_attempt').textContent = data.current_cg_export_attempt || data.cg_export_attempts || '';
  document.getElementById('cg_seed').textContent = data.current_cg_seed_used || '';
  document.getElementById('failed_indices').textContent = (data.failed_indices || []).join(', ');
  document.getElementById('seed').textContent = data.current_diffusion_seed ?? '';
  document.getElementById('outfile').textContent = data.current_output_filename || '';
  document.getElementById('outdir').textContent = data.current_output_directory || '';
  document.getElementById('prompt').textContent = data.current_prompt || '';
  document.getElementById('msg').textContent = data.message || data.error || '';
  const img = document.getElementById('cg');
  if (data.latest_cg_image) {{
    img.style.display = 'block';
    const url = fileUrl(data.latest_cg_image) + '&t=' + Date.now();
    img.src = url;
    document.getElementById('cg_link').href = fileUrl(data.latest_cg_image);
  }}
  const diff = document.getElementById('diff');
  if (data.latest_diffusion_image) {{
    diff.style.display = 'block';
    const url = fileUrl(data.latest_diffusion_image) + '&t=' + Date.now();
    diff.src = url;
    document.getElementById('diff_link').href = fileUrl(data.latest_diffusion_image);
  }}
  renderGallery(data.gallery || []);
  if (data.status === 'completed') {{
    document.getElementById('complete_panel').style.display = 'block';
    document.getElementById('summary_cg').textContent = data.cg_count || 0;
    document.getElementById('summary_diff').textContent = data.diffusion_count || 0;
    document.getElementById('summary_meta').textContent = data.metadata_count || 0;
    document.getElementById('summary_manifest').textContent = data.manifest_path || '';
    document.getElementById('summary_elapsed').textContent = secondsToText(data.elapsed_seconds);
    document.getElementById('summary_avg').textContent = (data.average_seconds_per_output || 0) + 's';
  }}
}}
function renderGallery(items) {{
  const gallery = document.getElementById('gallery');
  gallery.innerHTML = '';
  for (const item of items.slice().reverse().slice(0, 60)) {{
    const box = document.createElement('div');
    box.className = 'pair';
    const cgUrl = fileUrl(item.cg_image);
    const diffUrl = fileUrl(item.diffusion_image);
    box.innerHTML = `
      <div style="margin-bottom:6px;color:#cfe3ff;">meter_${{String(item.index).padStart(4,'0')}} var ${{item.variation_index}}</div>
      <div class="pair-images">
        <a href="${{cgUrl}}" target="_blank"><img src="${{cgUrl}}"></a>
        <b>→</b>
        ${{item.diffusion_image ? `<a href="${{diffUrl}}" target="_blank"><img src="${{diffUrl}}"></a>` : '<span>pending</span>'}}
      </div>`;
    gallery.appendChild(box);
  }}
}}
setInterval(poll, 1500);
poll();
</script>
</body>
</html>"""


class Handler(BaseHTTPRequestHandler):
    def _json(self, status: int, data: Any) -> None:
        raw = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/":
            raw = HTML.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
            return
        if parsed.path == "/api/status":
            self._json(200, JOB.snapshot())
            return
        if parsed.path == "/api/file":
            query = urllib.parse.parse_qs(parsed.query)
            file_path = Path(query.get("path", [""])[0]).resolve()
            if file_path.suffix.lower() not in {".png", ".jpg", ".jpeg", ".webp"}:
                self.send_error(403)
                return
            if not file_path.exists():
                self.send_error(404)
                return
            raw = file_path.read_bytes()
            self.send_response(200)
            content_type = "image/png" if file_path.suffix.lower() == ".png" else "image/jpeg"
            if file_path.suffix.lower() == ".webp":
                content_type = "image/webp"
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
            return
        self.send_error(404)

    def do_POST(self) -> None:
        length = int(self.headers.get("Content-Length", "0"))
        payload = {}
        if length:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        if self.path == "/api/start":
            try:
                JOB.start(payload)
                self._json(200, {"ok": True})
            except Exception as exc:
                self._json(400, {"ok": False, "error": str(exc)})
            return
        if self.path == "/api/cancel":
            JOB.cancel()
            self._json(200, {"ok": True})
            return
        self.send_error(404)


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Open http://{HOST}:{PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
