#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
PYTHON="${PYTHON:-python3}"
if [ -x .venv/bin/python ]; then PYTHON=.venv/bin/python; fi
"$PYTHON" -m ruff check backend --select F,E9
"$PYTHON" -m pytest -q
npm test --prefix frontend
npm run build --prefix frontend
