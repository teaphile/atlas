#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
PYTHON="${PYTHON:-python3}"
if [ -x .venv/bin/python ]; then PYTHON=.venv/bin/python; fi
if [ ! -f frontend/dist/index.html ]; then printf 'Build first: npm ci --prefix frontend && npm run build --prefix frontend\n' >&2; exit 1; fi
export PYTHONPATH=backend
exec "$PYTHON" -m uvicorn atlas_app.main:app --host 0.0.0.0 --port "${PORT:-7860}" --workers 1 --no-access-log --no-proxy-headers --timeout-keep-alive 15 --timeout-graceful-shutdown 20 --limit-concurrency 120
