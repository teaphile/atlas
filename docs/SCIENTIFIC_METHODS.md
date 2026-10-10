# Scientific methods and model card

**Version:** `screening-1.0.0` · **Validation class:** research screening / explicit scenarios, not calibrated disaster prediction.

## Core commitments

- Unknown is not zero, benign, or “average.” Missing fields do not receive made-up environmental values.
- Provider freshness, data age, model resolution and physical uncertainty are different dimensions.
- Correlated inputs and duplicated aggregators are not independent evidence.
- No probability, return period, satellite index or confidence claim is created without the corresponding measurement/validation workflow.

## 1. Environmental attention screen

Purpose: orient the reader toward available environmental signals. It is a transparent **display-priority heuristic**, not a trained hazard model, severity authority, probability or all-clear.

| Signal | Input | Weight | Piecewise display knots (input → 0–100 score) |
|---|---|---:|---|
| Air | Modeled US AQI | 0.30 | 0→0, 50→10, 100→30, 150→55, 200→75, 300→100 |
| Heat | Modeled temperature °C | 0.20 | 25→0, 35→40, 40→70, 45→90, 50→100 |
| Rain | Modeled completed 24-hour precipitation mm | 0.20 | 0→0, 20→15, 50→40, 100→75, 150→100 |
| Fire weather | Fosberg index | 0.15 | 0→0, 100→100 |
| Wind | Modeled surface wind km/h | 0.15 | 0→0, 30→15, 50→40, 75→75, 100→100 |

For available component scores `s_i` and their weights `w_i`:

```text
coverage = sum(weights of usable components)
score = 0.65 × max(usable scores)
      + 0.35 × sum(w_i × s_i) / coverage
```

With no usable signals, score is `null`. Temperature/wind sanity bounds reject implausible values rather than making extreme alerts from malformed inputs. Missing timestamps cannot establish current attention. Weather is usable only with acceptable provider time (up to three hours old), AQ up to six hours; stale-cache envelopes are excluded from this screen.

The weights, knots and 35/65 mixture are **designer choices**, not learned or validated coefficients. “Elevated” and “Watch” are UI categories, not official warnings. The heat component is warm-temperature-only: it does not represent frost, wet-bulb stress, individual heat illness or local acclimatization.

### Missing-input sensitivity

Unknown component scores are set to 0 and 100 to calculate lower/upper sensitivity bounds using the full weight vector. These are worst/best-case completion bounds, **not statistical confidence or prediction intervals**. Partial-coverage normalized scores should not be compared between places as though all their information were equivalent.

The index omits exposure, defenses, drainage, vulnerability, building stock, population, lithology, groundwater and many other mechanisms. Related weather inputs are correlated. No flood, landslide, liquefaction, disaster-loss or casualty forecast is produced.

## 2. Completed-hour precipitation

Open-Meteo hourly precipitation is interpreted as the preceding-hour amount. Anchor to the last completed UTC hour and require exactly 24 valid hourly endpoints. Future forecast values are excluded. Duplicate timestamps do not create duplicate rain. A missing endpoint makes the total unknown; available-hour count is returned.

`rain` is not added to `precipitation`. Current 15-minute or hourly instantaneous output is never relabeled as 24-hour accumulation. This is still model output, not a local rain gauge.

## 3. Fosberg Fire Weather Index (FFWI)

The classic Fosberg calculation uses Fahrenheit, percentage relative humidity and wind in mph. Input conversions are explicit (`°F = °C × 9/5 + 32`, `mph = km/h ÷ 1.609344`).

```text
Equilibrium moisture m:
RH < 10:  m = 0.03229 + 0.281073 RH − 0.000578 RH T_F
RH < 50:  m = 2.22749 + 0.160107 RH − 0.01478 T_F
otherwise: m = 21.0606 + 0.005565 RH² − 0.00035 RH T_F − 0.483199 RH

r = clip(m, 0, 30) / 30
η = 1 − 2r + 1.5r² − 0.5r³
FFWI = clip(η × sqrt(1 + wind_mph²) / 0.3002, 0, 100)
```

FFWI is not ignition probability, fuel availability, fuel moisture measurement or a confirmed wildfire. It does not make a satellite thermal anomaly a wildfire. Tests verify units/range, wind/humidity direction and invalid-input rejection, not operational calibration.

## 4. SoilGrids predictions

