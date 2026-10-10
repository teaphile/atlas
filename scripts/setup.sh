#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
PYTHON="${PYTHON:-python3}"
"$PYTHON" -c 'import sys; assert sys.version_info >= (3,13), "Use Python 3.13+ (3.13 tested)"'
node -e 'if(+process.versions.node.split(".")[0]<24)throw Error("Use Node.js 24 LTS or later")'
"$PYTHON" -m venv .venv
.venv/bin/python -m pip install --require-hashes -r backend/requirements-dev.txt
npm ci --prefix frontend --no-fund
npm run build --prefix frontend
if [ ! -f .env ]; then cp .env.example .env; fi
printf '\nSetup complete. Read .env, then run ./scripts/run.sh\n'
