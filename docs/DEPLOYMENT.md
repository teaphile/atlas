# ATLAS 2 local-first deployment note

Start with [Local run](LOCAL_RUN.md) for Linux/macOS/Windows and [GitHub publication](GITHUB_PUBLISH.md) for account-owned source publishing. `scripts/run.sh` and `run.ps1` now bind to **127.0.0.1 by default**. Explicitly set the launcher environment `ATLAS_HOST=0.0.0.0` for trusted LAN/preview use, with appropriate auth/ingress controls. The current Arena preview uses an explicit all-interface bind; browser API URLs remain same-origin.

The v2 Linux setup/build/run path was executed. The delivered multi-OS CI and Docker job must still be run in the user's repository/environment; native Windows/macOS/Docker execution is not asserted. Windows development requirements use `requirements-dev-windows.txt` to include pytest's conditional colorama dependency. Runtime production requirements are shared.

The original detailed operations guidance follows; wherever a launcher bind is discussed, the v2 local-first default above takes precedence.

# Running and deploying ATLAS

## Current delivered demonstration

The application is running as an Arena live preview on **port 7860**, bound to `0.0.0.0`. The frontend and API share one origin; browser code does not call the sandbox's loopback address. Localhost addresses below are for a developer terminal or a same-host reverse proxy, not for a remote user's browser.

This is a running demonstration, not a purchased permanent hosting service. Its process/preview lifetime is controlled by the workspace platform. The source archive, dependency locks and built frontend let you recreate it on your chosen server later.

## Local setup

Verified runtime: Python **3.13.16**, Node **24.21.0** for final build/tests, Chromium **156** for browser verification. Earlier Node 20 builds worked but reported a dependency's Node ≥22 warning; use Node 24 LTS rather than relying on that accidental compatibility.

```sh
# From the extracted project root, with Python 3.13 and Node 24 installed:
./scripts/setup.sh
./scripts/run.sh
# Open http://localhost:7860 on that machine.
```

`setup.sh` creates `.venv`, installs hash-locked Python development requirements, runs `npm ci`, builds the frontend and copies `.env.example` only if `.env` does not exist. It does not create accounts or contact the reviewed upstream repositories. A bare production install can use `backend/requirements.txt` instead of development requirements.

