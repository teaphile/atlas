"""Interpretable screening, NOT calibrated hazard probabilities.
No latent variables (groundwater, lithology, NDVI, defenses) are fabricated.
"""

from __future__ import annotations
import math
from datetime import datetime, timedelta, timezone
from .parsers import number, timestamp
from .schemas import Envelope, ErosionScenario, utcnow

MODEL_VERSION = "screening-1.0.0"


def ffwi(temp_c: float, rh: float, wind_kmh: float) -> float:
    """Fosberg Fire Weather Index; Fahrenheit, percent RH and mph in the formula."""
    if not all(math.isfinite(x) for x in (temp_c, rh, wind_kmh)) or not 0 <= rh <= 100 or wind_kmh < 0:
        raise ValueError("Invalid FFWI inputs")
    t = temp_c * 9 / 5 + 32
    u = wind_kmh / 1.609344
    if rh < 10:
        m = 0.03229 + 0.281073 * rh - 0.000578 * rh * t
    elif rh < 50:
        m = 2.22749 + 0.160107 * rh - 0.01478 * t
    else:
        m = 21.0606 + 0.005565 * rh * rh - 0.00035 * rh * t - 0.483199 * rh
    r = min(30, max(0, m)) / 30
    eta = 1 - 2 * r + 1.5 * r * r - 0.5 * r * r * r
    return round(min(100, max(0, eta * math.sqrt(1 + u * u) / 0.3002)), 2)


def linear(value: float, knots: list[tuple[float, float]]) -> float:
    if value <= knots[0][0]:
        return knots[0][1]
    for (x0, y0), (x1, y1) in zip(knots, knots[1:]):
        if value <= x1:
            return y0 + (y1 - y0) * (value - x0) / (x1 - x0)
    return knots[-1][1]


def rainfall_24h(hourly: dict, now: datetime) -> tuple[float | None, int]:
    """Open-Meteo hourly precipitation is the preceding-hour amount.
    Use exactly 24 completed hourly endpoints, excluding forecast future values.
    No addition of `rain` (already a precipitation component).
    """
    end = now.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)
    expected = {end - timedelta(hours=i) for i in range(24)}
    values = {}
    for t, v in zip(hourly.get("time", []), hourly.get("precipitation", [])):
        dt = timestamp(t)
        n = number(v)
        if dt in expected and n is not None and n >= 0:
            values[dt] = n
    return (round(sum(values.values()), 2) if len(values) == 24 else None), len(values)


def _usable(env: Envelope | None, max_observation_age: int, now: datetime):
    if not env or env.status not in ("fresh", "empty"):
        return False
    if env.upstream_time is None:
        return False
    if env.upstream_time:
        delta = (now - env.upstream_time).total_seconds()
        if not -3600 <= delta <= max_observation_age:
            return False
    return bool(env.payload.data)


def environment_screen(sources: dict[str, Envelope], now: datetime | None = None):
    now = now or utcnow()
    w = sources.get("weather")
    a = sources.get("air_quality")
    weather = w.payload.data if _usable(w, 10800, now) else {}
    air = a.payload.data if _usable(a, 21600, now) else {}
    cur = weather.get("current", {})
    aq = air.get("current", {})
    temp = number(cur.get("temperature_2m"))
    rh = number(cur.get("relative_humidity_2m"))
    wind = number(cur.get("wind_speed_10m"))
    aqi = number(aq.get("us_aqi"))
    if temp is not None and not -90 <= temp <= 60:
        temp = None
    if wind is not None and not 0 <= wind <= 500:
        wind = None
    if aqi is not None and aqi < 0:
        aqi = None
    rain, nhours = rainfall_24h(weather.get("hourly", {}), now)
    fire = (
        ffwi(temp, rh, wind)
        if temp is not None and rh is not None and 0 <= rh <= 100 and wind is not None and wind >= 0
        else None
    )
    specs = [
        (
            "air",
            "Air quality",
            aqi,
            "US AQI",
            0.30,
            [(0, 0), (50, 10), (100, 30), (150, 55), (200, 75), (300, 100)],
            "air_quality",
        ),
        (
            "heat",
            "Temperature stress",
            temp,
            "°C",
            0.20,
            [(25, 0), (35, 40), (40, 70), (45, 90), (50, 100)],
            "weather",
        ),
        (
            "rain",
            "24-hour rainfall",
            rain,
            "mm",
            0.20,
            [(0, 0), (20, 15), (50, 40), (100, 75), (150, 100)],
            "weather",
        ),
        ("fire_weather", "Fire-weather index", fire, "FFWI", 0.15, [(0, 0), (100, 100)], "weather"),
        (
            "wind",
            "Surface wind",
            wind,
            "km/h",
            0.15,
            [(0, 0), (30, 15), (50, 40), (75, 75), (100, 100)],
            "weather",
        ),
    ]
    signals = []
    for key, label, val, unit, weight, knots, source in specs:
        signals.append(
            {
                "id": key,
                "label": label,
                "value": val,
                "unit": unit,
                "weight": weight,
                "source_id": source,
                "score": round(linear(val, knots), 1) if val is not None else None,
            }
        )
    available = [s for s in signals if s["score"] is not None]
    coverage = sum(s["weight"] for s in available)

    def aggregate(values):
        return 0.65 * max(values) + 0.35 * sum(s["weight"] * v for s, v in zip(signals, values))

    low = aggregate([s["score"] if s["score"] is not None else 0 for s in signals])
    high = aggregate([s["score"] if s["score"] is not None else 100 for s in signals])
    score = (
        round(
            0.65 * max(s["score"] for s in available)
            + 0.35 * sum(s["weight"] * s["score"] for s in available) / coverage,
            1,
        )
        if available
        else None
    )
    label = (
        "Insufficient data"
        if score is None
        else "Elevated signals"
        if score >= 65
        else "Watch conditions"
        if score >= 35
        else "Lower observed signals"
    )
    return {
        "version": MODEL_VERSION,
        "score": score,
        "label": label,
        "coverage": round(coverage, 3),
        "signals": signals,
        "missing_data_bounds": [round(low, 1), round(high, 1)],
        "rainfall_hours_available": nhours,
        "validation": "unvalidated_screening_index",
        "interpretation": "Relative display priority only. Not disaster probability, return period or an all-clear.",
        "bounds_interpretation": "Worst/best-case missing-input sensitivity, NOT a statistical confidence interval.",
        "limitations": [
            "Physical exposure, vulnerability and defenses are not measured.",
            "Related weather inputs are not independent evidence.",
            "No flood/landslide/liquefaction prediction is produced.",
        ],
    }


