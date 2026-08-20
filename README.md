# Water Meter Massive Production V2

This directory is a clean production copy. The original working directories
remain unchanged.

## Workers

Flux2 dashboard:

```bash
cd workers/flux2_worker
python3 massive_production.py
```

Qwen inpainting dashboard:

```bash
cd workers/qwen_inpainting_worker
python3 massive_production.py
```

With no arguments, each command starts its own localhost dashboard. Existing
CLI arguments are still supported when arguments are supplied.

- Flux2 dashboard: `http://127.0.0.1:9000`
- Qwen dashboard: `http://127.0.0.1:9001`
- Flux2 GPU assignment: CUDA device 2
- Qwen GPU assignment: CUDA device 3

Each worker expects a ComfyUI instance using the matching workflow and GPU.
The optional `launch_comfyui.sh` scripts launch separate ComfyUI servers when
`COMFYUI_ROOT` is set.

## Shared Production

`shared_production/cg_exporter` is a copy of the current working Three.js
renderer and exporter. Both workers use it through a relative `work` symlink.
PBR assets, HDRIs, existing masks, common configuration, and utilities are
stored once under `shared_production`.

## Annotation Check

```bash
python3 validation/annotation_check/validate_coco_annotations.py
```

The validator selects one existing rendered image referenced by the existing
COCO file, draws its stored boxes/OBBs, and writes the result to
`validation/sample_results`. It never creates new annotations.