If using the prebuilt frontend included in the project archive:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install --require-hashes -r backend/requirements.txt
cp .env.example .env  # only when a local .env does not already exist
./scripts/run.sh
```

The packaged browser build has no environment-specific provider secret. It still needs the backend and internet access for live data. Opening `index.html` as a standalone file is not a substitute for running the service.

## Configuration

All settings use `ATLAS_` variables; see `.env.example`. The source registry controls provider TTL and maximum-stale semantics. Restart after changing server settings.

For private deployment:

```sh
# Generate locally; do not paste real secrets into source control or shared logs.
python3 -c 'import secrets; print(secrets.token_urlsafe(32))'
# Set the generated value in your secret store / uncommitted .env:
# ATLAS_AUTH_REQUIRED=true
# ATLAS_API_KEY=<your generated secret>
```

Enter that deployment access key in the UI's Workspace Settings. It stays in page memory. NASA's separate optional MAP_KEY belongs only in `ATLAS_FIRMS_MAP_KEY` on the server. No other third-party account integration is implied by the settings form.

The sample default is a **public, read-only research/demo API**. Do not overlook that `auth_required=false` is intentional; change it for private use and configure an identity-aware ingress if appropriate.

## Docker / Compose

```sh
# Requires Docker/Compose on your chosen host:
docker compose up --build -d
```

The image builds the frontend with Node 24, installs hash-locked Python dependencies, runs as UID 10001, and serves everything on 7860. Compose uses a read-only root, dropped capabilities, a small tmpfs, process/memory limits and a persistent `/data` volume for SQLite. By default the published host port is bound to **127.0.0.1** for a same-host HTTPS ingress. Set `ATLAS_BIND=0.0.0.0` only deliberately, with appropriate firewall/TLS controls.

**Verification boundary:** Dockerfile/Compose/CI definitions are delivered, but a Docker daemon was not available in this workspace. No container image build or future-host rollout is claimed as tested. Image tags are maintained-version tags, not immutable digests; resolve and pin image/action digests as part of your release process.

## Ingress

`deploy/Caddyfile` is an example for a real hostname supplied as `ATLAS_DOMAIN`. Configure DNS, firewall and your ingress's trusted-client authentication/rate limits. The example expects Caddy on the host, reaching `127.0.0.1:7860`; adapt the upstream to your Docker network if both services run in containers.

- Preserve SSE streaming; do not buffer the invalidation stream. Heartbeat interval is 15 seconds.
- Do not put an access/provider key in an iframe URL, query parameter or cache key exposed to users.
- Do not trust arbitrary forwarded-IP headers. The application disables automatic proxy-header trust; configure a trusted ingress instead.
- The production anti-framing policy in the Caddy example is **not used on the framed Arena preview**.
- Treat provider URLs containing API keys as secrets in any proxy/egress logs.

## Development mode

Use two terminals/processes:

```sh
# Terminal 1, repository root:
PYTHONPATH=backend .venv/bin/python -m uvicorn atlas_app.main:app --host 0.0.0.0 --port 8000 --no-access-log
# Terminal 2:
cd frontend && npm run dev
```

Vite binds `0.0.0.0`, allows the Arena preview host suffix and proxies `/api` and `/docs` to the local backend. Browser requests stay relative. Add your own trusted preview host if different; do not broaden host trust casually.

## Tests and release checks

```sh
./scripts/check.sh
# Optional live integration checks while the app is running:
cd frontend
npx playwright install --with-deps chromium
node scripts/verify-browser.mjs
node scripts/review-preview.mjs
```

Unit tests are offline and deterministic; their hand-authored fixtures are never imported by the application. Browser checks use actual sources, so provider outages may legitimately fail a strict no-HTTP-error gate. Inspect failures rather than replacing them with fake data or loosening semantic assertions.

Dependency audits performed in this build reported no known production vulnerabilities at the check time. Re-run:

```sh
python -m pip_audit -r backend/requirements.txt
npm audit --omit=dev --prefix frontend
```

`pip-audit` is an audit tool, not a runtime dependency; install it in your tooling environment as needed. Python locks include hashes; npm uses `package-lock.json`. Updating locks should be followed by all checks, not done automatically during startup.

The provided CI executes lint, offline tests, build and dependency audits, and defines a separate Docker build job. It has not been pushed or executed in a user-owned CI account. Repository-hosting credentials were neither requested nor used.

## Persistence and operations

- SQLite is a bounded last-good cache, not a historical data archive. Logical payload limits do not cap the exact SQLite file/WAL size or process RSS.
- Default local cache is `.runtime/atlas.sqlite3`; the container uses `/data/atlas.sqlite3`. Do not publish that directory or include it in source archives.
- Back up with a proper SQLite online backup or stop the app before copying; do not copy an actively changing database without its transaction context. Perform a restore rehearsal on the selected host.
- `/api/v1/health` is process liveness; `/api/v1/ready` reports initialization readiness. Neither asserts that every upstream is available. `/api/v1/sources` and `/api/v1/metrics` expose source state.
- Watch stale/unavailable rates, request budgets, refresh latency, cache pressure and source schema changes. Basic metrics are implemented; a full alerting/observability stack is not preconfigured.
- Run **one worker**. Multi-worker or multi-replica deployment requires shared collectors, quota/cache/bus state and appropriate storage, as described in `ARCHITECTURE.md`.
- The 768 MB / 2 CPU Compose settings are an initial deployment budget, not a demonstrated capacity or SLA. Run realistic concurrency, soak, failure and recovery tests before setting a public service commitment.

## Production release gates still required

Choose licenses/API plans; verify host/ingress/DNS/egress; protect secrets; build and scan the actual container; pin release artifacts; execute load/soak/restore tests; review all browsers and accessibility; decide account/tenant boundaries; commission security review; and validate any decision-oriented scientific model. The delivered code and working demo do not eliminate these operator/domain responsibilities.


## Reproduce the private-access browser check

Use a separate temporary test server on 7861 with `ATLAS_COLLECT=false`, `ATLAS_AUTH_REQUIRED=true`, and `ATLAS_API_KEY=ATLAS_BROWSER_VERIFICATION_ONLY_NOT_A_REAL_SECRET_2026`. This is a **published synthetic test sentinel, never a production secret**. Then run `cd frontend && node scripts/verify-private.mjs`. Stop that test server afterwards. The script verifies rejected anonymous/query keys, real header-auth map/model/camera requests, memory-only key behavior and saved-location/report restoration. The final public demo remains on 7860.


## Rebuild the portable documentation

Optional documentation-only dependencies: `python -m pip install --require-hashes -r docs/requirements.txt`. Then run `python scripts/create_handover.py`. This creates the self-contained HTML guide; it is not a runtime dependency of the application. `python scripts/package_release.py` produces the clean project archive after the frontend is built.
