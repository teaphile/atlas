# ATLAS 2.0 — ground-level review and change record

## Scope and honesty

This review targets **the original ATLAS integration**, not a clone of TerraWatch or OSIRIS. The existing read-only upstream audit remains pinned and unchanged. The v2 baseline indexed 47 first-party source/test/script files and 16,838 lines (`baseline-inventory.json`); local baseline commit `e039206` enables a concrete diff. Inventory, focused module review, static checks, invariant tests and real browser/API exercises are not a formal proof of every line.

## Significant findings and implemented corrections

| Area | Finding | Correction / evidence |
|---|---|---|
| Snapshot lifecycle | A shared busy flag could retain an obsolete camera/auth request | Generation-owned AbortController, active guard and one queued refresh; hook race tests deliberately resolve obsolete requests |
| Location lifecycle | A recovered refresh could leave an older error; soil and fast responses had separate completion paths | `useLocation` merges independently settled soil into the correct coordinate/auth generation, clears recovered errors, and supports retry |
| Context requests | Module reuse/country/auth changes needed stronger ownership; a shared loading string conflated providers | Per-provider controllers, a loading Set, cleanup and auth-aware component keys. The old coordinate component key already mitigated some coordinate switches; this was not an unconditional defect in every v1 navigation |
| HTTP wrapper | Redirect handling, error payload shape and response size were insufficiently constrained | Same-origin only, redirect refusal, bounded streaming JSON, content-type checks, bounded FastAPI errors, cancellation/deadline distinction |
| Scientific inputs | Python/Pydantic booleans could become numeric zero/one | Explicit scientific input validator; comparison, point and erosion tests |
| Provider contracts | Null nested weather/AQI/daily objects could raise accidental normalization errors | Dedicated unit-aware, bounded normalization, null-preserving arrays and quality counters |
| Weather labels | Range-based WMO interpretation could label unsupported codes as weather; daily cards always used a sunny symbol | Exact supported-code mapping and condition-specific glyphs; unexpected codes withheld |
| UTC clocks | Frontend appended `Z` even to offset-aware timestamps | One UTC parser; tests for naive-UTC, Z and explicit offsets |
| Cache restoration | Future/naive cached clocks or unsuitable stored states could be reused | Validate restoration metadata; version weather/AQI keys to reject short v1 series |
| SQLite | Save errors could leave a transaction open; oversized entries were silently skipped | Transaction context rollback and explicit budget result; rollback/recovery test |
| Persistent-cache reporting | Memory-only data could be described as persisted | Explicit warning and memory-budget recalculation |
| NWS | `message_type=alert` filtered out update-type active bulletins | Request the active actual-status feed without that narrowing restriction; overlap remains disclosed as records, not unique incidents |
| AOI filters | Area report omitted priority/cutoff; empty kinds meant all kinds | Distinguish omitted/null from an empty selection; apply layer/priority/cutoff filters and position lifetimes consistently |
| Proximity | Candidate truncation was silent and callable numerical arguments were unchecked | Bounded numeric validation, recent-first candidate cap and explicit candidate/group truncation metadata |
| Saved views | Center validation did not validate all place/geometry fields | Strict allowlisted workspace/saved-view parsing, byte/version/enumeration bounds and atomic import |
| Key handling | Header keys could contain unusable control/whitespace characters | Visible ASCII 32–256-character policy; key remains browser-memory-only and never in workspace exports |
| Derived methods | Existing single-score screening was too narrow for exploratory analysis | Separate transparent methods, completeness counts, clocks and explicit limitations; no new hazard probabilities |
| Source provenance | Standalone derived export needed its own location/grid/attribution | Report provenance and CSV metadata now travel with derived arrays |
| Responsive UI | Tiny labels and desktop-shrink behavior degraded phone use | Readable mobile header/bottom tool rail, safe-area spacing, container-based chart grids, touch targets, scrollable tables and reduced motion |
| Accessibility | Automated checks found low-contrast provenance text and a nonfocusable scroll region | Colors corrected, keyboard-focusable data regions, skip link and explicit form labels; final sampled axe runs have zero violations |
| Lazy-loading integration | Lazy MapLibre CSS overrode the map host's absolute positioning, collapsing its actual canvas container | Specific host positioning/100% dimensions; browser checks now compare canvas and stage heights at every sampled viewport |
| Map authoring | Transient source updates must not disable drawing input | Initialization readiness is separate from source/tile loading. Actual rapid-click drawing, undo, finish and Escape were exercised |
| Local installation | Launch scripts were not executable, and the Linux development lock omitted Windows pytest colorama | Executable modes corrected; actual Linux setup/run checked; a hash-locked Windows overlay supplied |
| Startup weight | Map and analysis code were loaded with the shell | Separate lazy map/analysis bundles; final build log records their actual sizes |
| Scientific communication | Old computed screening could look continuously current | Explicit computation-age label and preserved source/model clocks |

## What was added

- Signal Lab: dew point, VPD, complete-window P/ET₀/reference balance, capped thermal time, wind rose, short-baseline novelty, robust trend descriptors and aligned Spearman associations.
- Eight Signal Lab chart panels, four location-comparison curves, record-time/type/source/priority/magnitude-depth views, interactive inspection and text-table alternatives. Existing soil, weather, discharge and scenario views remain.
- Two/three-place comparison with one server clock and no repeated soil queries.
- Polygon drawing and bounded WGS84 GeoJSON import, validated server-side topology and filtered membership reports.
- Portable workspace JSON, canonical scientific exports, chart-unit preferences, density and reduced-motion controls.
- Linux/macOS/Windows local-run instructions and publication helpers; clean Git history/release preparation.

## Deliberate non-features

No earthquake-energy proxy, calibrated hazard probability, farm prescription, invented remote-sensing index, autonomous prediction agent, global surveillance catalog or externally trained large model was added. A transparent short-baseline numerical model is more defensible here than an unvalidated “AI risk” label.

## Verification record

The final quantitative evidence lives in `VALIDATION.md`, `browser-verification-v2.json`, `private-browser-verification.json`, unit-test logs and the release manifest. Intermediate diagnostics are not passing evidence. The final browser matrix uses real provider data, not fabricated telemetry. Firefox's software WebGL path was tested with a headed virtual display; its headless environment also showed the intended WebGL-unavailable fallback.

## Publication status

GitHub connector discovery returned **unsupported** in this environment, and no authenticated destination was available. Local commits, publication instructions and an archive are prepared. **No remote repository or successful push is claimed.** The user's own `gh auth login`/Git authentication is the intended completion path; credentials should not be pasted into a chat.
