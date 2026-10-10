# ATLAS Signal Lab — method cards

Version: `signal-lab-2.0.0`. Research/exploration methods, **not calibrated hazard models**.

## Data contract and time convention

- Inputs: Open-Meteo numerical weather and CAMS air-quality model data. No sensor observations, training labels, downloaded model weights or LLM-generated values are added.
- Existing weather/AQI requests ask for **seven past days and five forecast calendar days**. Five calendar days ensure the complete 72-hour analysis horizon is available even late in a UTC day. One response per provider is reused through the existing bounded cache.
- Up to 336 hourly timestamps are normalized. Actual live checks returned 288 each. Units must match the requested canonical units; malformed/non-finite/boolean/out-of-range values become null. Unexpected nonzero UTC offsets are rejected. Duplicate hours become unknown, not double-counted or last-write-wins.
- Report grid: 168 past/current hourly timestamps plus 73 following timestamps (241 rows). Weather eligibility requires a fresh/valid-empty envelope with a current model timestamp no more than three hours old; AQI uses six hours. Upstream timestamps over five minutes ahead are excluded. Eligibility never makes a missing variable usable.
- Let `a = floor_UTC_hour(as_of)` and `s = a + 1 hour`. A future H-hour summary covers `(s, s+H]`, using endpoints `s+1h ... s+Hh`, for H = 24, 48, 72. The current partial interval is excluded.
- Precipitation and reference ET₀ are **preceding-hour totals** in the provider convention; temperature and RH are instantaneous model values. The official provider table documents these distinctions.[5](https://open-meteo.com/en/docs/metno-api)
- A total, mean or maximum is reported only when every expected hourly input is available. Coverage counts accompany the result. P−ET₀ coverage counts matched pairs, not the smaller of two independent counts.
- Requested coordinates and returned model-grid coordinates are different metadata. No model grid is relabeled as an exact site measurement. Exported JSON includes attribution, documentation URLs, license notes, status, fetch and model-valid times. CSV includes requested coordinates, weather grid, method version and source clocks/URLs.

## 1. Psychrometric derivatives

**Purpose:** inspect atmospheric moisture relationships, not plant stress or human health.

For Celsius temperature T and relative humidity RH in percent:

```
e_s = 0.6108 × exp(17.27 T / (T + 237.3))       kPa
e_a = e_s × RH / 100                          kPa
VPD = max(0, e_s − e_a)                      kPa
L = ln(e_a / 0.6108)
T_dew = 237.3 L / (17.27 − L)                °C
```

The saturation-pressure expression is the FAO/Tetens form; dew point is its algebraic inverse. Reference: [1](https://www.fao.org/fileadmin/user_upload/faowater/docs/ReferenceManualETo.pdf).

**Guardrails:** RH must be 0–100. RH=0 permits finite VPD but no finite dew point. ATLAS conservatively withholds these derivatives outside −40…50°C. This is a liquid-water approximation, not an ice/frost-point model. It does not infer crop water stress from VPD alone.

**Checks:** saturated RH yields VPD=0 and dew point≈T; known 20°C/50% RH example; RH=0; missing, boolean, out-of-range and non-finite inputs.

## 2. Atmospheric reference balance

```
B_H = sum(P_i) − sum(ET0_i), i = 1…H         mm
```

ET₀ is the provider's FAO-56 well-watered grass reference calculation, not actual site evapotranspiration.[5](https://open-meteo.com/en/docs/metno-api) ATLAS does not recompute Penman–Monteith from incomplete inputs.

**What this is not:** runoff, soil-water storage change, recharge, irrigation need, drought severity or flood probability. No crop coefficients, rooting depth, field capacity, interception, infiltration, terrain routing, irrigation, groundwater or calibrated water-balance state is available. Negative B is a descriptive atmospheric reference deficit only.

**Checks:** all expected endpoints; no precipitation/rain double addition; zero is valid; a missing rain or ET₀ hour makes B unknown; matched-pair coverage is tested separately.

## 3. Configurable capped thermal accumulation

```
D_H = sum(max(0, min(T_i, cap_C) − base_C)) / 24    °C·day
```

Default base 10°C, cap 30°C; permitted `−10 ≤ base < cap ≤ 50°C`. The UI exposes both assumptions. This is an endpoint-temperature integration approximation, not the daily min/max-average convention used by some agronomic degree-day products.

**Not provided:** crop calibration, growth stage, flowering/harvest date, crop suitability/yield, pest emergence or prescriptions. Displaying chart temperatures in Fahrenheit does not silently change thermal parameters or degree-day units.

**Checks:** constant-temperature analytic values, lower clipping, upper cap, 24/72-hour scaling, missing intervals and parameter rejection.

## 4. Wind-direction distribution

Sixteen 22.5° bins; north wraps correctly through 360°. Directions mean where wind comes **from**. Speeds below 3.6 km/h count as calm, even if direction is unknown. Other missing speed/direction pairs are unknown. The rose covers the next 24 complete intervals; bins + calm + unknown account for all 24.

Mean speed per nonempty bin is a descriptive arithmetic mean. No pollution plume, atmospheric transport or fire-spread forecast is inferred. The table retains explicit km/h units.

## 5. Small joint-weather novelty model

**Purpose:** show how a supplied model trajectory differs from its own short recent modeled baseline after removing its regular daily cycle.

**Inputs:** T (°C), RH (%), wind speed (km/h), surface pressure (hPa). No air-quality predictor or incident label is used.

**Fit, in order:**

1. Select complete rows with timestamps in the past seven days and no later than `as_of`. The canonical grid supplies at most 168 complete training rows. Require ≥72 complete rows and ≥3 observations for **every UTC hour**.
2. Estimate 24 hourly medians for each of the four features (96 stored values). Subtract the appropriate hourly center to remove the daily pattern.
3. Subtract the componentwise residual median. Scale by `max(1.4826 × median absolute deviation, floor)` with floors `(0.5°C, 3%, 1 km/h, 0.5 hPa)`.
4. Clip training standardized residuals to ±4 for the covariance estimate. Form sample covariance C; regularize with identity:

```
λ = clamp(2p/n, 0.2, 0.6), p = 4
Σ = (1 − λ) C + λ I
```

This is a documented **heuristic shrinkage rule**, not a fitted Ledoit–Wolf estimator. With the current minimum sample size the lower bound λ=0.2 is active.

5. For a complete row, use its hour's baseline, residual median and scale. Clip standardized scoring inputs to ±100 as a numerical/output bound, then compute `d = sqrt(zᵀ Σ⁻¹ z)`.
6. An optional exported baseline rank is `100 × (count(d_train < d) + 0.5 count(d_train = d)) / n`. Constant histories therefore have zero distance and rank 50, not a spurious alarm.

**Size:** 120 stored floating-point parameter entries (including the full symmetric 4×4 matrix), 960 bytes of float64 numeric arrays. This excludes Python/NumPy objects, data arrays, executable code and process memory. No GPU/downloaded weights. NumPy was already a dependency through Shapely; it is now declared directly.

**What it does NOT establish:** a disaster probability, chi-square tail probability, empirical predictive accuracy, superiority over an operational forecast, independent evidence, a climate anomaly or calibrated out-of-sample confidence. Training and comparison values come from provider models; there is no sensor ground-truth dataset or holdout calibration.

**Checks:** future-value perturbations leave past fitted scores unchanged; insufficient per-hour coverage is rejected; collinear/constant features remain finite; ranks remain bounded; full JSON rejects non-finite values. These are implementation/invariant checks, not a hazard-validation study.

## 6. Descriptive robust trend

Theil–Sen: median of pairwise slopes `(y_j−y_i)/(t_j−t_i)` over up to 96 supplied points; reports units/day. Signal Lab describes the 72-hour provider forecast, requires ≥12 valid samples, and ignores missing values. No future values are extrapolated by ATLAS and no significance/confidence interval is claimed.

Method reference: [SciPy's documentation of the median pairwise-slope definition](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.theilslopes.html). ATLAS implements this small bounded calculation itself; SciPy is not required.

**Checks:** known linear slope, single-outlier resistance and insufficient samples.

## 7. Timestamp-aligned associations

Pairwise Spearman rank correlation over past model rows. Ties receive average ranks. Only same-timestamp nonmissing pairs enter; minimum 48 pairs. Constant or insufficient pairs return null plus a reason/sample count.

**Not causality:** diurnal patterns, common model forcing, serial correlation and changing coverage can dominate these associations. Raw-series correlations are not partial correlations, causal effects or independent significance tests. No p-values are shown.

**Checks:** increasing/decreasing rankings, ties, null alignment and constant series.

## Comparison and record charts

`POST /api/v1/compare` permits two or three points, captures one server-side `as_of`, shares the same forecast windows, and uses the same methods/parameters. It fetches only weather and AQI through the normal cache. No score ranks places as safe/unsafe. Consistent methods/time windows do not imply identical model families, grid resolutions or assimilation across locations. Novelty distances from different local baselines are not compared as a shared hazard scale.

Record charts describe the currently selected map filters. They retain cross-source overlaps. USGS magnitude/depth pairs are restricted to usable values and at most 600 plotted records; magnitude types may differ. Negative reported depth is drawn at the surface and disclosed. Counts are not global occurrence rates, unique incidents, exposed populations or energy measurements. **No earthquake energy proxy is shipped**: an unverified conversion would add misleading precision without improving the core workflow.

## Validation boundaries

No hindcast skill study, sensor validation, agronomic calibration, climatological baseline, benchmarked disaster classifier or production load certification was conducted. Use official authorities and qualified local evidence for consequential decisions. Provider availability, licenses and model versions can change.
