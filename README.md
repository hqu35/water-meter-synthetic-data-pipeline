# Synthetic Water-Meter Data Pipeline

A production pipeline for generating annotated mechanical water-meter images.
It combines deterministic Three.js rendering with optional FLUX.2 or Qwen
augmentation while keeping the CG meter state, masks, and metadata available as
ground truth.

The synthetic data has shown measurable downstream value in the project's
evaluation setup: augmenting training with generated data improved detector
performance from **78.7% mAP@0.85 to 85.7% mAP@0.85**.

![CG-grounded Qwen inpainting workflow](posters/qwen_mask_workflow_collage_poster_v3.png)

![FLUX.2 image augmentation workflow](posters/flux_workflow_collage_poster_v3.png)

## What runs where

The repository contains the renderer, orchestration workers, dashboards, API
workflow templates, and dataset output contract. ComfyUI and its model weights
are external runtime dependencies and are not included.

```text
Dashboard (port 9000 or 9001)
  -> ProductionRunner
     -> Node exporter
        -> Chrome/Chromium over CDP (port 9222)
        -> Three.js CG RGB + mask + metadata
     -> route-specific prompt generator
     -> ComfyUI HTTP API (port 8188)
        -> /upload/image
        -> /prompt
        -> /history/{prompt_id}
        -> /view
     -> local batch files + batch_manifest.json
  <- status, progress, errors, and CG/AI previews
```

The dashboards start real production jobs; they are not monitoring-only UIs.
The user does not need to open the ComfyUI browser editor or manually queue the
checked-in workflows.

## Production routes

| Route | Purpose | Inputs sent to ComfyUI | Result |
| --- | --- | --- | --- |
| FLUX.2 | Global realism and appearance variation | CG RGB plus its generated mask as two references | A globally augmented meter image |
| Qwen inpainting | Replace or enrich the environment while protecting meter content | CG RGB plus the mask-guided editable region | A background-enhanced composite |

Both routes use the same Three.js exporter and can write into the same batch.
When the expected CG files already exist and `overwrite` is false, a later route
reuses them instead of rendering a second source image.

## Repository architecture

```text
water-meter-synthetic-data-pipeline/
  synthetic_core/
    cg_exporter/                 Three.js renderer and Node/Playwright exporter
    assets/                      PBR textures used by the renderer
    HDRI/                        Environment maps used by the renderer
    configs/                     Shared renderer configuration
    utilities/                   COCO-OBB and comparison utilities
  workers/
    flux2_worker/
      app.py                     Dashboard HTTP server and job manager
      massive_production.py      Dashboard/CLI entrypoint
      production_engine.py       End-to-end FLUX.2 orchestration
      flux2_prompt_generator.py  Route prompt construction
      workflow/                  Checked-in ComfyUI API workflow
    qwen_inpainting_worker/
      app.py                     Dashboard HTTP server and job manager
      massive_production.py      Dashboard/CLI entrypoint
      production_engine.py       End-to-end Qwen orchestration
      qwen_background_prompt_generator.py
      workflow/                  Checked-in ComfyUI API workflow
  outputs/                       Default generated dataset root
  validation/                    Annotation overlay checks
  posters/                       README workflow figures
```

Responsibility boundaries:

- `synthetic_core/cg_exporter` owns procedural geometry, materials, lighting,
  camera setup, mask generation, metadata, and exact annotations.
- Each `app.py` owns the browser dashboard and translates its form into a
  `ProductionConfig`.
- Each `production_engine.py` owns preflight, CG export, uploads, workflow
  mutation, ComfyUI execution, downloads, manifests, and progress callbacks.
- Each prompt generator owns route-specific scene language. It does not submit
  jobs itself.
- The checked-in `workflow/*.json` files are the API workflow source of truth.
  A normal production run mutates a copy, never the checked-in file.
- ComfyUI owns model execution. The workers communicate with it only through
  HTTP, so ComfyUI does not need direct access to the repository output tree.

## End-to-end job flow

1. The dashboard sends its form to `POST /api/start` and starts a background
   `ProductionRunner` thread.
2. The worker validates the output directory, reaches ComfyUI through
   `/system_stats`, and checks node classes and model choices through
   `/object_info`.
3. The worker invokes `synthetic_core/cg_exporter/export-cg-single.js`. The Node
   exporter connects to the already-running CDP browser and writes RGB, mask,
   metadata, and debug artifacts locally.
4. The route prompt generator creates a deterministic prompt from the image
   index. The worker uploads the RGB and mask to a batch/sample-unique ComfyUI
   input subfolder with `POST /upload/image`.
5. The worker deep-copies and mutates the route's API workflow with the uploaded
   paths, prompt, deterministic diffusion seed, output prefix, and dimensions.
   FLUX.2 also resolves the active `ComfySwitchNode` branches and removes
   unreachable inactive nodes before preflight and submission.
