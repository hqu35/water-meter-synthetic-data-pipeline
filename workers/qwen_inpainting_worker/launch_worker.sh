#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
export QWEN_DASHBOARD_PORT="${QWEN_DASHBOARD_PORT:-9001}"
export QWEN_COMFYUI_URL="${QWEN_COMFYUI_URL:-${COMFYUI_URL:-http://127.0.0.1:8188}}"
exec python3 massive_production.py
