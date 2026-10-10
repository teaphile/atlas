# Verification and release assessment

**Date: 10 October 2026.** This file distinguishes executable evidence from design claims, provider availability and work that still requires a deployment or domain review.

## Executed checks

| Gate | Observed result | Artifact |
|---|---|---|
| Backend offline suite | **132 passed**, zero failures/errors | `backend-tests.txt`, `backend-tests.xml` |
| Frontend offline suite | **27 passed** | `frontend-tests.json` |
| Strict TypeScript / Vite build | Passed on **Node 24.21.0** | `frontend-build.txt` |
| Python static checks | Ruff `F,E9` checks passed | `backend-lint.txt` |
| Python install lock | Hash-locked dependency dry-run accepted; `pip check` passed | `dependency-install-check.txt`, requirements lock files |
| Python production advisory audit | No known vulnerabilities reported at check time | `python-production-audit.json` |
| npm production advisory audit | No known vulnerabilities reported at check time | `npm-production-audit.json` |
| Real browser | **13 flow checks passed**, no uncaught errors or failing HTTP responses on the final recorded flow | `browser-verification.json`, `previews/` |
| Live adapter sampling | Real source responses, including explicit unavailable/disabled states | `api-probe.json`, `live-verification.json`, `additional-live-checks.json` |
| Server | Same-origin application/API listening on `0.0.0.0:7860`; liveness and readiness exercised | Live preview / final smoke artifact |

The backend test run has one non-failing Starlette TestClient deprecation warning about its HTTPX integration. Production provider calls and all tests completed; future tooling upgrades should address the warning. No source-code coverage percentage, penetration-test result or scientific validation score is claimed.

## Offline regression coverage

### Data normalization

Finite-number/null behavior; timestamps and UTC; impossible/missing coordinates; source identity; unit conversion; valid-empty versus schema drift; SoilGrids null cells and invalid intervals; FIRMS deduplication and malformed key messages; Kp schema variants; NWS representative/null geometry; XML entity rejection; stale aviation positions; RSS text/time handling.

### Scientific/temporal behavior

Exactly 24 completed hourly endpoints without double-counting rain; missing/future rainfall; FFWI bounds and directional checks; missing/stale/old/unknown-timestamp inputs; explicit missing-data sensitivity; soil stock units/completeness; no invented pH crop fit; RUSLE ratio/zero-baseline semantics. These tests validate implementation invariants, **not predictive skill**.

### Spatial behavior

Date-line and polar distances/groups; polygon holes and boundary inclusion; invalid/self-intersecting/unclosed geometries; finite/ranged coordinates; spherical area; different-hazard separation; dense-comparison caps; record expiry; active warnings with older issue times; static catalog semantics.

### Ingestion, persistence and security

100 concurrent callers share one ingestion; caller cancellation does not cancel it; valid-empty clears prior data; failure preserves age; max-stale removes old payloads; negative-cache protection; disk recovery/corruption/errors; byte-bounded memory; restored-cache remaining TTL; most-recent-query source health; coordinate/country key separation; SSE capacity/backpressure; fail-closed auth; header versus query keys; security headers; fixed-origin/redirect restrictions; response-size and strict JSON limits; Retry-After preservation; family quotas; same-host backlogs cannot consume all other hosts' global slots; one longer soil attempt with five-per-minute pacing; slow/chunked body accounting; forwarded-header spoof resistance; spreadsheet formula escaping.

## Browser verification

The delivered script opens the actual production build and live backend in headless Chromium with software WebGL. It does **not** inject test fixtures into the dashboard.

1. MapLibre's actual bundled worker and style load.
2. Real modeled current conditions arrive in the location panel.
3. Accessible place search retrieves gazetteer results.
4. All 23 sources, source search and provenance inspector work.
5. Soil view displays its model/pH semantics.
6. Explicit scenario calculation works and edited inputs are marked stale relative to prior results.
7. CISA's latest 60 reference entries are not truncated by the incident window.
8. Regional map navigation, temporal filter and viewport polygon analysis work.
9. Current-filter CSV downloads with the expected structure.
10. Globe projection switches without worker errors.
11. NASA imagery returns actual JPEG tiles; the result was visually reviewed, including real swath gaps.
12. The 390px layout has no page-level horizontal overflow; layers/search/dialog controls work.
13. The run completes without uncaught browser errors or failing HTTP resources.

Screenshots were reviewed, not merely generated. The operator camera JPEG was also visually confirmed as a TfL traffic scene; the app still marks its machine-readable capture time unknown. Desktop proof is 1600×1000 and mobile-sized proof 390×844. This is not a hardware-GPU, every-browser, every-interaction or WCAG certification.