6. The worker sends the final graph to `POST /prompt`, polls
   `/history/{prompt_id}`, then downloads the selected `SaveImage` result through
   `/view`.
7. The AI result, prompt, debug workflow, and manifest record are written under
   the batch directory. Manifest updates use a cross-process directory lock and
   atomic replacement.
8. The dashboard polls `GET /api/status` every 1.5 seconds and serves local CG
   and AI result files through `GET /api/file` for its latest-image and gallery
   previews.

## First-time setup

### 1. Runtime prerequisites

Install the following before running production:

- Python 3.9 or newer for the workers.
- Node.js and npm for the CG exporter.
- Chrome or Chromium with Chrome DevTools Protocol support.
- A recent official ComfyUI installation, a compatible PyTorch/CUDA stack, and
  the model files listed below.
- An NVIDIA GPU with enough VRAM for the selected workflow. The currently
  validated example is an L40S 48 GB with PyTorch `2.8.0+cu128`; this is an
  example, not a hardcoded repository requirement.

The worker runtime itself uses the Python standard library. ComfyUI keeps its
own Python environment and dependencies. The worker tests additionally use
Pillow.

### 2. Install the CG exporter

From the repository root:

```bash
cd synthetic_core/cg_exporter
npm ci
npx playwright install chromium
npx playwright install-deps chromium
cd ../..
```

`playwright install-deps` is primarily for Linux and may require system package
privileges. See [`synthetic_core/cg_exporter/README.md`](synthetic_core/cg_exporter/README.md)
for the exporter-only commands and troubleshooting notes.

### 3. Start Chrome/Chromium with CDP

The launch scripts do not start the browser. Keep this process running while a
worker generates CG images.

macOS:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/water-meter-cdp
```

Linux:

```bash
google-chrome \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/water-meter-cdp
```

Use a dedicated temporary profile. Do not point `--user-data-dir` at a normal
browser profile. The default worker endpoint is
`CDP_ENDPOINT=http://127.0.0.1:9222`.

### 4. Install the ComfyUI models

The exact workflow JSON files are the source of truth. ComfyUI must expose the
following filenames through the corresponding loader nodes.

FLUX.2 default workflow:

- `flux2_dev_fp8mixed.safetensors`
- `mistral_3_small_flux2_bf16.safetensors`
- `full_encoder_small_decoder.safetensors`

`Flux_2-Turbo-LoRA_comfyui.safetensors` is optional while
`Enable 8 steps lora = false`. It becomes required if that workflow switch is
enabled. The worker derives this from the active switch path; it does not
special-case the filename.

Qwen inpainting workflow:

- `qwen_image_fp8_e4m3fn.safetensors`
- `qwen_2.5_vl_7b_fp8_scaled.safetensors`
- `qwen_image_vae.safetensors`
- `Qwen-Image-InstantX-ControlNet-Inpainting.safetensors`

The current workflows use recent ComfyUI core nodes including
`ComfySwitchNode`, `ControlNetInpaintingAliMamaApply`, and
`ResizeImageMaskNode`. Worker preflight stops before production and reports any
missing node class or active model.

### 5. Start ComfyUI

From the repository root, point `COMFYUI_ROOT` at the external ComfyUI checkout:

```bash
COMFYUI_ROOT=/absolute/path/to/ComfyUI \
  workers/flux2_worker/launch_comfyui.sh
```

The Qwen launch script is equivalent; both default to
`http://127.0.0.1:8188`. GPU selection belongs to the deployment shell, for
example:

```bash
COMFYUI_ROOT=/absolute/path/to/ComfyUI CUDA_VISIBLE_DEVICES=0 \
  workers/flux2_worker/launch_comfyui.sh
```

One ComfyUI instance can serve both workers. For the first validation, run the
two routes sequentially so failures and GPU use are easy to isolate.

## Start and control production from the dashboard

Open a new terminal at the repository root after Chrome and ComfyUI are ready.

FLUX.2 dashboard:

```bash
workers/flux2_worker/launch_worker.sh
```

Open <http://127.0.0.1:9000>.

Qwen inpainting dashboard:

```bash
workers/qwen_inpainting_worker/launch_worker.sh
```

Open <http://127.0.0.1:9001>.

For a first clean validation, use a new batch ID, set **Number of images N** to
`1`, leave **Variations per CG** at `1`, verify the ComfyUI URL is
`http://127.0.0.1:8188`, and click **Generate**. The dashboard will run the
complete CG-to-ComfyUI pipeline without any manual operation in the ComfyUI UI.

The dashboard controls are:

