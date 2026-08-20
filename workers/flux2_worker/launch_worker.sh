#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
export CUDA_VISIBLE_DEVICES=2
export WORKER_PORT="${WORKER_PORT:-9000}"
export COMFY_URL="${COMFY_URL:-http://127.0.0.1:8188}"
exec python3 massive_production.py
