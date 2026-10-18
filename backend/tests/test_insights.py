"""Mathematical invariants and leakage tests; offline fixtures, never demo data."""

import copy
import json
import math
from datetime import UTC, datetime, timedelta

import pytest
from atlas_app.insights import (
    _rows,
    analyze_environment,
    novelty_model,
    psychrometrics,
    robust_trend,
    spearman,
    summarize_window,
    wind_distribution,
)
from atlas_app.model_data import normalize_model
from atlas_app.schemas import AOIRequest, Envelope, ErosionScenario, Payload, Point
from atlas_app.transport import UpstreamError

NOW = datetime(2026, 10, 10, 6, 30, tzinfo=UTC)
ANCHOR = NOW.replace(minute=0)


def records():
    return {
        ANCHOR + timedelta(hours=i): {
            "temperature_c": 20 + 3 * math.sin(i / 24 * 2 * math.pi) + i / 400,
            "humidity_pct": 60 + i / 20,
            "wind_kmh": 10 + (i % 7),
            "pressure_hpa": 1000 + i / 50,
            "direction_deg": 90,
            "precipitation_mm": 1.0,
            "reference_et0_mm": 0.25,
            "us_aqi": 50.0,
            "vpd_kpa": 1.0,
        }
        for i in range(-167, 75)
    }


def envs():
    rows = records()
    fields = {
        "temperature_2m": "temperature_c",
        "relative_humidity_2m": "humidity_pct",
        "wind_speed_10m": "wind_kmh",
        "surface_pressure": "pressure_hpa",
        "wind_direction_10m": "direction_deg",
        "precipitation": "precipitation_mm",
        "et0_fao_evapotranspiration": "reference_et0_mm",
    }
    w = {
        "current": {"time": NOW.isoformat(), "temperature_2m": 20, "relative_humidity_2m": 60},
        "hourly": {
            "time": [t.isoformat() for t in rows],
            **{k: [r[v] for r in rows.values()] for k, v in fields.items()},
        },
    }
    a = {
        "current": {"time": NOW.isoformat()},
        "hourly": {"time": w["hourly"]["time"], "us_aqi": [50] * len(rows), "pm2_5": [12] * len(rows)},
    }
    return {
        id: Envelope(
            source_id=id,
            status="fresh",
            upstream_time=NOW,
            fetched_at=NOW,
            payload=Payload(data=d, record_count=len(rows)),
        )
        for id, d in [("weather", w), ("air_quality", a)]
    }


@pytest.mark.parametrize("t", [0, 10, 20, 30, 50, -40])
def test_saturated_air_zero_vpd_and_dewpoint_equals_temperature(t):
    r = psychrometrics(t, 100)
    assert r["vpd_kpa"] == 0 and r["dewpoint_c"] == pytest.approx(t, abs=0.002)


def test_tetens_known_example():
    r = psychrometrics(20, 50)
    assert r["vpd_kpa"] == pytest.approx(1.1691, abs=0.001)
    assert r["dewpoint_c"] == pytest.approx(9.2696, abs=0.005)


def test_rh_zero_is_finite_vpd_but_no_dewpoint():
    assert psychrometrics(20, 0) == {"vpd_kpa": 2.3383, "dewpoint_c": None}


@pytest.mark.parametrize(
    "t,rh",
    [(True, 50), (20, False), (None, 50), (20, -1), (20, 101), (51, 50), (-41, 50), (float("nan"), 30)],
)
def test_psychrometric_invalid_is_null(t, rh):
    assert all(v is None for v in psychrometrics(t, rh).values())


def test_precipitation_minus_reference_et0_complete_endpoints():
    rows = records()
    start = ANCHOR + timedelta(hours=1)
    rows[start]["precipitation_mm"] = 900  # interval before analysis begins is excluded
    r = summarize_window(rows, start, 24)
    assert r["precipitation_mm"] == 24 and r["reference_balance_mm"] == 18
    assert r["coverage"]["precipitation_mm"] == 24
    assert r["end"] == (start + timedelta(hours=24)).isoformat()


def test_gaps_never_become_dry_weather():
    rows = records()
    start = ANCHOR + timedelta(hours=1)
    del rows[start + timedelta(hours=3)]
    r = summarize_window(rows, start, 24)
    assert r["precipitation_mm"] is None and r["reference_balance_mm"] is None and r["gdd_c_day"] is None
    assert r["coverage"]["precipitation_mm"] == 23