| Field | Meaning |
| --- | --- |
| Number of images N | Number of CG source samples |
| Variations per CG | Number of AI outputs requested for each CG sample |
| Width / Height | Requested render and output dimensions |
| ComfyUI URL | HTTP endpoint used for preflight, upload, execution, and download |
| Workflow API JSON path | Route workflow template; normally leave the default |
| Output dataset folder | Parent directory containing batch folders |
| Batch ID | One portable path segment identifying this run |
| Resume start_index | First zero-based meter index generated by this invocation |
| Overwrite existing dataset | Re-render existing CG artifacts instead of reusing them |

During production the dashboard shows status, progress, completed and failed
counts, ETA, actual CG seed, diffusion seed, current prompt, output path, latest
CG and AI previews, and a completed-pair gallery. **Stop / Cancel** requests a
cooperative stop. Per-sample details, prompt IDs, debug workflow paths, output
candidates, and failure messages are retained in `batch_manifest.json`.

Running `massive_production.py` with no arguments also starts its dashboard:

```bash
python3 workers/flux2_worker/massive_production.py
python3 workers/qwen_inpainting_worker/massive_production.py
```

## CLI production

Supplying command-line arguments switches `massive_production.py` from dashboard
mode to direct CLI production:

```bash
python3 workers/flux2_worker/massive_production.py \
  --n 1 --batch-id flux_validation_001 --output-root ./outputs

python3 workers/qwen_inpainting_worker/massive_production.py \
  --n 1 --batch-id qwen_validation_001 --output-root ./outputs
```

Useful optional arguments are `--variations`, `--width`, `--height`,
`--workflow`, `--comfy-url`, `--start-index`, and `--overwrite`.

## Output contract

For batch ID `batch_001`, the shared layout is:

```text
outputs/batch_001/
  cg/sample_000001/
    image.png
    image_mask.png
    metadata.json
  ai_augmented/
    flux2/sample_000001/image.png
    qwen/sample_000001/image.png
  auxiliary/
    cg_debug/...
    flux2/{prompts,debug_workflows,logs}/...
    qwen/{prompts,debug_workflows,logs}/...
  batch_manifest.json
```

Paths recorded in the manifest are relative to the batch root. Using the same
batch ID and sample indices allows FLUX.2 and Qwen records to coexist in one
manifest and reuse the same CG source files.

## Configuration

Runtime precedence is command-line option, then environment variable, then the
repository default. The most common variables are:

| Variable | Default |
| --- | --- |
| `COMFYUI_URL` | `http://127.0.0.1:8188` |
| `FLUX_COMFYUI_URL` / `QWEN_COMFYUI_URL` | Route override of `COMFYUI_URL` |
| `OUTPUT_ROOT` | Repository `outputs/` when unset |
| `BATCH_ID` | `demo_001` |
| `CDP_ENDPOINT` | `http://127.0.0.1:9222` |
| `FLUX_DASHBOARD_PORT` | `9000` |
| `QWEN_DASHBOARD_PORT` | `9001` |
| `DASHBOARD_HOST` | `127.0.0.1` |

`.env.example` is only a shell template; the Python entrypoints and launch
scripts do not load it automatically. If you choose to use it, source it before
starting a script:

```bash
cp .env.example .env
# Edit .env first. Prefer an absolute OUTPUT_ROOT when using launch_worker.sh.
set -a
. ./.env
set +a
workers/flux2_worker/launch_worker.sh
```

A relative `OUTPUT_ROOT` is resolved from the process working directory. The
worker launch scripts change into their own worker directories, so an absolute
path avoids accidentally creating route-local output folders. Use a unique
production `BATCH_ID`; `demo_001` is intended only as a test default.

## Remote dashboard access

The dashboard intentionally binds to localhost by default and its image endpoint
can serve local result files. Do not expose it directly to the public internet.
For a remote GPU machine, keep the default binding and use SSH forwarding:

```bash
ssh -N \
  -L 9000:127.0.0.1:9000 \
  -L 9001:127.0.0.1:9001 \
  user@gpu-host
```

Then open `http://127.0.0.1:9000` or `http://127.0.0.1:9001` on the local
machine. Port `8188` does not need to be forwarded for normal dashboard control
when the worker and ComfyUI run on the same remote host. Do not expose the CDP
port `9222` publicly.

## Validation and tests

Worker tests:

```bash
python3 -m unittest discover -s workers/flux2_worker/tests -v
python3 -m unittest discover -s workers/qwen_inpainting_worker/tests -v
```

CG exporter tests:

```bash
cd synthetic_core/cg_exporter
npm test
npm run test:graphics:unit
```

Annotation overlay check from the repository root:

```bash
python3 validation/annotation_check/validate_coco_annotations.py
```

The validator selects an image already referenced by the COCO file, draws its
stored boxes/OBBs, and writes the result to `validation/sample_results`. It does
not create new annotations.

More detailed worker runtime, model, and deployment notes are in
[`workers/README.md`](workers/README.md).