def soil_summary(data: dict):
    props = data.get("properties", {})

    def get(name, depth="0-5cm", which="mean"):
        row = next((v for v in props.get(name, {}).get("depths", []) if v["depth"] == depth), {})
        return number(row.get(which))

    ph = get("phh2o")
    sand = get("sand")
    silt = get("silt")
    clay = get("clay")
    texture = None
    if all(v is not None for v in (sand, silt, clay)) and 95 <= sand + silt + clay <= 105:
        if clay >= 40:
            texture = "Clay-dominant"
        elif sand >= 70:
            texture = "Sand-dominant"
        elif silt >= 65:
            texture = "Silt-dominant"
        else:
            texture = "Mixed texture"
    carbon = 0.0
    valid = True
    for depth, thickness in [("0-5cm", 5), ("5-15cm", 10), ("15-30cm", 15)]:
        soc, bd, cf = get("soc", depth), get("bdod", depth), get("cfvo", depth)
        if any(v is None for v in (soc, bd, cf)):
            valid = False
            break
        carbon += soc * bd * thickness * 0.1 * (1 - cf / 100)
    crops = []
    if ph is not None:
        for name, lo, hi in [
            ("Wheat", 6, 8),
            ("Millet", 5.5, 8.5),
            ("Maize", 5.5, 7.5),
            ("Rice", 5.5, 7.5),
            ("Soybean", 6, 7.5),
            ("Potato", 5, 6.5),
        ]:
            dist = max(lo - ph, ph - hi, 0)
            crops.append(
                {
                    "crop": name,
                    "ph_fit": "Within general pH range" if dist == 0 else "Outside general pH range",
                    "range": [lo, hi],
                    "distance": round(dist, 1),
                }
            )
        crops.sort(key=lambda r: r["distance"])
    return {
        "ph": ph,
        "ph_interpretation": None
        if ph is None
        else "Acidic"
        if ph < 5.5
        else "Alkaline"
        if ph > 7.5
        else "Near neutral",
        "texture_description": texture,
        "carbon_stock_0_30cm_t_ha": round(carbon, 2) if valid else None,
        "carbon_method": "Sum of SOC × bulk density × depth × (1 − coarse-fragment volume fraction), with explicit SI conversion.",
        "crop_ph_screen": crops,
        "caveat": "Regional-context soil model, not a lab test or field diagnosis. Derived stock is not the separately modeled SoilGrids stock product. pH compatibility alone is not crop suitability, yield or fertilizer advice. Carbon stock is not sequestration potential.",
    }


def erosion_scenario(x: ErosionScenario):
    theta = math.atan(x.slope_percent / 100)
    s = math.sin(theta)
    m = 0.2 if x.slope_percent < 1 else 0.3 if x.slope_percent < 3 else 0.4 if x.slope_percent < 5 else 0.5
    l = (x.slope_length_m / 22.13) ** m
    steep = 10.8 * s + 0.03 if x.slope_percent < 9 else 16.8 * s - 0.5
    ls = l * steep
    common = x.rainfall_erosivity * x.soil_erodibility * ls * x.practice_factor
    a = common * x.cover_factor
    b = common * x.alternative_cover_factor
    return {
        "model": "RUSLE scenario · A = R × K × LS × C × P",
        "baseline_t_ha_yr": round(a, 3),
        "alternative_t_ha_yr": round(b, 3),
        "relative_change_pct": round((b - a) / a * 100, 2) if a > 0 else None,
        "ls_factor": round(ls, 5),
        "inputs": x.model_dump(),
        "validation": "scenario_only",
        "limitations": [
            "All factors are user-supplied assumptions, not remotely measured here.",
            "Sheet/rill erosion only; not landslides, riverbank/gully erosion or single-storm soil loss.",
            "Regionally calibrate R and K before field use.",
        ],
    }