def test_thermal_time_is_hourly_integration_and_cap_is_explicit():
    rows = records()
    start = ANCHOR + timedelta(hours=1)
    for r in rows.values():
        r["temperature_c"] = 35
    assert summarize_window(rows, start, 24, 10, 30)["gdd_c_day"] == 20
    assert summarize_window(rows, start, 72, 10, 30)["gdd_c_day"] == 60
    for r in rows.values():
        r["temperature_c"] = 5
    assert summarize_window(rows, start, 24)["gdd_c_day"] == 0


def test_zero_rain_is_valid():
    rows = records()
    for r in rows.values():
        r["precipitation_mm"] = 0
    assert summarize_window(rows, ANCHOR + timedelta(hours=1), 72)["precipitation_mm"] == 0


def test_wind_rose_accounts_for_all_intervals():
    rows = records()
    start = ANCHOR + timedelta(hours=1)
    rows[start + timedelta(hours=1)]["wind_kmh"] = 0
    rows[start + timedelta(hours=2)]["direction_deg"] = None
    rows[start + timedelta(hours=3)]["direction_deg"] = 360
    r = wind_distribution(rows, start)
    assert r["calm_hours"] == 1 and r["missing_hours"] == 1
    assert sum(b["hours"] for b in r["bins"]) == 22
    assert r["bins"][0]["hours"] == 1 and r["bins"][4]["hours"] == 21


def test_novelty_does_not_train_on_future():
    a = records()
    b = copy.deepcopy(a)
    for t, r in b.items():
        if t > NOW:
            r.update(temperature_c=50, humidity_pct=4, wind_kmh=120, pressure_hpa=950)
    ma, mb = novelty_model(a, NOW), novelty_model(b, NOW)
    assert ma["status"] == "ready" and ma["training_samples"] == 168
    for t in a:
        if t <= NOW:
            assert ma["scores"][t] == mb["scores"][t]
    assert ma["shrinkage"] == mb["shrinkage"] and ma["training_end"] <= NOW.isoformat()
    assert all(0 <= s["rank_pct"] <= 100 for s in mb["scores"].values())


def test_diurnal_pattern_is_removed_and_constant_features_are_stable():
    rows = records()
    for t, r in rows.items():
        r.update(temperature_c=20 + (t.hour % 12), humidity_pct=50, wind_kmh=10, pressure_hpa=1000)
    m = novelty_model(rows, NOW)
    assert m["status"] == "ready"
    assert all(s["distance"] == 0 for s in m["scores"].values())
    assert all(s["rank_pct"] == 50 for s in m["scores"].values())


def test_novelty_requires_coverage_across_all_day_hours():
    rows = {t: r for t, r in records().items() if t.hour != 3}
    assert novelty_model(rows, NOW)["status"] == "insufficient_history"


def test_novelty_requires_72_complete_past_samples():
    rows = {t: r for t, r in records().items() if t >= NOW - timedelta(hours=60)}
    assert novelty_model(rows, NOW)["status"] == "insufficient_history"


def test_pairwise_spearman_handles_ties_nulls_and_constants():
    assert spearman(list(range(60)), list(reversed(range(60))))["rho"] == -1
    assert spearman([1] * 60, [2] * 60)["rho"] is None
    assert spearman([1, None] * 30, [2] * 60)["pairs"] == 30
    assert spearman([1, 2, 2, 3] * 20, [10, 20, 20, 30] * 20)["rho"] == 1


def test_theil_sen_slope_and_outlier_resistance():
    times = [ANCHOR + timedelta(hours=i) for i in range(72)]
    vals = [i / 24 for i in range(72)]
    vals[7] = 1000
    assert robust_trend(times, vals)["slope_per_day"] == 1
    assert robust_trend(times[:5], vals[:5])["slope_per_day"] is None


def test_report_serializes_strictly_and_is_finite():
    r = analyze_environment(envs(), NOW)
    json.dumps(r, allow_nan=False)
    assert len(r["series"]["time"]) == 241
    assert r["windows"][2]["coverage"]["temperature_c"] == 72
    assert r["novelty"]["status"] == "ready"
    assert r["status"] == "available"
    assert r["provenance"]["weather"]["fetched_at"] == NOW.isoformat()


