"""ATLAS Signal Lab: small, bounded, interpretable scientific/statistical models.
Everything is a derivative of provider model data, never new sensor observations.
No downloaded weights, LLM forecasts, hazard probabilities or causality claims.
"""

from __future__ import annotations
from datetime import datetime, timedelta, timezone
import math
from statistics import median
import numpy as np
from .parsers import number, timestamp
from .schemas import Envelope, utcnow
from .registry import SOURCES

VERSION = "signal-lab-2.0.0"
FEATURES = ("temperature_c", "humidity_pct", "wind_kmh", "pressure_hpa")
FLOORS = np.array([0.5, 3.0, 1.0, 0.5])
FIELD_MAP = {
    "temperature_c": "temperature_2m",
    "humidity_pct": "relative_humidity_2m",
    "wind_kmh": "wind_speed_10m",
    "gust_kmh": "wind_gusts_10m",
    "direction_deg": "wind_direction_10m",
    "pressure_hpa": "surface_pressure",
    "precipitation_mm": "precipitation",
    "rain_probability_pct": "precipitation_probability",
    "reference_et0_mm": "et0_fao_evapotranspiration",
    "solar_wm2": "shortwave_radiation",
}
UNITS = {
    "temperature_c": "°C",
    "humidity_pct": "%",
    "wind_kmh": "km/h",
    "gust_kmh": "km/h",
    "direction_deg": "° from north",
    "pressure_hpa": "hPa",
    "precipitation_mm": "mm",
    "rain_probability_pct": "%",
    "reference_et0_mm": "mm",
    "solar_wm2": "W/m²",
    "dewpoint_c": "°C",
    "vpd_kpa": "kPa",
    "reference_balance_mm": "mm",
    "us_aqi": "US AQI",
    "pm25_ugm3": "µg/m³",
    "novelty_distance": "dimensionless",
    "novelty_rank_pct": "baseline rank %",
}
LIMITS = {
    "temperature_c": (-90, 65),
    "humidity_pct": (0, 100),
    "wind_kmh": (0, 500),
    "gust_kmh": (0, 600),
    "direction_deg": (0, 360),
    "pressure_hpa": (100, 1200),
    "precipitation_mm": (0, 500),
    "reference_et0_mm": (0, 30),
    "solar_wm2": (0, 1800),
    "rain_probability_pct": (0, 100),
    "us_aqi": (0, 5000),
    "pm25_ugm3": (0, 10000),
}


def finite(value, key=None):
    v = number(value)
    if v is not None and key in LIMITS and not LIMITS[key][0] <= v <= LIMITS[key][1]:
        return None
    return v


def psychrometrics(temp_c, rh):
    """Tetens saturation over liquid water (kPa) and its dew-point inverse.
    Conservatively withheld outside −40..50 °C; RH=0 gives undefined dew point.
    This is not an ice/frost-point or crop-stress model.
    """
    t, rh = finite(temp_c), finite(rh)
    if t is None or rh is None or not -40 <= t <= 50 or not 0 <= rh <= 100:
        return {"dewpoint_c": None, "vpd_kpa": None}
    es = 0.6108 * math.exp(17.27 * t / (t + 237.3))
    ea = es * rh / 100
    log = math.log(ea / 0.6108) if ea > 0 else None
    return {
        "dewpoint_c": round(237.3 * log / (17.27 - log), 3) if log is not None else None,
        "vpd_kpa": round(max(0, es - ea), 4),
    }


def _rows(data, fields):
    hourly = data.get("hourly") if isinstance(data.get("hourly"), dict) else {}
    times = hourly.get("time") if isinstance(hourly.get("time"), list) else []
    rows = {}
    duplicates = set()
    for i, t in enumerate(times[:336]):
        dt = timestamp(t)
        if dt is None or dt.minute or dt.second or dt.microsecond:
            continue
        if dt in rows:
            duplicates.add(dt)
            continue
        row = {}
        for target, source in fields.items():
            values = hourly.get(source)
            row[target] = finite(values[i], target) if isinstance(values, list) and i < len(values) else None
        rows[dt] = row
    for t in duplicates:
        rows[t] = {k: None for k in fields}
    return rows


def _usable(env, now, max_age):
    if not env or env.status not in ("fresh", "empty") or not env.upstream_time:
        return False
    t = env.upstream_time
    if t.tzinfo is None:
        return False
    return -300 <= (now - t).total_seconds() <= max_age


def ranks(x):
    a = np.asarray(x, dtype=float)
    order = np.argsort(a, kind="stable")
    out = np.empty(len(a), dtype=float)
    start = 0
    while start < len(a):
        end = start + 1
        while end < len(a) and a[order[end]] == a[order[start]]:
            end += 1
        out[order[start:end]] = (start + end - 1) / 2
        start = end
    return out


