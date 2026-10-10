"""Bounded, unit-aware normalization for Open-Meteo model arrays.
Nulls, absent units, conflicting/duplicate timestamps and malformed arrays are not zero.
The provider endpoints are requested in UTC and metric units; no silent conversion guesses.
"""

from __future__ import annotations
from .parsers import number, timestamp
from .transport import UpstreamError

MAX_HOURS = 336
WMO_CODES = {
    0,
    1,
    2,
    3,
    45,
    48,
    51,
    53,
    55,
    56,
    57,
    61,
    63,
    65,
    66,
    67,
    71,
    73,
    75,
    77,
    80,
    81,
    82,
    85,
    86,
    95,
    96,
    99,
}
# id: (accepted units, lower, upper)
FIELDS = {
    "temperature_2m": ({"°C"}, -90, 65),
    "apparent_temperature": ({"°C"}, -110, 90),
    "relative_humidity_2m": ({"%"}, 0, 100),
    "precipitation": ({"mm"}, 0, 500),
    "precipitation_probability": ({"%"}, 0, 100),
    "wind_speed_10m": ({"km/h"}, 0, 500),
    "wind_gusts_10m": ({"km/h"}, 0, 600),
    "wind_direction_10m": ({"°"}, 0, 360),
    "surface_pressure": ({"hPa"}, 100, 1200),
    "et0_fao_evapotranspiration": ({"mm"}, 0, 30),
    "shortwave_radiation": ({"W/m²"}, 0, 1800),
    "weather_code": ({"wmo code", "WMO code"}, 0, 99),
    "us_aqi": ({"USAQI", "US AQI"}, 0, 5000),
    "pm2_5": ({"μg/m³", "µg/m³"}, 0, 10000),
    "pm10": ({"μg/m³", "µg/m³"}, 0, 10000),
    "ozone": ({"μg/m³", "µg/m³"}, 0, 10000),
    "nitrogen_dioxide": ({"μg/m³", "µg/m³"}, 0, 10000),
    **{
        f"soil_moisture_{d}cm": ({"m³/m³"}, 0, 1)
        for d in ["0_to_1", "1_to_3", "3_to_9", "9_to_27", "27_to_81"]
    },
}
DAILY_FIELDS = {
    "temperature_2m_max": ({"°C"}, -90, 65),
    "temperature_2m_min": ({"°C"}, -90, 65),
    "precipitation_sum": ({"mm"}, 0, 2000),
    "precipitation_probability_max": ({"%"}, 0, 100),
    "weather_code": ({"wmo code", "WMO code"}, 0, 99),
}


def normalize_model(raw: dict, source: str) -> tuple[dict, list[str]]:
    if not isinstance(raw, dict) or not isinstance(raw.get("current"), dict):
        raise UpstreamError("schema_drift")
    if "utc_offset_seconds" in raw and number(raw["utc_offset_seconds"]) != 0:
        raise UpstreamError("unexpected_model_timezone")
    current_time = timestamp(raw["current"].get("time"))
    if current_time is None:
        raise UpstreamError("schema_drift")
    warnings = []
    counts = {
        "invalid_values": 0,
        "missing_or_mismatched_units": [],
        "duplicate_hours": 0,
        "discarded_timestamps": 0,
    }

    def normalize_values(obj, units, specs, indices=None):
        out = {}
        for name, (accepted, lo, hi) in specs.items():
            if name not in obj:
                continue
            valid_unit = isinstance(units, dict) and units.get(name) in accepted
            if not valid_unit:
                counts["missing_or_mismatched_units"].append(name)

            def norm(v):
                n = number(v) if valid_unit else None
                if n is not None and not lo <= n <= hi:
                    n = None
                if name == "weather_code" and n not in WMO_CODES:
                    n = None
                if v is not None and n is None:
                    counts["invalid_values"] += 1
                return n

            if indices is None:
                out[name] = norm(obj[name])
            else:
                values = obj[name] if isinstance(obj[name], list) else []
                out[name] = [norm(values[i]) if i is not None and i < len(values) else None for i in indices]
        return out

    result = {k: number(raw.get(k)) for k in ("latitude", "longitude", "elevation", "generationtime_ms")}
    for key, lo, hi in [
        ("latitude", -90, 90),
        ("longitude", -180, 180),
        ("elevation", -500, 10000),
        ("generationtime_ms", 0, 1e6),
    ]:
        if result[key] is not None and not lo <= result[key] <= hi:
            result[key] = None
    result.update(timezone="UTC", utc_offset_seconds=0, normalization_version="model-metric-2.0")
    result["current"] = {
        **normalize_values(raw["current"], raw.get("current_units"), FIELDS),
        "time": current_time.isoformat(),
    }
    result["current_units"] = raw.get("current_units") if isinstance(raw.get("current_units"), dict) else {}
    for section, specs, limit in [("hourly", FIELDS, MAX_HOURS), ("daily", DAILY_FIELDS, 14)]:
        obj = raw.get(section) if isinstance(raw.get(section), dict) else {}
        times = obj.get("time") if isinstance(obj.get("time"), list) else []
        by_time = {}
        seen = set()
        for i, t in enumerate(times[:limit]):
            dt = timestamp(t)
            if dt is None:
                counts["discarded_timestamps"] += 1
                continue
            if section == "hourly" and (dt.minute or dt.second or dt.microsecond):
                counts["discarded_timestamps"] += 1
                continue
            if dt in seen:
                by_time[dt] = None
                counts["duplicate_hours"] += int(section == "hourly")
            else:
                by_time[dt] = i
                seen.add(dt)
        ordered = sorted(by_time)
        units = raw.get(section + "_units")
        result[section] = {
            "time": [t.isoformat() if section == "hourly" else t.date().isoformat() for t in ordered],
            **normalize_values(obj, units, specs, [by_time[t] for t in ordered]),
        }
        result[section + "_units"] = units if isinstance(units, dict) else {}
        if len(times) > limit:
            warnings.append(f"{section} response capped at {limit} timestamps.")
    counts["missing_or_mismatched_units"] = sorted(set(counts["missing_or_mismatched_units"]))
    if counts["missing_or_mismatched_units"]:
        warnings.append("Missing or unexpected units: affected quantities were withheld, not guessed.")
    if counts["duplicate_hours"]:
        warnings.append(
            "Duplicate hourly timestamps were made unknown to avoid conflicting values or double counting."
        )
    if counts["invalid_values"]:
        warnings.append("Some values were outside supported bounds, malformed, or had unverifiable units.")
    result["quality"] = counts
    result["nature"] = "numerical_model"
    result["source_id"] = source
    return result, warnings
