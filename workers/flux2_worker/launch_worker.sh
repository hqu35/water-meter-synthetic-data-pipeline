#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
export FLUX_DASHBOARD_PORT="${FLUX_DASHBOARD_PORT:-9000}"
export FLUX_COMFYUI_URL="${FLUX_COMFYUI_URL:-${COMFYUI_URL:-http://127.0.0.1:8188}}"
exec python3 massive_production.py