def spearman(x, y, min_pairs=48):
    pairs = [(a, b) for a, b in zip(x, y) if finite(a) is not None and finite(b) is not None][:336]
    if len(pairs) < min_pairs:
        return {"rho": None, "pairs": len(pairs), "reason": "insufficient_pairs"}
    a, b = (ranks(v) for v in zip(*pairs))
    if np.ptp(a) == 0 or np.ptp(b) == 0:
        return {"rho": None, "pairs": len(pairs), "reason": "constant_series"}
    r = float(np.corrcoef(a, b)[0, 1])
    return {"rho": round(max(-1, min(1, r)), 4), "pairs": len(pairs), "reason": None}


def robust_trend(times, values):
    """Theil–Sen pairwise median slope, descriptive, not an extrapolated forecast."""
    pairs = [(t, finite(v)) for t, v in zip(times, values) if finite(v) is not None][:96]
    if len(pairs) < 12:
        return {"slope_per_day": None, "samples": len(pairs), "direction": "insufficient data"}
    base = pairs[0][0]
    xs = [(t - base).total_seconds() / 86400 for t, v in pairs]
    slopes = [
        (pairs[j][1] - pairs[i][1]) / (xs[j] - xs[i])
        for i in range(len(pairs))
        for j in range(i + 1, len(pairs))
        if xs[j] > xs[i]
    ]
    if not slopes:
        return {"slope_per_day": None, "samples": len(pairs), "direction": "insufficient data"}
    slope = float(median(slopes))
    return {
        "slope_per_day": round(slope, 4),
        "samples": len(pairs),
        "direction": "rising" if slope > 0 else "falling" if slope < 0 else "flat",
        "method": "Theil–Sen descriptor; no statistical significance or predictive confidence claim",
    }


def novelty_model(rows: dict, as_of: datetime):
    """Robust diurnal residuals + regularized covariance. Past rows ONLY train it.
    No chi-square probability interpretation: ranks compare with the fitted baseline.
    """
    past = [
        (t, r)
        for t, r in sorted(rows.items())
        if as_of - timedelta(days=7) <= t <= as_of and all(r.get(k) is not None for k in FEATURES)
    ]
    empty = {
        "status": "insufficient_history",
        "method": "Robust diurnal / shrinkage covariance",
        "training_samples": len(past),
        "minimum_samples": 72,
        "scores": {},
        "limitations": ["At least 72 complete past hourly rows and three samples per UTC hour are required."],
    }
    if len(past) < 72:
        return empty
    groups = {
        hour: np.array([[r[k] for k in FEATURES] for t, r in past if t.hour == hour], dtype=float)
        for hour in range(24)
    }
    if any(len(v) < 3 for v in groups.values()):
        return empty
    hourly_centers = {h: np.median(v, axis=0) for h, v in groups.items()}
    residuals = np.array([[r[k] for k in FEATURES] - hourly_centers[t.hour] for t, r in past])
    center = np.median(residuals, axis=0)
    scale = np.maximum(1.4826 * np.median(np.abs(residuals - center), axis=0), FLOORS)
    z = np.clip((residuals - center) / scale, -4, 4)
    cov = np.cov(z, rowvar=False)
    shrinkage = max(0.2, min(0.6, 2 * len(FEATURES) / len(past)))
    # Identity shrinkage also protects constant/collinear variables with a finite floor.
    covariance = (1 - shrinkage) * cov + shrinkage * np.eye(len(FEATURES))
    inv = np.linalg.inv(covariance)

    def score(t, r):
        v = (np.array([r[k] for k in FEATURES]) - hourly_centers[t.hour] - center) / scale
        # Bound numerical influence and serialized output even after extreme input drift.
        v = np.clip(v, -100, 100)
        return float(np.sqrt(max(0, v @ inv @ v)))

    fitted = np.sort(np.array([score(t, r) for t, r in past]))
    scores = {}
    for t, r in rows.items():
        if all(r.get(k) is not None for k in FEATURES):
            d = score(t, r)
            rank = (
                100 * float(np.count_nonzero(fitted < d) + 0.5 * np.count_nonzero(fitted == d)) / len(fitted)
            )
            scores[t] = {"distance": round(d, 4), "rank_pct": round(rank, 1)}
    return {
        "status": "ready",
        "method": "Diurnal medians → MAD scaling → clipped covariance + identity shrinkage → Mahalanobis distance",
        "training_samples": len(past),
        "minimum_samples": 72,
        "training_start": past[0][0].isoformat(),
        "training_end": past[-1][0].isoformat(),
        "features": list(FEATURES),
        "scale_floors": dict(zip(FEATURES, FLOORS.tolist())),
        "shrinkage": round(shrinkage, 4),
        "parameter_count": 24 * 4 + 4 + 4 + 16,
        "serialized_parameter_bytes": int(
            sum(a.nbytes for a in hourly_centers.values()) + center.nbytes + scale.nbytes + covariance.nbytes
        ),
        "scores": scores,
        "limitations": [
            "Past model data only; this is not independent sensor training or a climate baseline.",
            "Rank is relative to the fitted seven-day baseline, NOT event probability or calibrated out-of-sample confidence.",
            "Diurnal medians need no future values. No extrapolation or model-superiority claim is made.",
        ],
    }


