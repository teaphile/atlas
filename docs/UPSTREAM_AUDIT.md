# TerraWatch × OSIRIS — source-level review

**Review date: 10 October 2026. Method: remote, read-only; no git clone; no execution of upstream applications.**

## Executive assessment

The complementary strengths are clear: TerraWatch is a Python-first environmental analysis service; OSIRIS is a multi-source geospatial operations interface. A literal merger would also combine incompatible data semantics, independent caches, different client/server assumptions and unvalidated numerical outputs. ATLAS therefore implements a new shared contract and a focused end-to-end product, rather than transplanting two application trees.

The most valuable improvement is not “more decimals” or an artificial intelligence label. It is preserving the distinction between **observed events, model values, forecasts, bulletins, catalogs and publisher reports**, with bounded resource use and traceable failure behavior.

## What was actually reviewed

| Repository | Pinned revision | Tree files inventoried | Selected text files read in memory | Lines triaged |
|---|---|---:|---:|---:|
| TerraWatch | `1f91f9eb521659051ee39fce6a5067ac8b9aec05` | 120 | 109 | 15,216 |
| OSIRIS | `83b8cd1be24d0d6134c0c1f775625330fcb87996` | 1,088 | 443 | 87,405 |
| Total | — | 1,208 | **552** | **102,621** |

- Full path/digest/line-count/indicator inventory: `audit-manifest.json`. Zero read errors were recorded for the selected files.
- `scripts/read_only_review.py` performs bounded HTTP reads into memory, extracts source identifiers/domains/indicators and saves metadata, not upstream file bodies.
- The breadth pass is programmatic triage, **not a claim that every line was manually verified**. Focused review examined consequential authentication, API, cache, normalization and scientific paths.
- Vendor dependencies, binary/model artifacts, public asset collections, generated camera catalogs, static datasets and lockfiles were excluded. No datasets or trained weights from either project were cloned.
- The scope is those pinned revisions. This is not a penetration test, formal verification, an exhaustive vulnerability assessment or a verdict about later releases.

## TerraWatch: findings and implications

