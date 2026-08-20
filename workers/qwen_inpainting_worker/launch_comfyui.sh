#!/usr/bin/env bash
set -euo pipefail

: "${COMFYUI_ROOT:?Set COMFYUI_ROOT to the ComfyUI installation directory}"
export CUDA_VISIBLE_DEVICES=3
exec python3 "$COMFYUI_ROOT/main.py" --listen 127.0.0.1 --port 8191
