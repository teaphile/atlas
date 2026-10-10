# ATLAS architecture

## 1. Product boundary

ATLAS is a single-deployment, public-data geospatial research workspace. It combines source-linked situational awareness with location-based environmental context. It is neither an emergency warning system nor an operational flight, agronomic, engineering or clinical decision system.

The implementation is complete for the defined feature set: actual API adapters, a working UI, source inspection, calculations, area analysis and downloads. It is not feature-for-feature parity with both reviewed monorepos and is not certified production or scientific readiness.

## 2. Dataflow

```text
Browser: React + TypeScript + MapLibre
  ├── global map / globe / real imagery / filtered records
  ├── location report / scenario lab / contextual datasets
  └── source inspector / exports / local saved views
              │ same-origin HTTPS (no provider keys in browser)
              ▼
FastAPI + ASGI security edge
  validation · header auth · body/concurrency/rate limits · CSP
              │
              ▼
Engine: per-query single-flight + source-specific freshness contract
  ├── last-good memory LRU (entry + serialized-byte budgets)
  ├── SQLite WAL snapshot store (bounded; not a historical lake)
  ├── bounded SSE invalidation bus → clients refetch snapshots
  └── providers → schema adapters → canonical Payload / Event
                                  │
                                  ▼
HTTP gateway: fixed origins, TLS, no redirects, retries, quotas,
             byte/time limits, host/global concurrency, circuit breaker
                                  │
                                  ▼
Public providers + optional server-side NASA FIRMS credential
```

Raster imagery, vector tiles, font blocks and official camera images have separate bounded same-origin proxy caches. The user cannot provide an arbitrary upstream URL. The public production map style is bundled; its changing tile revision is resolved from a validated provider-owned TileJSON template.

## 3. Code map

| Module | Responsibility |
|---|---|
| `backend/atlas_app/config.py` | Validated `ATLAS_` settings; fail-closed required authentication |
| `schemas.py` | Canonical event, source, envelope, coordinate, AOI and scenario types |
| `registry.py` | 23 source definitions, coverage, TTL, max-stale, licensing and account metadata |
| `transport.py` | Bounded egress, provider-family quotas, retry/circuit state, strict JSON |
| `parsers.py` | Source-specific normalization and unit/time/null handling |
| `providers.py` | Endpoint dispatch and query construction, including split SoilGrids requests |
| `storage.py` | Serialized last-good snapshots, WAL, pruning, byte and row limits |
| `engine.py` | Single-flight, persistence recovery, negative cache, collectors and invalidation bus |
| `geo.py` | Spherical distances/area, date-line-aware AOI, bounded spatiotemporal grouping |
| `analytics.py` | Versioned attention screen, completed-hour rain, FFWI, soil stock and explicit RUSLE |
| `security.py` | ASGI body/rate/inflight limits, header-only auth and browser security headers |
| `main.py` | API composition, exports, SSE, validated image/tile proxies and static frontend |
| `frontend/src/App.tsx` | Workspace state, source polling, abortable location changes and UI composition |
| `MapView.tsx` | Real MapLibre worker, data-driven layers, globe, imagery and viewport AOI |
| `Intelligence.tsx` | Evidence brief, soil, weather/water, context, scenarios and cyber reference |
| `Sources.tsx` | Searchable source catalog and response/provenance inspector |
| `api.ts` | Same-origin-only requests, memory-only access key, cancellation versus deadline semantics |
| `utils.ts` | Display formatting, expiry-aware filtering, histogram and safe exports |
| `backend/tests`, `frontend/src/*.test.ts` | Offline fixtures and regression contracts, never production data |

## 4. Canonical records and clocks

An `Event` carries stable `id`, `source_id`, `source_record_id`, `kind`, nullable position, nullable issue/observation time, optional revision/expiry, display severity, `nature`, original URL and bounded attributes.