@pytest.mark.parametrize("state", ["stale", "unavailable", "disabled", "idle"])
def test_stale_inputs_excluded(state):
    sources = envs()
    sources["weather"].status = state
    r = analyze_environment(sources, NOW)
    assert r["windows"][0]["precipitation_mm"] is None
    assert r["novelty"]["status"] == "insufficient_history"
    assert r["status"] == "unavailable"


def test_old_model_timestamp_and_future_timestamp_excluded():
    for at in [NOW - timedelta(days=2), NOW + timedelta(hours=1)]:
        sources = envs()
        sources["weather"].upstream_time = at
        assert not analyze_environment(sources, NOW)["quality"]["weather_usable"]


@pytest.mark.parametrize(
    "base,cap", [(30, 10), (10, 10), (-11, 30), (10, 51), (True, 30), (float("nan"), 30)]
)
def test_invalid_thermal_parameters_rejected(base, cap):
    with pytest.raises(ValueError):
        analyze_environment({}, NOW, base, cap)


def test_duplicate_hour_withheld_and_irregular_endpoint_discarded():
    data = {"hourly": {"time": [ANCHOR.isoformat(), ANCHOR.isoformat(), NOW.isoformat()], "x": [1, 3, 5]}}
    r = _rows(data, {"precipitation_mm": "x"})
    assert len(r) == 1 and r[ANCHOR]["precipitation_mm"] is None


@pytest.mark.parametrize("obj", [None, [], {"current": None}, {"current": {"time": "nonsense"}}])
def test_nullable_provider_contract_raises_controlled_error(obj):
    with pytest.raises(UpstreamError):
        normalize_model(obj, "weather")


def model_raw():
    return {
        "current": {"time": NOW.isoformat(), "temperature_2m": 20},
        "current_units": {"temperature_2m": "°C"},
        "hourly": {"time": [ANCHOR.isoformat()], "temperature_2m": [20], "precipitation": [0]},
        "hourly_units": {"temperature_2m": "°C", "precipitation": "mm"},
        "daily": None,
    }


def test_normalizer_verifies_units_not_just_numeric_type():
    raw = model_raw()
    raw["hourly_units"]["temperature_2m"] = "°F"
    r, w = normalize_model(raw, "weather")
    assert r["hourly"]["temperature_2m"] == [None]
    assert r["hourly"]["precipitation"] == [0]
    assert w and r["quality"]["missing_or_mismatched_units"] == ["temperature_2m"]


def test_normalizer_preserves_missing_and_rejects_boolean():
    raw = model_raw()
    raw["hourly"]["temperature_2m"] = [True]
    r, w = normalize_model(raw, "weather")
    assert r["hourly"]["temperature_2m"] == [None] and w
    assert r["daily"] == {"time": []}


def test_normalizer_sorts_aligns_and_neutralizes_duplicates():
    raw = model_raw()
    raw["hourly"]["time"] = [(ANCHOR + timedelta(hours=i)).isoformat() for i in [2, 1, 1, 0]]
    raw["hourly"]["temperature_2m"] = [22, 21, 30, 20]
    r, _w = normalize_model(raw, "weather")
    assert r["hourly"]["temperature_2m"] == [20, None, 22]
    assert r["hourly"]["precipitation"] == [None, None, 0]
    assert r["quality"]["duplicate_hours"] == 1


def test_scientific_booleans_are_not_zero_or_one():
    with pytest.raises(ValueError):
        Point(lat=True, lon=20)
    with pytest.raises(ValueError):
        AOIRequest(geometry={}, hours=True)
    with pytest.raises(ValueError):
        ErosionScenario(
            rainfall_erosivity=True,
            soil_erodibility=0.2,
            slope_percent=2,
            slope_length_m=100,
            cover_factor=0.4,
            practice_factor=0.9,
            alternative_cover_factor=0.2,
        )


def test_missing_vs_empty_aoi_kind_filter():
    assert AOIRequest(geometry={}).kinds is None
    assert AOIRequest(geometry={}, kinds=[]).kinds == []
    with pytest.raises(ValueError):
        AOIRequest(geometry={}, end="2026-10-10T00:00:00")
