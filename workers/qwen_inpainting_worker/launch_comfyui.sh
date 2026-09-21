#!/usr/bin/env bash
set -euo pipefail

: "${COMFYUI_ROOT:?Set COMFYUI_ROOT to the ComfyUI installation directory}"
COMFYUI_HOST="${COMFYUI_HOST:-127.0.0.1}"
COMFYUI_PORT="${COMFYUI_PORT:-8188}"
exec python3 "$COMFYUI_ROOT/main.py" --listen "$COMFYUI_HOST" --port "$COMFYUI_PORT"
