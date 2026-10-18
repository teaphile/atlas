# ATLAS 2.0 verification and release assessment

Recorded **10 October 2026**. This is executed evidence plus explicit boundaries, not a production/scientific/security certificate.

**Lean cleanup, 18 October 2026:** bulky generated logs and screenshots are no longer duplicated in the working tree/release ZIP. The compact [release summary](v2/release-verification.json) remains. Evidence paths in the table below refer to the preserved Git tag `v2.0.0`, not current files. For example: `git show v2.0.0:docs/v2/browser-verification-v2.json`. A standalone ZIP intentionally has no Git history; retain the local repository if historical evidence is needed.

## Recorded v2 gates (archived evidence)

| Gate | Result | Evidence in Git tag `v2.0.0` (relative to `docs/`) |
|---|---|---|
| Python offline regression | **225 passed**, one known non-failing Starlette TestClient warning | `v2/backend-tests.txt` / XML |
| Frontend regression | **78 passed** across API, UTC/export utilities, workspace/geometry and asynchronous hooks | `v2/frontend-tests.json` |
| Actual setup/build | Linux setup script, dependency install and `npm run build` executed | `v2/local-setup-verification.txt` |
| Static checks | Ruff F/E9, Python compile, strict TypeScript, shell syntax | `v2/final-checks.txt` |
| Frontend production build | Split shell, map and analytics; bundled worker/fonts | `v2/frontend-build.txt` |
| Python production advisory audit | No known vulnerabilities reported | `v2/python-production-audit.json` |
| npm production advisory audit | Zero reported production advisories | `v2/npm-production-audit.json` |
| V2 browser flows | **13 passed** | `v2/browser-verification-v2.json` |
| Retained-feature regression | **13 passed**, real API/map/imagery flows | `v2/legacy-browser-verification.json` |
| Private access flows | **7 passed** with a dedicated non-secret sentinel | `v2/private-browser-verification.json` |
| Failure/retry/display-unit flows | **3 passed**, one deliberate HTTP 503 and real-data recovery | `v2/fault-browser-verification.json` |
| Responsive matrix | **72 samples**, no detected page/content overflow, stretched map label or canvas/container mismatch | `v2/browser-verification-v2.json` |
| Automated accessibility | **8 Chromium states, zero reported violations** for the selected WCAG A/AA tags | same artifact, `accessibility` |
| Live scientific input | Actual weather/AQI, 288 hourly rows each, full 72-hour coverage and usable novelty baseline at the sampled point | `v2/live-analytic-probe.json`, `v2/live-api-smoke.json` |

Total offline tests: **303**. Total browser flow checks: **36**. Counts are steps/test cases, not a line-coverage percentage or proof of all states.

## Browser matrix and visual review

Versions: Chromium **156.0.8078.4**, Firefox **157.0**, WebKit **27.2** from Playwright. Chromium/WebKit were headless; Firefox used a headed **Xvfb virtual display** with software WebGL. All three rendered the actual map in the final matrix. Linux headless Firefox separately exercised the intended unavailable-WebGL fallback; that is not a claim about every physical Firefox GPU.

Each engine sampled **Overview and Signal Lab** at:

```
320×568    360×800    390×844    430×932
768×1024   1024×768   1280×800   1440×960
1920×1080  2560×1440  844×390    1024×600
```

The suite checks outer and content widths plus actual map-canvas/host height agreement. Screenshots of desktop and phone Overview/Signal Lab, comparison and retained features were read and visually inspected. Some data tables intentionally scroll within their bounded region.

The eight automated accessibility states are desktop Overview, Signal Lab, comparison, record explorer, source registry, settings, and phone Overview/Signal Lab. Incomplete axe checks are retained in the archived artifact. Automated zero-violation samples **do not establish full WCAG conformance**, screen-reader usability, high-zoom behavior, every content combination or physical-device compatibility.

## Exercised functionality

