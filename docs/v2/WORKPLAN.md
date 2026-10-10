# ATLAS 2.0 — micro-audit and analyst upgrade

User-authorized scope: review and improve this ATLAS project; keep original upstream projects read-only/non-cloned. Add coherent, defensible derived analytics and usable charts; test responsive flows; prepare source publication/local use. GitHub connector discovery returned unsupported, so remote publication is blocked until authenticated publishing is available. No credentials requested in chat.

## Baseline
- 47 first-party source/test/script files, 16,838 lines indexed in `baseline-inventory.json`.
- 132 backend / 27 frontend tests pass; source snapshot committed locally for an auditable diff.
- This is programmatic inventory plus module-level review, not a claim of formal verification of every line.

## Planned implementation
- [x] Harden input types, malformed provider handling, cache clocks/lifecycle, API privacy and filter consistency.
- [x] Extend existing weather/AQ requests (not new bulk downloads) for seven-day modeled context and a 72-hour forecast horizon.
- [x] Derived analytics: dew point, vapor-pressure deficit, reference P−ET0 balance, configurable thermal accumulation, wind distribution; explicit units/windows/coverage.
- [x] Compact transparent models: diurnally adjusted robust novelty (shrinkage covariance), robust trend descriptors, timestamp-aligned correlations; no risk probabilities or unsupported ML superiority claim.
- [x] Signal Lab with interactive/null-preserving charts, data tables/exports, model explanations, coverage and provenance.
- [x] Compare up to three locations using consistent horizons and source timestamps; avoid redundant soil queries.
- [x] Event analytics: counts/magnitude/depth/distribution and available-catalog semantics. Energy proxies deliberately omitted (unsupported provenance/mixed magnitude types).
- [x] Draw/import a bounded polygon; consistent kind/severity/time filters in maps, exports and AOI reports.
- [x] Portable workspace import/export, unit preferences, keyboard/navigation improvements, failure/retry UI.
- [x] Responsive shell and content at 320, 360, 390, 430, 768, 1024, 1280, 1440, 1920, 2560 widths plus short landscape cases and reduced-motion controls. Physical-device/high-browser-zoom coverage is not claimed.
- [x] Offline scientific/property/interaction tests, real API smoke, browser + accessibility checks; no fixture data in production.
- [x] Local-first Linux/macOS/Windows/Docker instructions, reproducible CI, model cards, migration/release notes, clean source archive and Git publication workflow.

## Issues identified in initial review
- Context requests need explicit cancellation/generation ownership for reuse and auth changes; the existing coordinate component key already mitigated some location changes. One shared loading string also conflates concurrent providers.
- Snapshot refresh uses a cross-generation busy ref without aborting obsolete requests; camera/auth changes can allow a prior query to overwrite new state.
- A successful later location refresh does not clear an earlier location error message.
- Profile refresh and initial soil merge can race; old generated screening scores need a clear computation timestamp, not an implicit claim to be current.
- HTTP wrapper distinguishes timeouts but error payload shape/length and redirects need tightening before any new dynamic controls.
- Stored-view parsing does not fully validate geometry or optional place metadata; imports need a strict allowlist, version and byte cap.
- AOI accepts kind/time window but not the map's severity/cutoff filter, producing mismatched counts.
- `proximity_groups` does not flag its 3,500-candidate truncation and should validate all public model parameters.
- RUSLE/point models coerce booleans to numeric values; strict scientific input semantics needed.
- ISO timestamp parsing and current condition renderers have inconsistent null/UTC assumptions.
- NWS adapter explicitly excludes update-type alerts; cover current update messages without claiming complete warning coverage.
- Weather/AQ dict validation can dereference null nested objects; optional units/times/series need independent validation.
- Source cache restoration does not sufficiently reject future/naive timestamps; disk save failures can leave a transaction open without rollback.
- Four layers of CSS/media overrides and very small labels need a measured accessibility/responsive pass rather than assuming desktop shrinkage is enough.

## Non-negotiable semantics
Never fabricate observations, replace no-data soil with another location, infer probability from a score, interpret P−ET0 as runoff/irrigation need, label a seven-day model baseline as climate, equate correlation/proximity with causation/corroboration, or claim universal working/screen/security/scientific certification.

## Final scope decisions
- Active polygons now survive tab switches, named-view save/restore and workspace export/import; imported/saved polygons fit the camera without changing source geometry.
- Launch script executable bits were corrected and the actual Linux setup/build/run paths were exercised. Windows conditional pytest dependency has a separate hash-locked overlay.
- [ ] Authenticated GitHub push: blocked by unsupported connector/no authenticated destination. Local commits and publication helper are delivered instead; no remote success is asserted.
- Native macOS/Windows execution, Docker execution, full accessibility/scientific calibration and production load tests remain explicit external verification gates.