def summarize_window(rows, start, hours, base_c=10.0, cap_c=30.0):
    endpoints = [start + timedelta(hours=i + 1) for i in range(hours)]
    selected = [rows.get(t, {}) for t in endpoints]

    def values(key):
        return [finite(r.get(key)) for r in selected]

    def complete(key):
        v = values(key)
        return sum(v) if all(x is not None for x in v) else None

    def maximum(key):
        v = values(key)
        return max(v) if all(x is not None for x in v) else None

    rain, et0 = complete("precipitation_mm"), complete("reference_et0_mm")
    temp = values("temperature_c")
    gdd = sum(max(0, min(t, cap_c) - base_c) / 24 for t in temp) if all(t is not None for t in temp) else None
    mean = sum(temp) / hours if all(t is not None for t in temp) else None
    rounded = lambda v: round(v, 3) if v is not None else None
    keys = ("temperature_c", "precipitation_mm", "reference_et0_mm", "vpd_kpa", "wind_kmh", "us_aqi")
    return {
        "hours": hours,
        "start": start.isoformat(),
        "end": endpoints[-1].isoformat(),
        "mean_temperature_c": rounded(mean),
        "max_temperature_c": rounded(maximum("temperature_c")),
        "precipitation_mm": rounded(rain),
        "reference_et0_mm": rounded(et0),
        "reference_balance_mm": rounded(rain - et0) if rain is not None and et0 is not None else None,
        "gdd_c_day": rounded(gdd),
        "max_vpd_kpa": rounded(maximum("vpd_kpa")),
        "max_wind_kmh": rounded(maximum("wind_kmh")),
        "max_us_aqi": rounded(maximum("us_aqi")),
        "coverage": {
            **{k: sum(v is not None for v in values(k)) for k in keys},
            "reference_balance_mm": sum(
                p is not None and e is not None
                for p, e in zip(values("precipitation_mm"), values("reference_et0_mm"))
            ),
        },
        "expected_hours": hours,
    }