## Additional private-mode browser verification

Six additional checks passed against a separate real server with `auth_required=true` and a clearly synthetic, non-production test key. Missing/query keys returned 401; protected map/model requests received the header; saved-view restoration re-requested the correct location report; the key stayed out of local storage and normal application URLs; and a central-London camera selected on the actual map rendered through the authenticated blob pipeline. Artifact: `private-browser-verification.json`, with **zero uncaught errors**. The temporary private test server was stopped; the public demonstration remains on 7860.

The camera is intentionally not mixed into the priority incident feed. Its map interaction was used for verification. A saved location intentionally displays its user-chosen view name; assertions test both that name and coordinate/report restoration.

## Live data observations

- Ten automatic feeds all returned usable results during the session: USGS, EONET, GDACS, NWS, FIRMS NOAA-20 South Asia, NOAA Kp/alerts, ISS, BBC RSS and CISA.
- Weather, AQ, river forecast, elevation and the default rural SoilGrids profile produced actual values. The rural profile showed surface pH 8.3, SOC 9 g/kg and nitrogen 1.33 g/kg at its recorded check; they are model predictions, not measurements.
- Additional live requests exercised ADSB.lol, TfL (890 catalog records at that check), NASA POWER, GBIF, World Bank and geocoding.
- GDELT returned unavailable states rather than valid article data. It remains an optional transparent adapter; there is no fake healthy-empty or invented story fallback.
- FIRMS Area returned `disabled / credentials_required`; no real MAP_KEY was supplied, so successful credentialed access is not claimed.
- An urban Agra soil query returned a valid **empty** result: pH and stock stayed null. A separate cold rural query timed out/unavailable during a probe. The already retrieved default rural profile was not relabeled or substituted for that point.
- ISRIC's five-calls/minute rule was explicitly verified during final hardening. The initial faster host pacing was corrected to ≥12.1-second spacing, with a single longer read allowance and bounded overall task time. Cold/queued queries may still be partial/unavailable; this is documented rather than hidden.
- Record counts change over time and include overlap, catalogs and model timesteps. They are not a count of independently verified disasters. A health record may become stale after the screenshot; retain the check timestamp with any quoted number.

The source state shown for an adapter is its most recently served/refreshed query in this process, not a comprehensive worldwide provider-uptime measurement. A cached response and a different-point outage can coexist legitimately.

## Defects found and corrected before handover

- MapLibre 6's worker was missing from the initial bundle; explicit Vite worker-URL bundling fixed it.
- CARTO delivered API-key-required placeholder images despite HTTP 200. It was replaced by legitimately keyless, attributed OpenFreeMap—not bypassed.
- A valid decoded vector tile exceeded an initial 1.5 MB limit. Browser/globe testing caught it; the bounded limit is now 4 MB.
- Incident-time filtering incorrectly reduced a static CISA reference catalog. Catalog semantics are now separate.
- Slow request-body buffering was initially outside the inflight reservation. It is now counted before waiting and releases on every exit.
- Split soil normalization could discard a valid half when the other half had schema drift. Independent normalization and explicit partial warnings now preserve valid results.
- Cache restart scheduling could grant a restored response another full TTL. It now uses remaining TTL.
- Memory cache had only an entry cap. It now also enforces a serialized-byte budget.
- A cache hit did not always update the last-served source-health view after another coordinate failed. It now does.
- Saved-view restoration, mobile inspector state, coordinate hemispheres, accessible search, authenticated map/image fetches and timeout-versus-user-cancellation handling were corrected/reviewed.

## Not executed / not certified

- Docker image build and Compose runtime: no Docker daemon available. Definitions are supplied, not claimed as validated on a real server.
- User-owned CI run or repository publication: no account was connected or used for that purpose.
- Real NASA key authentication, paid endpoints, AISstream/OpenSky/Copernicus/OpenAQ integrations: not live-tested or not implemented, as identified in the API guide.
- Sustained production concurrency, multi-replica operation, long soak tests, backup restoration on the chosen host and a formal security assessment.
- Empirical hazard-model calibration, agricultural ground-truth validation, satellite-derived crop-health analysis or emergency-service suitability.
- Comprehensive browser/GPU/device/accessibility testing or a guarantee against future provider/license/schema changes.

## Release classification

**A working, source-complete, production-oriented single-process research application with reproducible checks and honest boundaries.** The hosted preview demonstrates the implemented flow today. It is not a permanent hosting commitment, a full feature port of both monorepos, a security certificate or a calibrated environmental warning product.
