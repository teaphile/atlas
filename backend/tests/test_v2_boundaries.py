"""Offline integration boundaries for the v2 API and durable cache."""

import sqlite3
from datetime import timedelta

import pytest
from atlas_app.config import Settings
from atlas_app.engine import Engine
from atlas_app.geo import filter_events, proximity_groups
from atlas_app.insights import summarize_window
from atlas_app.main import create_app
from atlas_app.model_data import normalize_model
from atlas_app.schemas import Envelope, Payload, utcnow
from atlas_app.storage import SnapshotStore
from fastapi.testclient import TestClient


@pytest.mark.parametrize(
    "kwargs",
    [
        {"radius_km": 0},
        {"radius_km": float("nan")},
        {"radius_km": True},
        {"window_seconds": 0},
        {"window_seconds": float("inf")},
        {"max_comparisons": 60001},
        {"max_comparisons": True},
        {"max_comparisons": 2.5},
    ],
)
def test_proximity_invalid_numeric_parameters_fail_controlled(kwargs):
    with pytest.raises(ValueError):
        proximity_groups([], **kwargs)


def test_proximity_reports_every_budget_boundary(make_event):
    events = [make_event(str(i), at=utcnow() - timedelta(seconds=i)) for i in range(3502)]
    r = proximity_groups(events, max_comparisons=1)
    assert r["eligible_count"] == 3502 and r["candidate_count"] == 3500 and r["candidates_truncated"]
    assert r["budget_exhausted"] and r["comparisons"] == 1


def test_aoi_kind_priority_cutoff_and_position_lifetimes_match_map_semantics(make_event):
    now = utcnow()
    a = make_event("a", at=now - timedelta(hours=2), severity="low")
    b = make_event("b", at=now - timedelta(minutes=30), severity="high")
    plane = make_event("c", kind="aircraft", at=now - timedelta(minutes=4))
    assert filter_events([a, b], kinds=[]) == []
    assert filter_events([a, b], kinds=None) == [a, b]
    assert filter_events([a, b], minimum_priority=4) == [b]
    assert filter_events([a, b], end=now - timedelta(hours=1)) == [a]
    assert filter_events([plane], now=now) == []


@pytest.mark.parametrize("bad_clock", ["future", "naive", "wrong_status"])
async def test_restored_cache_rejects_invalid_clocks_and_states(fake_providers, bad_clock):
    e = Engine(Settings(collect=False, database_path=":memory:", _env_file=None), fake_providers)
    await e.start()
    try:
        now = utcnow()
        fetched = (
            now + timedelta(hours=1)
            if bad_clock == "future"
            else now.replace(tzinfo=None)
            if bad_clock == "naive"
            else now
        )
        saved = Envelope(
            source_id="usgs",
            status="disabled" if bad_clock == "wrong_status" else "fresh",
            fetched_at=fetched,
            payload=Payload(record_count=1, data={"bad_restore": True}),
        )
        await e.store.save(e.key("usgs", {}), saved.model_dump_json(), 3600)
        result = await e.get("usgs")
        assert fake_providers.calls == 1 and "bad_restore" not in result.payload.data
    finally:
        await e.close()


async def test_failed_sqlite_statement_rolls_back_and_future_writes_still_work():
    store = SnapshotStore(":memory:")
    await store.open()
    try:
        await store.save("good", "before", 100)
        store.db.execute(
            "CREATE TRIGGER fixture_failure AFTER INSERT ON snapshots WHEN NEW.key='bad' BEGIN SELECT RAISE(FAIL,'OFFLINE TEST'); END"
        )
        store.db.commit()
        with pytest.raises(sqlite3.IntegrityError):
            await store.save("bad", "never commit", 100)
        assert await store.load("bad") is None
        assert not store.db.in_transaction
        await store.save("good", "after", 100)
        assert await store.load("good") == "after"
        assert await store.save("big", "x" * 2_000_001, 100) is False
    finally:
        await store.close()


def test_v2_cache_keys_do_not_reuse_short_v1_model_series(fake_providers):
    e = Engine(Settings(collect=False, _env_file=None), fake_providers)
    assert e.key("weather", {"lat": 27, "lon": 78}).startswith("v2:")
    assert e.key("air_quality", {"lat": 27, "lon": 78}).startswith("v2:")
    assert e.key("soil", {"lat": 27, "lon": 78}).startswith("v1:")


def test_balance_coverage_requires_the_same_hourly_pairs():
    start = utcnow().replace(minute=0, second=0, microsecond=0)
    rows = {start + timedelta(hours=i + 1): {"precipitation_mm": 1, "reference_et0_mm": 1} for i in range(24)}
    rows[start + timedelta(hours=1)]["precipitation_mm"] = None
    rows[start + timedelta(hours=2)]["reference_et0_mm"] = None
    r = summarize_window(rows, start, 24)
    assert r["coverage"]["precipitation_mm"] == 23 and r["coverage"]["reference_et0_mm"] == 23
    assert r["coverage"]["reference_balance_mm"] == 22 and r["reference_balance_mm"] is None


@pytest.fixture
def api_client(fake_providers):
    c = Settings(collect=False, database_path=":memory:", _env_file=None)
    with TestClient(create_app(c, Engine(c, fake_providers))) as client:
        yield client