`nature` is one of `observation`, `model`, `forecast`, `bulletin`, `catalog`, or `news`. A source without a defensible position remains unlocated. No coordinates are invented from a publisher's headquarters or country label.

An `Envelope` adds `status`, `fetched_at`, `checked_at`, `upstream_time`, age, latency, error code, warnings and payload. These clocks have different meanings:

- **fetched_at:** last successful retrieval/normalization, unchanged during fallback;
- **checked_at:** last refresh attempt;
- **upstream_time:** provider-supplied relevant timestamp when available;
- **occurred_at:** individual record time, not silently replaced with the fetch time;
- **expires_at:** record validity boundary, checked independently of source refresh.

Fresh transport does not imply a current observation. An annual population record can be freshly fetched without becoming live population. Source health describes the last served query for that adapter, not a globally measured provider uptime SLA.

## 5. Cache and recovery contract

1. Normalize query context: coordinates to four decimal places; country and geocoding query have distinct keys. No two-decimal aliasing of soil cells.
2. A fresh cache hit returns the original envelope with computed age.
3. Concurrent misses share one task, including the disk lookup. Caller cancellation does not cancel shared ingestion.
4. Validate upstream structure and normalization. A valid empty response replaces prior records.
5. Save a successful last-good envelope; publish an invalidation. A write failure leaves the successful value usable in memory with a warning.
6. On error, retain previous data only within the source's max-stale horizon. Do not re-date old data. Otherwise return unavailable with no old payload.
7. A 60-second negative cache prevents failure storms. Admission caps bound total ingestion tasks.
8. Restored fresh snapshots consume their **remaining** TTL; restart does not grant them a second full TTL. Failed collectors retry at a bounded cadence.

ISRIC gets a 22-second per-read allowance inside the existing bounded overall deadline; other sources use the configured HTTP timeout. The store is a last-good cache, not an archive. A browser timeline filters currently retained event times; it cannot reconstruct past aircraft tracks or historical provider states.

## 6. Budgets and failure isolation

| Boundary | Implemented budget |
|---|---|
| HTTP ingress body | 64 KiB; body read deadline 10 seconds |
| Application requests in flight | 96, including long-lived streams; reserved before body buffering |
| Peer token bucket | Default 120 tokens/minute; location/AOI cost 5, others 1 |
| SSE listeners / queue | 64 listeners; 8 invalidations per client; bounded recent history |
| Source ingestion tasks / deadline | 48 / 30 seconds |
| Egress concurrency | 8 global; 2 per provider host |
| Egress attempts | At most 2; ISRIC uses one longer attempt to avoid duplicating costly cold queries |
| Default decoded source body | 4 MB; source parser limits also apply |
| Open-Meteo family local budget | 3,000 requests/day combined across subdomains |
| Other fixed hosts | 10,000 requests/day per host, deployment-local ceiling |
| Memory last-good cache | 384 entries default; 48 MB serialized-size ceiling |
| SQLite logical payloads | 384 rows default; 48 MB UTF-8; 2 MB maximum entry |
| Vector/glyph proxy cache | 220 entries / 32 MB; 32 in-flight fetches; 4 MB vector tile limit |
| Raster/camera proxy cache | 160 entries / 24 MB; 24 in-flight fetches; 600 KB image limit |
| Polygon input | ≤200 vertices, ≤3 holes, closed valid rings, <180° longitude span |
| Proximity grouping | ≤3,500 eligible records; ≤60,000 candidate comparisons |

Budgets are not an OS-level memory guarantee: Python object overhead, in-flight buffers, last-source references, SQLite pages/WAL and GPU/browser memory are additional. The deployment example adds a container memory ceiling. Budgets and cache TTLs are deliberate resource/latency trade-offs, not permission to ignore provider terms.

The demonstration preview uses a higher 480-token peer budget because proxied viewers share a peer address. Real ingress limits must distinguish trusted client identities; this application deliberately ignores spoofable forwarding headers.

## 7. Spatial algorithms

