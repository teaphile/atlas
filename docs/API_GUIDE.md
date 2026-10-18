# API, account and licensing guide

**Checked: 10 October 2026.** Endpoint access and terms can change. The runtime source catalog is the executable inventory; the tables below document the delivered implementation, not a promise of permanent free availability.

## What works without accounts

There are **23 implemented adapters**: 22 have keyless request paths; one optional NASA FIRMS Area adapter needs a server-side MAP_KEY. These are adapters, not 23 independent sensor networks. Ten collectors start automatically; location, mobility and contextual services are loaded on demand.

Across the recorded live checks, 21 keyless adapters returned usable responses. GDELT returned an unavailable state (schema/timeout behavior), and keyed FIRMS Area was intentionally disabled because no credential was supplied. This is not a claim that all 23 are always live or that all observations are current. See `VALIDATION.md`; raw historical logs are archived in Git tag `v2.0.0`.

### Implemented inventory

TTL below is a **fetch-cache rule**, not a sensor sampling frequency. “On demand” means request the adapter through its API or UI; a source catalog row does not itself perform ingestion.

| ID / provider | Coverage & meaning | Activation | TTL / maximum stale | Account |
|---|---|---|---|---|
| `usgs` · [USGS](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php) | Global · M2.5+ · trailing 7 days; Instrument catalog | Automatic | 120s / 1800s | No key in this implementation |
| `eonet` · [NASA EONET](https://eonet.gsfc.nasa.gov/docs/v3) | Global · open events · 30-day query; Curated event reports | Automatic | 600s / 3600s | No key in this implementation |
| `gdacs` · [GDACS / EC-JRC](https://www.gdacs.org/) | Global · current RSS bulletin; Official impact bulletin | Automatic | 300s / 1800s | No key in this implementation |
| `nws` · [NOAA / NWS](https://www.weather.gov/documentation/services-web-api) | United States and territories only; Official warning | Automatic | 300s / 1800s | No key in this implementation |
| `firms` · [NASA FIRMS · NOAA-20](https://firms.modaps.eosdis.nasa.gov/active_fire/) | South Asia public 24-hour product; Satellite detection | Automatic | 900s / 5400s | No key in this implementation |
| `space_kp` · [NOAA SWPC](https://www.swpc.noaa.gov/products/planetary-k-index) | Planetary · 3-hour index; Space-weather index | Automatic | 300s / 1800s | No key in this implementation |
| `space_alerts` · [NOAA SWPC](https://www.swpc.noaa.gov/products/alerts-watches-and-warnings) | Global advisory feed; Official bulletin | Automatic | 300s / 1800s | No key in this implementation |
| `iss` · [Where the ISS at?](https://wheretheiss.at/w/developer) | International Space Station only; Orbit-derived position | Automatic | 30s / 120s | No key in this implementation |
| `news` · [BBC News RSS](https://www.bbc.co.uk/news/10628494) | BBC world feed · publication timestamps; Publisher headlines | Automatic | 600s / 3600s | No key in this implementation |
| `cisa` · [CISA KEV](https://www.cisa.gov/known-exploited-vulnerabilities-catalog) | Known exploited CVEs · latest 60 additions; Vulnerability catalog | Automatic | 21600s / 86400s | No key in this implementation |
| `weather` · [Open-Meteo](https://open-meteo.com/en/docs) | Global · grid resolution varies by model; Numerical weather model | On demand | 600s / 1800s | No key in this implementation |
| `air_quality` · [Open-Meteo / CAMS](https://open-meteo.com/en/docs/air-quality-api) | Global · CAMS grid; Atmospheric composition model | On demand | 1800s / 5400s | No key in this implementation |
| `flood` · [Open-Meteo / GloFAS](https://open-meteo.com/en/docs/flood-api) | Global modeled river grid · nearest cell; Hydrological model forecast | On demand | 3600s / 21600s | No key in this implementation |
| `soil` · [ISRIC SoilGrids](https://docs.isric.org/globaldata/soilgrids/SoilGrids_faqs.html) | Land · 250 m model · 0–30 cm; Static digital soil model | On demand | 86400s / 86400s | No key in this implementation |
| `elevation` · [Open-Meteo Elevation](https://open-meteo.com/en/docs/elevation-api) | Global · nominal 90 m DEM; Digital elevation model | On demand | 86400s / 86400s | No key in this implementation |
| `aviation` · [ADSB.lol](https://www.adsb.lol/docs/open-data/api/) | 150 nautical miles around selected point; reception-limited; Public ADS-B receiver reports | On demand | 60s / 120s | No key in this implementation |
| `tfl` · [Transport for London](https://api.tfl.gov.uk/) | London public JamCam network; Public operator camera catalog | On demand | 1800s / 10800s | No key in this implementation |
| `nasa_power` · [NASA POWER](https://power.larc.nasa.gov/docs/services/api/) | Selected point · recent 7-day window with 10-day lag; Gridded historical model | On demand | 86400s / 86400s | No key in this implementation |
| `gbif` · [GBIF](https://www.gbif.org/developer/occurrence) | 0.4° box around point · sample of at most 30 records; Occurrence catalog | On demand | 86400s / 86400s | No key in this implementation |
| `worldbank` · [World Bank](https://datahelpdesk.worldbank.org/knowledgebase/articles/889392) | Selected country · latest population estimate; Annual country indicator | On demand | 86400s / 86400s | No key in this implementation |
| `gdelt` · [GDELT](https://www.gdeltproject.org/) | Global · trailing 24-hour hazard query; Aggregated news links | On demand | 900s / 5400s | No key in this implementation |
| `firms_area` · [NASA FIRMS Area API](https://firms.modaps.eosdis.nasa.gov/api/area/) | Selected ±2° area · NOAA-20 VIIRS · 1 day; Satellite detection | On demand | 900s / 5400s | Free MAP_KEY |
| `geocoding` · [Open-Meteo / GeoNames](https://open-meteo.com/en/docs/geocoding-api) | Global named places; Reference gazetteer | On demand | 86400s / 86400s | No key in this implementation |

## Accounts and deployment decisions

### NASA FIRMS Area — implemented, optional, no key fabricated

1. Request a free key at https://firms.modaps.eosdis.nasa.gov/api/map_key/ .
2. Put `ATLAS_FIRMS_MAP_KEY=...` in the **server** environment or local uncommitted `.env`.
3. Restart the application. The `firms_area` catalog entry changes from “Needs key.”
4. Use its source inspector or `GET /api/v1/sources/firms_area?lat=27.1&lon=78.15`.

The implementation requests NOAA-20 NRT detections in a bounded ±2° area for one day. It is a source-inspector/API extension; it is not silently substituted for the default global map snapshot. Coordinate bounds are clipped near poles/date-line, not represented as universal coverage. The no-key South Asia NOAA-20 CSV already powers the default thermal layer, complemented by geographically coarser global EONET events.

Provider quotas apply, and the key's live credential path was not tested without a real key. Application source errors do not echo secret-bearing upstream URLs. NASA URLs intrinsically contain the key on the server request path, so ingress/egress/debug logging must also be reviewed by the operator.

FIRMS references: https://firms.modaps.eosdis.nasa.gov/api/area/ and https://firms.modaps.eosdis.nasa.gov/active_fire/ . S-NPP service changes were announced for early November 2026 with differing date wording across pages; this implementation already uses NOAA-20 rather than depending on S-NPP. Recheck official announcements before production.

### Open-Meteo — free data is not unrestricted free hosting

The free hosted APIs are for **non-commercial use**. The published free-hosted limits reviewed were 10,000/day, 5,000/hour and 600/minute; ATLAS uses a more conservative combined deployment-local ceiling of 3,000/day across their subdomains. This ceiling resets with the process and is not a shared multi-replica quota system.

The data license and the hosted-service contract are distinct. Commercial deployment needs an appropriate plan or a properly operated/licensed alternative. A paid customer endpoint/key is **not prewired** by adding an arbitrary frontend key: extend the gateway/adapter configuration and validate the chosen plan's endpoint. Terms: https://open-meteo.com/en/terms . The app repeats this restriction in the source catalog.

Open-Meteo serves several different products here: weather, modeled AQ, river discharge, elevation and geocoding. Their availability does not imply independent observation networks or equal spatial resolution.

### No-account visual data

- OpenFreeMap provides the actual vector basemap. Its public instance states no registration/API key and allows commercial use, with required attribution and no SLA: https://openfreemap.org/ . ATLAS still bounds proxy usage, avoids bulk/offline scraping and retains attribution.
- NASA GIBS supplies imagery requested for UTC date minus two days. It is not current live video and can contain cloud/swath/no-data gaps.
- TfL's public JamCam catalog responded without a key in this run. Images are official public operator snapshots; use/redistribution remains governed by TfL's terms. A future quota/access policy change must not be bypassed.

## Useful next integrations — documented, NOT implemented

These are real integration directions, not hidden enabled features or fake credential fields:

| Service | Typical account/access path | Intended extension | Work still needed |
|---|---|---|---|
| NASA Earthdata | Free Earthdata Login; dataset-dependent authorization | Historical Landsat/MODIS and scientific granules | Dataset selection, QA/cloud masks, licensed retention and processing validation |
| Copernicus Data Space | Account/OAuth for relevant downloads/services; public catalogs vary | Sentinel-based actual vegetation/land monitoring | Band processing, atmospheric/QA handling, STAC and workload controls |
| OpenAQ v3 | API account/key; verify current tier/quotas | Station-grounded air-quality context | Unit harmonization, station coverage, sensor QA and temporal alignment |
| OpenSky | Account/OAuth and use-dependent quotas/terms | Alternative aviation reception coverage | Provider-specific auth/quota management; do not assume unrestricted commercial access |
| AISstream | API key and persistent WebSocket; verify current terms | Maritime reception layer | Subscription bounds, licensed retention, reconnect/backpressure, privacy and expiry |
| TfL developer access | Optional account/app credentials for supported access plans | More dependable operator quota allocation | Server-side credential configuration and updated terms verification |

Official entry points: https://urs.earthdata.nasa.gov/ · https://dataspace.copernicus.eu/ · https://docs.openaq.org/ · https://openskynetwork.github.io/opensky-api/rest.html · https://aisstream.io/ · https://api-portal.tfl.gov.uk/ . Accounts were not created and no credentials for these extensions were obtained.

## HTTP interface

Open `/docs` on the live app for the self-hosted endpoint reference, or download `/api/openapi.json`. No external Swagger CDN is required. Examples assume your own local instance; the browser frontend itself always uses same-origin URLs.

```sh
curl http://127.0.0.1:7860/api/v1/health
curl http://127.0.0.1:7860/api/v1/snapshot
curl 'http://127.0.0.1:7860/api/v1/location?lat=27.1&lon=78.15'
curl 'http://127.0.0.1:7860/api/v1/sources/soil?lat=27.1&lon=78.15'
curl 'http://127.0.0.1:7860/api/v1/sources/worldbank?country=IN'
curl 'http://127.0.0.1:7860/api/v1/fusion?hours=72'
curl -N http://127.0.0.1:7860/api/v1/stream
```

Private deployment requests require `X-Atlas-Key`, **not a query parameter**. Use your secret manager/shell environment, not a committed literal credential. A source endpoint can return HTTP 200 with `status: unavailable` or `disabled`: inspect the envelope, not just HTTP reachability. Tile/image transport failures use non-2xx HTTP errors because their clients expect binary resources.

`/location` excludes soil by default to avoid blocking the quick model panel. Use `include_soil=true` for a combined response or request soil separately as the UI does. `include_cameras=true` in `/snapshot` includes an already loaded catalog; it does not itself request every camera. Aircraft are client-region-scoped, not broadcast to all snapshot viewers. AOI uses current retained server-side records, not the local aircraft overlay.

## Dataset-specific notices

- **usgs / U.S. Geological Survey:** USGS public-domain data; retain attribution. [Provider reference](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php).
- **eonet / NASA Earth Observatory Natural Event Tracker:** NASA data policy; individual reporting sources have their own terms. [Provider reference](https://eonet.gsfc.nasa.gov/docs/v3).
- **gdacs / GDACS / European Commission Joint Research Centre:** CC BY 4.0; retain source acknowledgements. [Provider reference](https://www.gdacs.org/).
- **nws / U.S. National Weather Service:** U.S. government data; observe API User-Agent and usage guidance. [Provider reference](https://www.weather.gov/documentation/services-web-api).
- **firms / NASA FIRMS / VIIRS NOAA-20:** NASA FIRMS citation required. NRT products are not science-quality validation data. [Provider reference](https://firms.modaps.eosdis.nasa.gov/active_fire/).
- **space_kp / NOAA Space Weather Prediction Center:** U.S. government data; retain attribution. [Provider reference](https://www.swpc.noaa.gov/products/planetary-k-index).
- **space_alerts / NOAA Space Weather Prediction Center:** U.S. government data; retain attribution. [Provider reference](https://www.swpc.noaa.gov/products/alerts-watches-and-warnings).
- **iss / Where the ISS at?:** Attribution and API rate limits apply; not a satellite catalog. [Provider reference](https://wheretheiss.at/w/developer).
- **news / BBC News:** Publisher copyright. Headline, short feed excerpt and link only; review reuse terms. [Provider reference](https://www.bbc.co.uk/news/10628494).
- **cisa / CISA Known Exploited Vulnerabilities:** U.S. government catalog; links retain NVD/CISA attribution. [Provider reference](https://www.cisa.gov/known-exploited-vulnerabilities-catalog).
- **weather / Open-Meteo and its weather-model contributors:** CC BY 4.0 data; hosted free API is NON-COMMERCIAL with quotas. [Provider reference](https://open-meteo.com/en/docs).
- **air_quality / Open-Meteo / Copernicus Atmosphere Monitoring Service:** CC BY 4.0; free hosted API non-commercial only. [Provider reference](https://open-meteo.com/en/docs/air-quality-api).
- **flood / Open-Meteo / Copernicus GloFAS:** CC BY 4.0; free hosted API non-commercial only. [Provider reference](https://open-meteo.com/en/docs/flood-api).
- **soil / ISRIC — World Soil Information / SoilGrids 2.0:** CC BY 4.0. Keep depth, units and uncertainty with values. [Provider reference](https://docs.isric.org/globaldata/soilgrids/SoilGrids_faqs.html).
- **elevation / Open-Meteo / Copernicus DEM:** CC BY 4.0; provider and DEM terms apply. [Provider reference](https://open-meteo.com/en/docs/elevation-api).
- **aviation / ADSB.lol public community network:** ODbL 1.0/open-data terms; confirm redistribution conditions. [Provider reference](https://www.adsb.lol/docs/open-data/api/).
- **tfl / Transport for London open data:** TfL transport-data terms apply; camera imagery remains operator content. [Provider reference](https://api.tfl.gov.uk/).
- **nasa_power / NASA POWER Project:** NASA POWER acknowledgment requested; no station-level inference. [Provider reference](https://power.larc.nasa.gov/docs/services/api/).
- **gbif / GBIF and original contributing datasets:** Each record has its own CC0/CC BY/CC BY-NC license. Preserve it. [Provider reference](https://www.gbif.org/developer/occurrence).
- **worldbank / World Bank:** Usually CC BY 4.0; confirm dataset terms. [Provider reference](https://datahelpdesk.worldbank.org/knowledgebase/articles/889392).
- **gdelt / GDELT and original publishers:** Original publisher rights apply. Link/snippet only. [Provider reference](https://www.gdeltproject.org/).
- **firms_area / NASA FIRMS / NOAA-20 VIIRS:** Free MAP_KEY required. NASA data and transaction limits apply. [Provider reference](https://firms.modaps.eosdis.nasa.gov/api/area/).
- **geocoding / Open-Meteo / GeoNames:** CC BY 4.0 and non-commercial hosted API terms. [Provider reference](https://open-meteo.com/en/docs/geocoding-api).


## Coverage, outages and costs

“Public” does not mean exhaustive, always-on, unrestricted or authoritative for every decision. Default FIRMS is regional, NWS is US-only, TfL is London-only, ADS-B depends on reception, GBIF is a historical sample, and national population is not local exposure. GeoNames/search and selected coordinates are sent to providers; provider-side logging can apply.

A provider timeout or `{}` body is not proof that no incidents exist. GDELT was retained as a transparent optional unavailable adapter rather than filled with invented stories. ReliefWeb and other investigated routes were not integrated where the access/schema conditions were not established. CARTO tiles that returned an API-key-required image were removed rather than treated as usable keyless data.

No paid API, hosting plan or account purchase was made. Production resource and provider costs depend on actual audience, licensing and the infrastructure you choose later.


## ISRIC access and scale clarification

ISRIC states a public beta REST fair-use limit of **5 API calls per minute** and advises against local/farm-level interpretation of SoilGrids. ATLAS now spaces ISRIC calls by at least 12.1 seconds per process and uses one longer bounded attempt, not duplicate cold-query retries. Two soil subqueries consume two calls; cached queries consume none. Shared deployments/replicas need a shared quota, and busy/cold queries can legitimately produce partial or unavailable results. [1](https://docs.isric.org/globaldata/soilgrids/SoilGrids_faqs_04.html)

The ATLAS carbon stock is a physical conversion applied to predicted component means; it is **not** the official separately trained SoilGrids carbon-stock product and need not agree with it. Product-of-means and mean-of-products differ when inputs covary. Treat the displayed point lookup as regional modeled context, never parcel/farm-level precision. [1](https://docs.isric.org/globaldata/soilgrids/SoilGrids_faqs_04.html)


## ATLAS 2 analysis and portable geometry endpoints

### `GET /api/v1/insights`

Required `lat`, `lon`; optional `base_c=10`, `cap_c=30`. `−10 ≤ base < cap ≤ 50°C`. A timezone-aware `as_of` is accepted only within the bounded near-current window (at most 600 seconds past / 60 seconds future); this is not historical replay. Response includes model/method version, requested point, 241 canonical hourly rows, 24/48/72-hour windows, complete-input counts, wind distribution, tiny novelty model diagnostics, trends, rank associations, clocks and attribution/license metadata. Source failures remain explicit and can yield an unavailable analysis with null fields rather than an HTTP 500. No soil request is made.

### `POST /api/v1/compare`

```json
{"points":[{"lat":27.1,"lon":78.15},{"lat":28.6139,"lon":77.209}],"base_c":10,"cap_c":30}
```

Two or three points only, input order preserved. Captures one server `as_of` and applies the same complete forecast windows to each report. No location safety ranking or crop forecast is computed. Boolean/non-finite scientific inputs are rejected. Both endpoints use the same optional `X-Atlas-Key` protection as the rest of `/api/`.

### `POST /api/v1/aoi`

Alongside a WGS84 Polygon and `hours`, v2 accepts `minimum_priority` (0–5), aware `end`, and `kinds`. Omitted/null kinds means no kind restriction; **an empty array means no selected kinds**. Source filters/position lifetimes match the map and are echoed in the result. ≤200 total ring vertices, ≤3 holes and <180° longitude span; topology/hole validity is checked on the server. Drawing/import/saved camera fitting do not alter this scientific geometry.

### Other boundary changes

- `/api/v1/ready` uses HTTP 503 before ready, rather than returning success with a false body.
- Proximity responses disclose eligible/candidate counts and candidate/group/comparison truncation. They do not imply corroboration.
- Weather/AQI cache keys are versioned to avoid restored short v1 windows. Time strings are normalized timezone-aware UTC; consumers must not append a second `Z`.
- Workspace JSON is a client-side portable configuration, not a backend-data import endpoint. It contains selected point, active/saved polygons, filters and display preferences; no keys or historical provider snapshots. Server topology checks still apply when an imported polygon is analyzed.

See [model cards](v2/MODEL_CARDS.md) for definitions and `/api/openapi.json` for the running input schema.