def test_insights_endpoint_missing_sources_is_explicit_not_server_error(api_client):
    response = api_client.get("/api/v1/insights?lat=27&lon=78")
    assert response.status_code == 200
    d = response.json()
    assert d["status"] == "unavailable" and d["novelty"]["status"] == "insufficient_history"
    assert d["windows"][0]["precipitation_mm"] is None


@pytest.mark.parametrize(
    "query",
    [
        "base_c=30&cap_c=10",
        "base_c=nan",
        "cap_c=51",
        "as_of=2020-01-01T00:00:00Z",
        "as_of=2026-10-10T00:00:00",
    ],
)
def test_insights_rejects_bad_parameters_and_historical_replay(api_client, query):
    assert api_client.get("/api/v1/insights?lat=27&lon=78&" + query).status_code == 422


def test_comparison_uses_a_shared_server_clock_and_no_soil_calls(api_client, fake_providers):
    r = api_client.post(
        "/api/v1/compare",
        json={"points": [{"lat": 27, "lon": 78}, {"lat": 28, "lon": 79}, {"lat": 29, "lon": 80}]},
    )
    assert r.status_code == 200
    d = r.json()
    assert len(d["reports"]) == 3
    assert len({r["forecast_start"] for r in d["reports"]}) == 1
    assert len({r["as_of"] for r in d["reports"]}) == 1
    assert fake_providers.calls == 6
    assert all(set(r["provenance"]) == {"weather", "air_quality"} for r in d["reports"])


@pytest.mark.parametrize(
    "body",
    [
        {"points": []},
        {"points": [{"lat": 27, "lon": 78}]},
        {"points": [{"lat": 27, "lon": 78}] * 4},
        {"points": [{"lat": True, "lon": 78}, {"lat": 29, "lon": 80}]},
        {"points": [{"lat": 27, "lon": 78}] * 2, "base_c": True},
        {"points": [{"lat": 27, "lon": 78}] * 2, "base_c": 30, "cap_c": 10},
    ],
)
def test_comparison_is_bounded_and_numeric(api_client, body):
    assert api_client.post("/api/v1/compare", json=body).status_code == 422


def test_aoi_empty_kind_selection_is_not_all_kinds(api_client, fake_providers):
    api_client.get("/api/v1/sources/usgs")
    polygon = {"type": "Polygon", "coordinates": [[[77, 26], [79, 26], [79, 28], [77, 28], [77, 26]]]}
    assert api_client.post("/api/v1/aoi", json={"geometry": polygon}).json()["event_count"] == 1
    r = api_client.post("/api/v1/aoi", json={"geometry": polygon, "kinds": [], "minimum_priority": 0})
    assert r.status_code == 200 and r.json()["event_count"] == 0 and r.json()["filters"]["kinds"] == []


def test_readiness_has_meaningful_http_status(fake_providers):
    c = Settings(collect=False, database_path=":memory:", _env_file=None)
    e = Engine(c, fake_providers)
    client = TestClient(create_app(c, e))  # lifespan deliberately not entered
    assert client.get("/api/v1/ready").status_code == 503


def test_normalizer_tolerates_independent_short_arrays_and_preserves_zero():
    now = utcnow().replace(minute=0, second=0, microsecond=0)
    raw = {
        "current": {"time": now.isoformat()},
        "hourly": {
            "time": [(now + timedelta(hours=i)).isoformat() for i in range(3)],
            "precipitation": [0],
            "temperature_2m": None,
        },
        "hourly_units": {"precipitation": "mm", "temperature_2m": "°C"},
    }
    data, _warnings = normalize_model(raw, "weather")
    assert data["hourly"]["precipitation"] == [0, None, None]
    assert data["hourly"]["temperature_2m"] == [None, None, None]


@pytest.mark.parametrize("code", [4, 49, 60, 90, 2.5, True])
def test_unsupported_wmo_codes_are_not_invented_weather_conditions(code):
    data, _ = normalize_model(
        {
            "current": {"time": utcnow().isoformat(), "weather_code": code},
            "current_units": {"weather_code": "wmo code"},
        },
        "weather",
    )
    assert data["current"]["weather_code"] is None


@pytest.mark.parametrize("offset", [3600, True, None])
def test_unexpected_provider_timezone_is_not_silently_assumed_utc(offset):
    from atlas_app.transport import UpstreamError

    with pytest.raises(UpstreamError):
        normalize_model({"current": {"time": utcnow().isoformat()}, "utc_offset_seconds": offset}, "weather")


@pytest.mark.parametrize(
    "key", ["a" * 32 + "\x00" + "a" * 10, "a" * 32 + "\n" + "a" * 10, "a" * 32 + " " + "a" * 10]
)
def test_header_secrets_reject_controls_and_whitespace(key):
    with pytest.raises(ValueError):
        Settings(auth_required=True, api_key=key, _env_file=None)


def test_package_and_api_version_align_at_v2(api_client):
    import atlas_app

    assert atlas_app.__version__ == "2.0.0"
    health = api_client.get("/api/v1/health").json()
    assert health["version"] == atlas_app.__version__
    schema = api_client.get("/api/openapi.json").json()
    assert schema["info"]["version"] == atlas_app.__version__