Source: [ISRIC SoilGrids documentation](https://docs.isric.org/globaldata/soilgrids/SoilGrids_faqs.html); scientific context: [Poggio et al., 2021](https://doi.org/10.5194/soil-7-217-2021).

- Nominal resolution: 250 m; static modeled properties, not live soil sensors or laboratory measurements.
- Queried depths: 0–5, 5–15 and 15–30 cm.
- Two bounded requests: three-depth means and surface means/Q05/Q95. Failures are normalized independently so a valid half survives a transport or schema failure in the other half.
- Surface means must agree before combining a separately fetched uncertainty interval. Deeper intervals are unrequested and never interpolated.
- Unit conversion uses the provider's mandatory `d_factor`. Examples from the validated response: pH 83/10 = 8.3; SOC 90/10 = 9 g/kg; nitrogen 133/100 = 1.33 g/kg; bulk density 138/100 = 1.38 g/cm³; coarse fragments 73/10 = 7.3% volume.
- Valid null urban/no-data cells stay null. The default point is explicitly named **Agra district · rural east**, not quietly substituted for a user-selected city center.
- Q05–Q95 are marginal provider model prediction quantiles. They are not a site-specific confidence certification or a joint interval for every derived quantity.

### Carbon stock, not carbon sequestration

For each depth with complete SOC, bulk density and coarse-fragment inputs:

```text
stock(t C / ha) = SOC(g/kg) × bulk density(g/cm³)
               × thickness(cm) × 0.1 × (1 − coarse fragments(% volume)/100)
```

Sum the 5, 10 and 15 cm horizons for 0–30 cm stock. If any required input is missing, no stock is returned. The calculation does not estimate soil carbon additionality, sequestration rate, permanence, management response, carbon-credit eligibility or CO₂-equivalent removals.

A calibrated joint interval would require dependence/covariance between predicted SOC, density, fragments and horizons; ATLAS does not multiply marginal interval endpoints and call that a 90% stock interval.

### Texture and crop pH

Sand/silt/clay are checked for a plausible compositional total before a broad texture description is returned. This is not a complete USDA texture-triangle classifier.

The crop list compares **surface pH only** with broad illustrative pH ranges in code. It ignores cultivar, climate, water, salinity, rooting depth, nutrients, pests, economics and management. It is not a crop suitability ranking, a fertilizer recommendation or a yield model. Confirm any field decision with appropriate local sampling and agronomic expertise.

## 5. RUSLE-style scenario calculator

```text
A = R × K × LS × C × P
```

Inputs are user-supplied assumptions. `R` is MJ·mm/(ha·h·year), `K` is t·h/(MJ·mm), and output is t/(ha·year). The initial slider values are explicitly illustrative and not inferred from the selected location.

The slope-length implementation is a simplified empirical approximation:

- `θ = atan(slope_percent/100)`;
- length exponent `m = 0.2, 0.3, 0.4, 0.5` for slope bins `<1%, <3%, <5%, otherwise`;
- `L = (length_m / 22.13)^m`;
- `S = 10.8 sin θ + 0.03` below 9%, otherwise `16.8 sin θ − 0.5`.

This is **not a full RUSLE2 implementation** and should not be extrapolated to unusual terrain without expert calibration. It estimates an annual sheet/rill erosion scenario, not a single-storm loss, gullies, riverbank erosion or landslides. Annual erosivity is not generated by multiplying today's rain by 365.

The alternative changes the cover factor. A zero baseline produces an undefined relative ratio (`null`), not a divide-by-zero or invented percentage. UI results retain their submitted inputs and warn if sliders subsequently change.

## 6. Other source semantics

- **FIRMS:** thermal detections, not confirmed wildfires; default NOAA-20 dataset covers South Asia only. EONET adds global curated events, not equivalent fine-scale global fire coverage.
- **NWS:** US warning coverage. Representative points do not depict the full warning footprint.
- **GloFAS/Open-Meteo flood:** nearest-grid modeled river discharge; no uncalibrated probability, return period, depth or inundation polygon.
- **AQ:** CAMS/Open-Meteo modeled US AQI, not a monitoring-station observation and not India NAQI.
- **NASA POWER:** delayed recent history, not climate normals or an annual forecast.
- **GIBS:** actual satellite imagery requested for UTC date minus two days. Cloud and swath gaps are expected; not live video.
- **ADSB.lol/ISS:** last received/published positions, not extrapolated tracks or a navigation service.
- **TfL:** public operator camera catalog and snapshots; capture time unknown.
- **GBIF:** historical sampled occurrence records, not abundance, species absence or ecological completeness.
- **World Bank:** latest country-scale annual population estimate, not local exposure.
- **CISA KEV:** reference catalog, not a live attack feed or located cyber incident.
- **News/GDELT:** publisher/discovery records, not ground-truth incident detections.

## 7. What scientific validation remains

Arithmetic and contract tests are not empirical validation. Before any safety- or livelihood-critical use, define the target outcome and spatial/temporal support; obtain independently appropriate labels; prevent temporal and spatial leakage; evaluate against simple baselines; use held-out regions/seasons; measure discrimination and calibration separately; analyze missingness and observation coverage; quantify correlated-source dependence; document out-of-distribution behavior; and obtain domain review.

A probability UI, an “AI confidence” badge or a Monte Carlo loop would not substitute for that process. ATLAS deliberately exposes these boundaries rather than disguising them as complete hazard intelligence.


## ISRIC access and scale clarification

ISRIC states a public beta REST fair-use limit of **5 API calls per minute** and advises against local/farm-level interpretation of SoilGrids. ATLAS now spaces ISRIC calls by at least 12.1 seconds per process and uses one longer bounded attempt, not duplicate cold-query retries. Two soil subqueries consume two calls; cached queries consume none. Shared deployments/replicas need a shared quota, and busy/cold queries can legitimately produce partial or unavailable results. [1](https://docs.isric.org/globaldata/soilgrids/SoilGrids_faqs_04.html)

The ATLAS carbon stock is a physical conversion applied to predicted component means; it is **not** the official separately trained SoilGrids carbon-stock product and need not agree with it. Product-of-means and mean-of-products differ when inputs covary. Treat the displayed point lookup as regional modeled context, never parcel/farm-level precision. [1](https://docs.isric.org/globaldata/soilgrids/SoilGrids_faqs_04.html)