def wind_distribution(rows, start, hours=24):
    labels = [
        "N",
        "NNE",
        "NE",
        "ENE",
        "E",
        "ESE",
        "SE",
        "SSE",
        "S",
        "SSW",
        "SW",
        "WSW",
        "W",
        "WNW",
        "NW",
        "NNW",
    ]
    bins = [[] for _ in labels]
    calm = 0
    missing = 0
    for i in range(hours):
        r = rows.get(start + timedelta(hours=i + 1), {})
        s = finite(r.get("wind_kmh"), "wind_kmh")
        d = finite(r.get("direction_deg"), "direction_deg")
        if s is None:
            missing += 1
        elif s < 3.6:
            calm += 1
        elif d is None:
            missing += 1
        else:
            bins[int(((d + 11.25) % 360) // 22.5)].append(s)
    return {
        "bins": [
            {
                "direction": label,
                "degrees": i * 22.5,
                "hours": len(v),
                "mean_kmh": round(sum(v) / len(v), 2) if v else None,
            }
            for i, (label, v) in enumerate(zip(labels, bins))
        ],
        "calm_hours": calm,
        "missing_hours": missing,
        "expected_hours": hours,
        "meaning": "Meteorological direction FROM; calm <3.6 km/h; next 24 complete forecast intervals.",
    }


def analyze_environment(sources: dict[str, Envelope], now: datetime | None = None, base_c=10.0, cap_c=30.0):
    now = (now or utcnow()).astimezone(timezone.utc)
    if finite(base_c) is None or finite(cap_c) is None or not -10 <= base_c < cap_c <= 50:
        raise ValueError("Thermal base must be below the cap, with −10 ≤ base < cap ≤ 50 °C")
    weather = sources.get("weather")
    air = sources.get("air_quality")
    usable_w = _usable(weather, now, 10800)
    usable_a = _usable(air, now, 21600)
    w = weather.payload.data if usable_w else {}
    a = air.payload.data if usable_a else {}
    rows = _rows(w, FIELD_MAP)
    aq = _rows(a, {"us_aqi": "us_aqi", "pm25_ugm3": "pm2_5"})
    anchor = now.replace(minute=0, second=0, microsecond=0)
    forecast_start = anchor + timedelta(hours=1)
    # Exclude distant/irregular provider rows; fill a canonical hourly grid with nulls.
    timeline = [anchor + timedelta(hours=i) for i in range(-167, 74)]
    canonical = {}
    for t in timeline:
        r = {k: rows.get(t, {}).get(k) for k in FIELD_MAP}
        r.update({k: aq.get(t, {}).get(k) for k in ("us_aqi", "pm25_ugm3")})
        r.update(psychrometrics(r["temperature_c"], r["humidity_pct"]))
        p, e = r["precipitation_mm"], r["reference_et0_mm"]
        r["reference_balance_mm"] = round(p - e, 4) if p is not None and e is not None else None
        canonical[t] = r
    model = novelty_model(canonical, now)
    scores = model.pop("scores")
    for t, r in canonical.items():
        r["novelty_distance"] = scores.get(t, {}).get("distance")
        r["novelty_rank_pct"] = scores.get(t, {}).get("rank_pct")
    past = [r for t, r in canonical.items() if t <= now]
    correlation_keys = ["temperature_c", "humidity_pct", "wind_kmh", "precipitation_mm", "us_aqi"]
    correlations = [
        {"x": x, "y": y, **spearman([r[x] for r in past], [r[y] for r in past])}
        for i, x in enumerate(correlation_keys)
        for y in correlation_keys[i + 1 :]
    ]
    future_times = [forecast_start + timedelta(hours=i + 1) for i in range(72)]
    current = w.get("current") if isinstance(w.get("current"), dict) else {}
    derived = psychrometrics(current.get("temperature_2m"), current.get("relative_humidity_2m"))
    fields = list(UNITS)
    return {
        "version": VERSION,
        "generated_at": now.isoformat(),
        "as_of": now.isoformat(),
        "status": "available" if usable_w else "unavailable",
        "nature": "derived_from_provider_models",
        "forecast_start": forecast_start.isoformat(),
        "forecast_end": (forecast_start + timedelta(hours=72)).isoformat(),
        "current": {**derived, "input_time": current.get("time")},
        "thermal_parameters": {
            "base_c": base_c,
            "cap_c": cap_c,
            "method": "sum(max(0, min(hour-end T, cap) − base)) / 24; degree-days, not crop stage/yield",
        },
        "series": {
            "time": [t.isoformat() for t in timeline],
            **{k: [canonical[t].get(k) for t in timeline] for k in fields},
        },
        "units": UNITS,
        "windows": [summarize_window(canonical, forecast_start, h, base_c, cap_c) for h in (24, 48, 72)],
        "wind_rose": wind_distribution(canonical, forecast_start),
        "correlations": correlations,
        "novelty": model,
        "trends": {
            key: robust_trend(future_times, [canonical.get(t, {}).get(key) for t in future_times])
            for key in ("temperature_c", "us_aqi")
        },
        "quality": {
            "history_hours": len(past),
            "weather_usable": usable_w,
            "air_usable": usable_a,
            "forecast_coverage": {
                k: sum(canonical.get(t, {}).get(k) is not None for t in future_times)
                for k in ("temperature_c", "vpd_kpa", "reference_et0_mm", "us_aqi")
            },
            "normalization": w.get("quality", {}),
        },
        "provenance": {
            id: {
                "status": env.status,
                "provider": SOURCES[id].provider,
                "docs_url": SOURCES[id].docs_url,
                "attribution": SOURCES[id].attribution,
                "license_note": SOURCES[id].license_note,
                "grid": {k: env.payload.data.get(k) for k in ("latitude", "longitude", "elevation")},
                "fetched_at": env.fetched_at.isoformat() if env.fetched_at else None,
                "model_time": env.upstream_time.isoformat() if env.upstream_time else None,
            }
            for id, env in sources.items()
            if id in ("weather", "air_quality")
        },
        "limitations": [
            "All curves are model values or explicit mathematical derivatives; none are new measurements.",
            "P − reference ET₀ is an atmospheric reference balance, NOT soil storage, runoff, irrigation demand or flood probability.",
            "Hourly interval totals require every expected endpoint; gaps remain null. Windows begin at the next whole UTC hour, excluding the current partial interval.",
            "Spearman associations use timestamp-matched past values; shared model forcing and serial correlation preclude causal or significance claims.",
            "Novelty is fitted to a short modeled baseline, not a verified hazard detector.",
            "No calibrated risk probability, climate anomaly, crop yield or agronomic prescription is produced.",
        ],
    }
