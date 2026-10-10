import pytest
from datetime import datetime, timezone, timedelta
from atlas_app.analytics import ffwi, rainfall_24h, environment_screen, soil_summary, erosion_scenario
from atlas_app.schemas import Envelope, Payload, ErosionScenario

NOW = datetime(2026, 10, 10, 6, 30, tzinfo=timezone.utc)


def test_precipitation_uses_24_completed_hourly_endpoints():
    times = [(NOW.replace(minute=0) - timedelta(hours=i)).isoformat() for i in range(26)]
    value, count = rainfall_24h({"time": times, "precipitation": [1] * 26, "rain": [900] * 26}, NOW)
    assert count == 24 and value == 24  # rain must never be added again


def test_missing_rain_hour_is_unknown_not_zero():
    times = [(NOW.replace(minute=0) - timedelta(hours=i)).isoformat() for i in range(24)]
    vals = [1] * 24
    vals[7] = None
    assert rainfall_24h({"time": times, "precipitation": vals}, NOW) == (None, 23)


def test_future_rain_not_used_as_past():
    times = [(NOW + timedelta(hours=i + 1)).isoformat() for i in range(24)]
    assert rainfall_24h({"time": times, "precipitation": [900] * 24}, NOW) == (None, 0)


@pytest.mark.parametrize("t,rh,w", [(35, 10, 40), (20, 60, 4), (0, 100, 0), (-20, 80, 20), (45, 5, 120)])
def test_ffwi_bounded(t, rh, w):
    assert 0 <= ffwi(t, rh, w) <= 100


def test_ffwi_wind_monotonicity():
    assert ffwi(35, 20, 30) > ffwi(35, 20, 5)


def test_ffwi_humidity_direction():
    assert ffwi(30, 10, 20) > ffwi(30, 80, 20)


def test_ffwi_invalid_input():
    with pytest.raises(ValueError):
        ffwi(30, 101, 20)


def test_all_missing_screen_is_not_safe_score():
    r = environment_screen({}, NOW)
    assert r["score"] is None and r["coverage"] == 0 and r["missing_data_bounds"] == [0, 100]
    assert "probability" in r["interpretation"]


def test_stale_model_excluded_from_screening():
    e = Envelope(
        source_id="weather",
        status="stale",
        upstream_time=NOW,
        payload=Payload(
            data={"current": {"temperature_2m": 45, "relative_humidity_2m": 20, "wind_speed_10m": 40}}
        ),
    )
    assert environment_screen({"weather": e}, NOW)["score"] is None


def test_old_observation_in_fresh_http_response_not_fresh_condition():
    e = Envelope(
        source_id="weather",
        status="fresh",
        upstream_time=NOW - timedelta(days=7),
        payload=Payload(data={"current": {"temperature_2m": 45}}),
    )
    assert environment_screen({"weather": e}, NOW)["score"] is None


def test_zero_aqi_is_valid_and_bounds_describe_missing_inputs():
    a = Envelope(
        source_id="air_quality",
        status="fresh",
        upstream_time=NOW,
        payload=Payload(data={"current": {"us_aqi": 0}}),
    )
    r = environment_screen({"air_quality": a}, NOW)
    assert r["score"] == 0 and r["coverage"] == 0.3 and r["missing_data_bounds"][1] > 0


def test_carbon_stock_units_and_coarse_fragments():
    d = {"properties": {}}
    for name, value in [("soc", 10), ("bdod", 1.3), ("cfvo", 10)]:
        d["properties"][name] = {
            "depths": [{"depth": depth, "mean": value} for depth in ["0-5cm", "5-15cm", "15-30cm"]]
        }
    assert soil_summary(d)["carbon_stock_0_30cm_t_ha"] == 35.1
    del d["properties"]["cfvo"]
    assert soil_summary(d)["carbon_stock_0_30cm_t_ha"] is None


def test_soil_unknown_never_gets_fictitious_crop_fit():
    r = soil_summary({})
    assert r["ph"] is None and r["crop_ph_screen"] == []


def test_erosion_cover_reduction_scales_linearly():
    x = ErosionScenario(
        rainfall_erosivity=1500,
        soil_erodibility=0.025,
        slope_percent=8,
        slope_length_m=60,
        cover_factor=0.2,
        practice_factor=1,
        alternative_cover_factor=0.1,
    )
    r = erosion_scenario(x)
    assert r["relative_change_pct"] == -50 and r["validation"] == "scenario_only"
    assert r["baseline_t_ha_yr"] > 0


def test_zero_erosion_baseline_ratio_not_division_error():
    x = ErosionScenario(
        rainfall_erosivity=0,
        soil_erodibility=0.025,
        slope_percent=8,
        slope_length_m=60,
        cover_factor=0.2,
        practice_factor=1,
        alternative_cover_factor=0.1,
    )
    assert erosion_scenario(x)["relative_change_pct"] is None


def test_missing_observation_time_cannot_become_current_attention():
    e = Envelope(
        source_id="weather", status="fresh", payload=Payload(data={"current": {"temperature_2m": 45}})
    )
    assert environment_screen({"weather": e}, NOW)["score"] is None
