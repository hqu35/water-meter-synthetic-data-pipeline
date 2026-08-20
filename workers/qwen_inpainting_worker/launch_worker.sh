#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
export CUDA_VISIBLE_DEVICES=3
export WORKER_PORT="${WORKER_PORT:-9001}"
export COMFY_URL="${COMFY_URL:-http://127.0.0.1:8191}"
exec python3 massive_production.py
