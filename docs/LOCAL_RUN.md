# Run ATLAS 2 on your own computer

ATLAS is a Python server plus a locally served React application. It is **not** a static-only GitHub Pages site. No account is needed for the default provider paths. Internet access is needed for fresh public data and map resources; the bounded last-good cache is not an offline historical database.

## Requirements

- Python **3.13** (tested 3.13.16).
- Node **24 LTS** (tested 24.21.0) only for building/testing the UI. A release ZIP includes a prebuilt UI, so runtime-only use does not require Node.
- About 1 GB free RAM is a sensible local starting allowance; this is not a capacity guarantee. A WebGL2-capable browser is needed for the interactive map. Other panels/exports remain usable without WebGL.
- Git is needed only for source checkout/publication, not for running an extracted ZIP.

## Linux or macOS — full setup

```sh
cd atlas
./scripts/setup.sh
./scripts/run.sh
```

Open **http://127.0.0.1:7860** on that computer. Stop with Ctrl+C. Setup creates a virtual environment, installs hash-locked Python development dependencies, runs `npm ci`, builds the UI, and copies `.env.example` only if `.env` does not already exist. Existing `.env` credentials are not overwritten.

If your Python 3.13 executable has a different name:

```sh
PYTHON=python3.13 ./scripts/setup.sh
```

### Runtime-only release ZIP (no Node)

```sh
python3.13 -m venv .venv
.venv/bin/python -m pip install --require-hashes -r backend/requirements.txt
./scripts/run.sh
```

This requires `frontend/dist/index.html` from the release ZIP. A source-only GitHub checkout must build the frontend first.

## Windows PowerShell

```powershell
cd atlas
.\scripts\setup.ps1
.\scripts\run.ps1
```

Use a normal terminal with Python 3.13 (`py -3.13`) and Node 24 on PATH. If your organization blocks scripts, do **not** weaken its policy; use the explicit commands below or ask your administrator.

```powershell
py -3.13 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --require-hashes -r backend\requirements-dev-windows.txt
npm.cmd ci --prefix frontend --no-fund
npm.cmd run build --prefix frontend
$env:PYTHONPATH = 'backend'
.\.venv\Scripts\python.exe -m uvicorn atlas_app.main:app --host 127.0.0.1 --port 7860 --workers 1 --no-access-log --no-proxy-headers
```

For a prebuilt release, install `backend\requirements.txt` instead and skip both npm commands. Windows/macOS native execution was **not performed in this Linux workspace**; the scripts and platform-specific paths are supplied for local use.

## Local-first network boundary

Run scripts bind to **127.0.0.1 by default**. Other devices cannot access that loopback address.

For a trusted LAN or a preview environment, explicitly opt into listening on every interface:

```sh
ATLAS_HOST=0.0.0.0 PORT=7860 ./scripts/run.sh
```

```powershell
$env:ATLAS_HOST='0.0.0.0'
$env:PORT='7860'
.\scripts\run.ps1
```

These are launcher environment variables; they are not read by the launcher from `.env`. When exposing the service, configure authentication/TLS/reverse-proxy and firewall rules first. Follow [deployment](DEPLOYMENT.md) and [security](SECURITY.md). Do not expose development servers as production ingress.

## Docker alternative

```sh
docker compose up --build -d
```

Compose publishes only to host loopback unless `ATLAS_BIND` is changed. The image runs as an unprivileged user with a persistent cache volume. Docker files and a CI build gate are provided; **a local Docker build was not executed here** because no daemon was available.

## Private access and optional API key

Copy `.env.example` to `.env` and set:

```dotenv
ATLAS_AUTH_REQUIRED=true
ATLAS_API_KEY=replace_with_a_long_random_secret
```

Generate a real value yourself, for example `python -c "import secrets; print(secrets.token_urlsafe(40))"`. Use 32–256 visible ASCII characters without whitespace. The sample above is an instruction, not a production secret. Enter your key in the app's Workspace settings; it stays only in the current browser page's memory.

For the optional NASA FIRMS Area API, obtain a free MAP_KEY and set `ATLAS_FIRMS_MAP_KEY` server-side. The default South Asia feed does not require it. The free hosted Open-Meteo APIs are non-commercial; code being MIT does not override provider terms. See [API/account guide](API_GUIDE.md).

## Developer workflow

```sh
# Terminal 1
PYTHONPATH=backend .venv/bin/python -m uvicorn atlas_app.main:app --host 127.0.0.1 --port 8000
# Terminal 2
npm run dev --prefix frontend
```

Vite serves on port 5173 and proxies relative `/api` and `/docs` requests to the Python server. `ATLAS_BACKEND_URL` can change that server-side proxy target. Browser code must never use a sandbox localhost URL to reach another host.

```sh
./scripts/check.sh
cd frontend
npx playwright install --with-deps chromium firefox webkit
# Start ATLAS on 7860 before these live, externally networked tests:
xvfb-run -a node scripts/verify-v2.mjs  # Linux: Firefox headed software WebGL
node scripts/verify-browser.mjs       # Legacy-feature regression flows
```

The recorded live tests used `ATLAS_RATE_LIMIT_PER_MINUTE=480` as a local test-only allowance for repeated viewport/tile requests; normal provider quotas still applied. The default local peer limit remains 120/minute.

The v2 suite also works without Xvfb, but Linux headless Firefox may exercise the fallback instead of a WebGL map. Physical phone/tablet testing and OS-native browser/GPU validation are separate from viewport emulation.

## Troubleshooting

- **No frontend:** build it with `npm ci --prefix frontend && npm run build --prefix frontend` or use the prebuilt release.
- **401:** apply your deployment key in Workspace settings. Query-string keys are intentionally ignored.
- **429:** respect the local/provider quotas; provider caches are intentional. Repeated Refresh clicks do not force upstream refreshes.
- **Missing soil:** wait or inspect source state. ISRIC can be slow/partial/no-data; ATLAS never borrows a different location's profile.
- **Map unavailable:** enable WebGL2/hardware acceleration if supported; inspect browser diagnostics. Signal Lab, tables and exports do not require WebGL.
- **Data not current:** inspect both fetched and model/event times. “Fresh cache” is not a guarantee that a provider observation is recent.
- **Different model grid:** normal and disclosed. A selected point and a model grid cell are not identical measurements.
- **Updated installation:** rebuild the UI and restart the server. Weather/AQI v2 cache keys avoid reusing v1's shorter model windows. Browser workspace preferences are separately versioned.


## Lean deployment packaging

Generated browser reports now go to `.artifacts/browser/` in the project root, which is ignored by Git, Docker context and release packaging. The scripts create this directory when needed. Source/tests, public map/font/licence assets and the built release UI remain intact. Historical screenshots/logs can be recovered from Git tag `v2.0.0`. See [lean deployment notes](LEAN_DEPLOYMENT.md).