Source root: [pinned TerraWatch tree](https://huggingface.co/spaces/teaphile/terrawatch/tree/1f91f9eb521659051ee39fce6a5067ac8b9aec05).

### TW-01 · Required-auth configuration can fail open

**Evidence:** `backend/app/api/middleware/auth.py:41–48`; `backend/app/config.py:80–85`.

The reviewed bypass condition accepts either authentication being disabled **or the configured key being empty**. The configuration path logs the invalid required-key state instead of rejecting startup. Thus a deployment that explicitly requests authentication but forgets its secret can remain accessible. This is a configuration-dependent finding, not evidence of an exploited deployment. Query-string key support also creates avoidable URL/history/log exposure.

**ATLAS:** startup rejects required authentication without a 32–256 character ASCII secret; header-only `X-Atlas-Key`; timing-safe comparison; input values hidden in settings validation errors. Tests cover absent/short/oversized/non-ASCII keys, query-key rejection and header acceptance. The frontend keeps its access key in page memory only.

### TW-02 · Rainfall time scales and components need separation

**Evidence:** `backend/app/services/disaster_service.py:185–193, 275`.

The reviewed composition uses defaulted missing inputs and can add `precipitation` to `rain`, although the latter is a component of the former for the relevant weather API. Another path passes current-interval precipitation into a 24-hour quantity. These changes alter the meaning and magnitude of downstream inputs.

**ATLAS:** only the 24 completed hourly precipitation endpoints are summed; no rain double-counting; one missing hour makes the 24-hour total unknown. Tests cover missing, duplicate/future time handling and component separation. Values remain **modeled** rainfall, not rain-gauge measurements.

### TW-03 · Heuristic scores are not calibrated probabilities

**Evidence:** `backend/app/models/landslide_model.py:104–116`; `backend/app/models/flood_model.py:274–290`; `backend/app/services/disaster_service.py:314–317, 379+`.

Weighted heuristic outputs, return-period labels and aggregation of unlike scores are not interchangeable with event probabilities or locally fitted frequency estimates. The disaster service itself contains an unvalidated-model disclosure; that qualification must survive into client presentation. Reviewed code paths do not establish site-specific calibration for transfer into a new product.

**ATLAS:** no flood/landslide/liquefaction probability, return period or universal disaster score is manufactured. The environmental attention index explicitly declares its designer-chosen weights, input coverage and missing-input sensitivity. River discharge is displayed as a model series, not inundation probability. RUSLE is a separate assumption-driven scenario.

### TW-04 · Soil and crop confidence should not outgrow the data

**Evidence:** `backend/app/models/soil_model.py:208–232, 267–270`.

Heuristic/base-value and fixed-confidence paths do not demonstrate calibrated confidence in local crop performance. Soil model predictions are not lab samples, and total nitrogen is not automatically plant-available nitrogen.

**ATLAS:** ISRIC conversion factors, depth labels, null cells and surface Q05/Q95 predictions are retained. Carbon stock needs SOC, bulk density and coarse fragments at all three depths. Crop output is a deliberately limited pH-compatibility screen, not yield, fertilizer or suitability advice. No phosphorus/potassium values are invented from missing SoilGrids fields.

### TW-05 · Short-window weather is not a climate normal

**Evidence:** `backend/app/services/weather_service.py:431–466`.

Annualizing a short rainfall window or substituting latitude-based climatology without a separate provenance label can make guessed climate inputs look observed.

**ATLAS:** no annualization of the recent forecast is used to create annual climate or erosion factors. NASA POWER is explicitly a delayed seven-day historical model context, not a 30-year climate normal. Annual RUSLE factors remain user-supplied assumptions.

### TW-06 · Analytical vegetation fallback is not observed NDVI

**Evidence:** `backend/app/services/satellite_service.py:42–54, 66–75`.

An analytical NDVI-like fallback cannot establish satellite observation. The reviewed remote coverage/query assumptions also need live endpoint and measurement validation before being promoted as vegetation evidence.

**ATLAS:** genuine NASA GIBS imagery is offered with a date lag and cloud/gap warning. NDVI, crop stress, canopy health and biomass are **not claimed or fabricated**. A future Sentinel/Landsat workflow needs actual bands, QA masks, cloud screening and validated processing.

### TW-07 · Useful existing engineering worth retaining conceptually

- `data/ingestion/soil_fetcher.py` already uses repeated SoilGrids query keys and depth weighting; those are useful patterns. Two-decimal spatial cache keys and long retry paths still need attention for a field-scale interface.
- The Hugging Face origin handling in `backend/app/main.py:115–130` converts the wildcard into an anchored regular expression. **It should not be reported as a broken literal wildcard CORS configuration.**
- The environmental service/model separation is a sound starting point. ATLAS preserves that separation instead of combining provider transport and scientific interpretation in one route.

## OSIRIS: findings and implications

Source root: [pinned OSIRIS tree](https://github.com/simplifaisoul/osiris/tree/83b8cd1be24d0d6134c0c1f775625330fcb87996).

### OS-01 · Empty success versus last-good fallback

**Evidence:** `src/lib/sourceCache.ts:58–79`; associated source-cache tests were included in triage.

Keeping previous records after a valid empty result can resurrect events that have ended. Resetting cache time while retaining older content can also hide true age. Such retention can be a deliberate catalog-specific choice, but it is not a safe generic incident-feed rule.

**ATLAS:** validated empty payloads replace previous non-empty snapshots. Errors may retain last-good data only within the source's max-stale horizon, without resetting `fetched_at`. Cache miss, expiry, negative cache, storage errors, restart persistence and 100-caller single-flight behavior have offline tests.

### OS-02 · SSRF defenses are substantial, not absent

**Evidence:** `src/lib/ssrf-guard.ts:8–15, 118–163, 184–214`.

The reviewed implementation rejects reserved IP ranges, resolves A/AAAA records and revalidates redirects. Its comments acknowledge the remaining socket-address-pinning/TOCTOU boundary. That is not, by itself, a demonstrated exploit.

**ATLAS:** deliberately narrower attack surface: no arbitrary-URL endpoint, exact HTTPS provider allowlist, no redirects and validated tile/camera identifiers. This does **not** constitute DNS/socket pinning; a production egress firewall and trusted DNS remain required defense in depth.

### OS-03 · Provider diversity and asynchronous isolation are useful

**Evidence:** `src/app/api/earthquakes/route.ts`; `fires/route.ts:18–19,44`; `weather/route.ts:175–189,312+`.

USGS, FIRMS/EONET, NWS and GDACS integrations and all-settled-style aggregation are valuable. Geometry averaging, provider coverage differences and missing positions still require explicit semantics: an average point is not an impact footprint.

**ATLAS:** source failures are isolated. NWS null geometry remains unlocated; polygon summaries use a point inside the provider geometry where possible. Area reports test representative-point membership, not hazard footprint overlap or population exposure.

### OS-04 · Mobility sources have credentials and temporal limits

**Evidence:** `src/app/api/flights/route.ts`; `src/app/api/maritime/route.ts:98–140,214–215`.

OpenSky OAuth/quota handling, an ADS-B fallback and AISstream's key/streaming-snapshot constraints are different operational products. The reviewed maritime path no longer relies on its earlier mock fallback; it should not be accused of doing so.

**ATLAS:** a reception-limited, opt-in ADSB.lol regional view and official TfL London cameras are implemented. AIS maritime, global camera aggregation and full orbital catalogs are explicitly deferred, not populated with dummy tracks. Position expiry, unknown capture time and regional coverage are visible.

### OS-05 · Default analytics are a deployment choice

**Evidence:** `src/middleware.ts:27–41`.

The reviewed middleware sends internal Umami page/network telemetry that can include IP information. This is an operational/privacy choice, not proof of secret exfiltration.

**ATLAS:** no default visitor analytics, face recognition, owner enrichment or account profile. Selected coordinates/search terms still reach upstream providers, and cache keys retain query context; see the privacy section in `SECURITY.md`.

### OS-06 · Simulation mechanics do not transfer calibration

**Evidence:** `src/lib/oi/aggregate.ts:23–27,38–48,91–109` and neighboring OI code/tests inventoried in the manifest.

Weighted choices, simulated worlds and quantile aggregation can be valid computational tools. They do not establish a calibrated environmental forecast for the use case of this merger. The review does not claim to have disproved every forecast in OSIRIS.

**ATLAS:** bounded spatial-temporal proximity groups are an evidence-navigation tool, explicitly **not corroboration, independent votes, probabilities or unique-incident resolution**. No LLM-generated predictive oracle is presented as a scientific model.

## Capability merger: implemented versus deliberately not ported

| Capability | ATLAS disposition |
|---|---|
| Multi-provider map and environment reports | Implemented, live-tested |
| Source catalog, provenance, stale/empty/outage states | Shared contract across 23 adapters |
| Soil, weather, air, river context | Implemented with explicit model semantics |
| Public incidents, space weather, news, cyber reference | Implemented; no fabricated locations |
| Regional aircraft and operator cameras | Opt-in; scoped and expiry-aware |
| Spatial grouping and bounded AOI analysis | Implemented; not exposure/risk inference |
| RUSLE and soil stock calculations | Explicit assumptions/units; not field validation |
| Maritime AIS, global satellite fleet, global CCTV catalog | Not ported; credential/licensing/operational extension work |
| NDVI/crop-health/biomass pipelines | Not implemented without actual calibrated imagery workflow |
| Autonomous alert dispatch or AI prediction agents | Not implemented; no simulated “live” output |
| Historical event lake, multi-tenant auth, distributed queues | Production extension, not hidden behind demo UI |

## Findings from testing the new project itself

The integration was not treated as correct just because it compiled. Browser review exposed and corrected a missing MapLibre 6 worker asset and CARTO HTTP-200 tiles that actually displayed “API KEY REQUIRED.” The basemap was replaced with attributed OpenFreeMap, not bypassed. A later globe/mobile check caught a legitimate 1,562,540-byte decoded tile exceeding an overly tight 1.5 MB limit; the bounded tile limit is now 4 MB. Tests also prompted fixes for catalog time-window semantics, slow-body concurrency accounting, partial soil normalization, restored-cache scheduling, byte-bounded memory caches, and saved-view location synchronization.

These are evidence of a test-and-correct process, **not a claim that every defect or scientific limitation has been eliminated**. Final verification artifacts and release caveats are listed in `VALIDATION.md`.