### AOI

Validate a Polygon, unwrap longitude around an anchor, reject self-intersections/oversize geometry, preserve holes and use boundary-inclusive membership. Date-line crossings are supported for regions under 180° wide. Area is a spherical approximation with holes subtracted, not an ellipsoidal cadastral survey.

Membership is against normalized observation points or provider representative points. It is **not** intersection with the full warning footprint, raster zonal statistics, population exposure or an impact perimeter.

### Proximity groups

Convert eligible points to 3D Earth-centered coordinates. Hash into spatial cells and time buckets; inspect neighboring cells/buckets; apply a haversine distance and time-window check; join matches using union-find. This avoids naive all-pairs geographic joins and works around longitude wrap and near the poles. Candidate and comparison caps make dense scenes fail boundedly, with a truncation/budget flag.

Connected components are transitive: a chain can span more than the pairwise distance threshold. Default grouping is a proximity-navigation aid. Same location/time does not prove same event, independent corroboration or ground truth. Records from a downstream aggregator may share the same original instrument. The raw source records remain intact.

## 8. Frontend behavior and accessibility boundaries

- Actual source data, not synthetic live fixtures. Network failures retain visible failure/stale state.
- Global snapshots: SSE invalidations plus 30-second polling fallback. With a deployment key, polling is used because native EventSource cannot send that header.
- Location models: concurrent current-condition requests; SoilGrids loads separately. Active-page environment refresh every 10 minutes; coordinate changes cancel obsolete client requests.
- Aircraft: opt-in regional polling; browser position-age caps. Camera catalogs/images: opt-in official operator data, unknown capture time, not video.
- Client filtering runs periodically (~10 seconds while active); background-tab browser throttling can delay visual expiry. Do not use it for navigation or emergency timing.
- Saved views are local browser navigation state; restoring a view synchronizes the selected location/report. No account synchronization.
- CSV neutralizes formula prefixes. JSON/GeoJSON preserve source/nature/time metadata and null positions.
- Native dialogs, keyboard search, labeled icon controls, focus styles, reduced-motion rules and responsive layouts are implemented. Chromium desktop/mobile-sized flows were tested; full WCAG and multi-browser certification were not performed.

## 9. Scaling boundary and next architecture

**Run one application worker per deployment in this version.** Multiple workers would duplicate polling, quotas, local caches and SSE state. SQLite is intentionally adequate for the demonstrated bounded single-process use case, not a distributed system hidden behind a demo.

For a multi-tenant/public service: separate collectors, shared rate/quota state in Redis, durable events and spatial indices in PostgreSQL/PostGIS, an object store for explicitly licensed history, a message broker for invalidation, tenant-scoped authorization and deployment-level egress controls. Add these after workload measurement, not as unused infrastructure labels.

Scientific expansion is separate: obtain defensible ground truth, hold out regions and time periods, validate/calibrate each hazard model, assess dependence and missingness, publish a model card and regional failure modes. Software tests alone cannot accomplish that.


## ISRIC access and scale clarification

ISRIC states a public beta REST fair-use limit of **5 API calls per minute** and advises against local/farm-level interpretation of SoilGrids. ATLAS now spaces ISRIC calls by at least 12.1 seconds per process and uses one longer bounded attempt, not duplicate cold-query retries. Two soil subqueries consume two calls; cached queries consume none. Shared deployments/replicas need a shared quota, and busy/cold queries can legitimately produce partial or unavailable results. [1](https://docs.isric.org/globaldata/soilgrids/SoilGrids_faqs_04.html)

The ATLAS carbon stock is a physical conversion applied to predicted component means; it is **not** the official separately trained SoilGrids carbon-stock product and need not agree with it. Product-of-means and mean-of-products differ when inputs covary. Treat the displayed point lookup as regional modeled context, never parcel/farm-level precision. [1](https://docs.isric.org/globaldata/soilgrids/SoilGrids_faqs_04.html)
