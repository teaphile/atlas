import asyncio

import pytest
from atlas_app.config import Settings
from atlas_app.engine import Engine
from atlas_app.main import create_app
from atlas_app.schemas import Envelope, Payload, utcnow
from atlas_app.security import SecurityMiddleware
from fastapi.testclient import TestClient
from pydantic import ValidationError


@pytest.fixture
def client(fake_providers):
    config = Settings(collect=False, database_path=":memory:", _env_file=None)
    engine = Engine(config, fake_providers)
    with TestClient(create_app(config, engine)) as c:
        yield c


@pytest.mark.parametrize("key", ["", "short", "x" * 257, "é" * 40, " " + "x" * 40])
def test_invalid_auth_configuration_fails_closed(key):
    with pytest.raises(ValidationError):
        Settings(auth_required=True, api_key=key, _env_file=None)


def test_secrets_not_in_settings_repr():
    assert "TOP_SECRET" not in repr(Settings(api_key="TOP_SECRET", _env_file=None))


def test_health_and_response_security_headers(client):
    r = client.get("/api/v1/health")
    assert r.status_code == 200 and r.json()["read_only"]
    assert r.headers["x-content-type-options"] == "nosniff"
    assert "connect-src 'self'" in r.headers["content-security-policy"]
    assert "frame-ancestors" not in r.headers["content-security-policy"]


@pytest.mark.parametrize("query", ["lat=91&lon=0", "lat=nan&lon=78", "lat=27&lon=181", "lat=27&lon=inf"])
def test_nonfinite_and_out_of_range_query(client, query):
    assert client.get("/api/v1/location?" + query).status_code == 422


def test_unknown_provider_not_dynamic_egress(client):
    assert client.get("/api/v1/sources/http://127.0.0.1").status_code == 404


def test_invalid_aoi_and_body_limits(client):
    assert (
        client.post("/api/v1/aoi", json={"geometry": {"type": "Polygon", "coordinates": []}}).status_code
        == 422
    )
    r = client.post("/api/v1/aoi", content="x" * 65537, headers={"Content-Type": "application/json"})
    assert r.status_code == 413 and r.headers["x-content-type-options"] == "nosniff"


def test_erosion_schema_rejects_negative_soil_loss_inputs(client):
    assert client.post("/api/v1/scenarios/erosion", json={"rainfall_erosivity": -1}).status_code == 422


def test_header_auth_only_not_query_auth(fake_providers):
    key = "a" * 40
    config = Settings(
        collect=False, database_path=":memory:", auth_required=True, api_key=key, _env_file=None
    )
    with TestClient(create_app(config, Engine(config, fake_providers))) as c:
        assert c.get("/api/v1/health").status_code == 200
        assert c.get("/api/v1/sources?api_key=" + key).status_code == 401
        assert c.get("/api/v1/sources", headers={"X-Atlas-Key": key}).status_code == 200
        assert c.get("/api/v1/map/tiles/99/0/0.pbf", headers={"X-Atlas-Key": key}).status_code == 422


def test_forwarded_headers_do_not_reset_peer_budget(fake_providers):
    config = Settings(collect=False, database_path=":memory:", rate_limit_per_minute=1, _env_file=None)
    with TestClient(create_app(config, Engine(config, fake_providers))) as c:
        assert c.get("/api/v1/sources", headers={"X-Forwarded-For": "1.1.1.1"}).status_code == 200
        assert c.get("/api/v1/sources", headers={"X-Forwarded-For": "8.8.8.8"}).status_code == 429


async def test_slow_body_counts_toward_inflight():
    started = asyncio.Event()
    release = asyncio.Event()
    sent = []

    async def app(scope, receive, send):
        await receive()
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"ok"})

    middleware = SecurityMiddleware(app, Settings(_env_file=None))

    async def receive():
        started.set()
        await release.wait()
        return {"type": "http.request", "body": b"{}", "more_body": False}

    async def send(m):
        sent.append(m)

    task = asyncio.create_task(
        middleware(
            {"type": "http", "path": "/api/v1/aoi", "method": "POST", "headers": [], "client": ("test", 1)},
            receive,
            send,
        )
    )
    await started.wait()
    assert middleware.inflight == 1
    release.set()
    await task
    assert middleware.inflight == 0


async def test_chunked_oversize_releases_reservation():
    sent = []
    chunks = iter([b"x" * 40000, b"y" * 30000])

    async def app(*args):
        raise AssertionError("Oversized body reached application")

    async def receive():
        return {"type": "http.request", "body": next(chunks), "more_body": True}

    async def send(m):
        sent.append(m)

    m = SecurityMiddleware(app, Settings(_env_file=None))
    await m(
        {"type": "http", "path": "/api/v1/aoi", "method": "POST", "headers": [], "client": ("test", 1)},
        receive,
        send,
    )
    assert sent[0]["status"] == 413 and m.inflight == 0


def test_csv_formula_injection_is_escaped(client, make_event):
    e = make_event()
    e.title = '=HYPERLINK("https://example.org")'
    client.app.state.engine.last["usgs"] = Envelope(
        source_id="usgs", status="fresh", fetched_at=utcnow(), payload=Payload(events=[e], record_count=1)
    )
    r = client.get("/api/v1/export?format=csv")
    assert r.status_code == 200 and "'=HYPERLINK" in r.text