- Real map/style/worker, regional navigation, 3D globe switching and actual NASA JPEG imagery.
- Place search, current model context, soil prediction semantics, erosion calculation/stale-input notice and CISA catalog scope.
- Keyboard chart inspection and table alternatives; baseline/outlook switching; thermal recalculation; shared-clock three-place comparison; record search/empty states.
- Canonical CSV including location and source clocks; US display does not change scientific export units.
- Workspace export/import, invalid workspace rejection, memory-only key policy, active polygon persistence, named-view restoration and imported geometry.
- Layer/priority/cutoff-aware AOI membership, empty layer selection, actual rapid-click drawing, undo, finish, Escape, phone drawer and skip link.
- Private missing/query-key rejection, protected tiles/model/Signal Lab, saved-location report restoration and authenticated TfL image blobs.
- Visible HTTP error without made-up metrics/stale export, followed by successful retry that clears the error.

Public flows used real providers and did not inject observation/model fixtures. The separate fault test injects a **503 response only**, not fake weather or incident data. The private key is an explicitly public test sentinel, never a production credential. Temporary private verification servers are stopped after checking.

## Offline regression coverage

All previous normalization, science, spatial, ingestion/storage/HTTP/auth/SSE/asset/export tests remain. New cases cover:

- Provider units, independent short/null arrays, duplicate/unsorted/offset-aware timestamps, invalid WMO codes and UTC metadata.
- Psychrometric identities/bounds, complete forecast endpoints, paired water-balance coverage, capped thermal accumulation, direction wrapping/calm/missing counts.
- Leakage exclusion, constant/collinear novelty, per-hour sample requirements, finite serialization, ties/constants/alignment for rank correlation and descriptive robust slopes.
- Shared-clock 2–3-point routes, input/order/auth boundaries, no soil side effect, no historical-replay parameter abuse.
- AOI empty selection/priority/end/position expiry and proximity budgets.
- Naive/future/invalid-state disk cache rejection, SQLite statement rollback and subsequent writes.
- Asynchronous old-generation completion, single-flight/queued refresh, abort, separate soil merge and recovered-error clearing.
- Strict portable workspace/GeoJSON parsing, hidden-field stripping, byte limits, units, date-line camera bounds and source geometry preservation.

## Local run, dependencies and publication

The actual Linux setup script initially exposed missing executable bits; these were corrected and the setup/build was re-executed successfully. The release ZIP retains Unix file modes; README also gives a `bash scripts/...` fallback. Windows pytest's platform-specific `colorama` dependency is supplied as a hash-locked overlay; installed-package metadata was checked for Windows/macOS conditional gaps.

Dependency scans are a point-in-time advisory lookup, not a supply-chain or security certification. Linux Python/Node installation/build was executed. The multi-OS CI and Docker build workflow is delivered but has **not run in an authenticated user GitHub repository**.

GitHub publication itself remains blocked by unavailable authenticated connectivity. Local history/release artifacts and a user-operated publishing helper are supplied. No remote creation/push is claimed.

## Explicitly untested / not established

- Native Windows/macOS execution, physical iOS/Android devices, hardware GPU diversity and every screen ratio.
- Docker execution in this workspace, public ingress/TLS, multi-user load/soak, disaster recovery and multi-worker scaling.
- Penetration test, formal accessibility audit, statistical skill benchmark, calibrated hazard probability or agronomic validation.
- Optional FIRMS Area access with a real credential; continuous provider uptime/commercial rights.

A provider may be unavailable, slow, schema-changed or genuinely empty. Soil no-data is never replaced with a neighboring point. Earlier v1/v2 raw logs are preserved in Git history rather than shipped in the lean tree. This document and `v2/release-verification.json` retain the release assessment.


## Reproduce verification

After installing the development dependencies using the local-run guide:

```sh
./scripts/check.sh
# Start ./scripts/run.sh in another terminal before browser checks.
cd frontend
npx playwright install chromium firefox webkit
# Linux: the full matrix includes headed Firefox and needs Xvfb/system libraries.
xvfb-run -a node scripts/verify-v2.mjs
node scripts/verify-browser.mjs
node scripts/verify-faults-v2.mjs
```

Browser reports/screenshots are regenerated under `.artifacts/browser/`, ignored by Git, Docker context and release packaging. `verify-private.mjs` requires a **separate test deployment** using its non-secret sentinel, never a production key. Provider/browser versions and live inputs may differ on a later rerun.

For checks actually repeated during the lean cleanup (rather than the historical full release matrix), see [cleanup verification](LEAN_DEPLOYMENT.md).
