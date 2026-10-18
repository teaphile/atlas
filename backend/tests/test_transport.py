import asyncio
import time

import httpx
import pytest
from atlas_app.config import Settings
from atlas_app.transport import HttpGateway, UpstreamError


def gateway(handler):
    return HttpGateway(
        Settings(_env_file=None),
        httpx.AsyncClient(transport=httpx.MockTransport(handler), follow_redirects=False),
    )


@pytest.mark.parametrize(
    "url",
    [
        "http://api.weather.gov/",
        "https://localhost/",
        "https://127.0.0.1/",
        "https://169.254.169.254/",
        "https://[::1]/",
        "https://api.weather.gov.evil.example/",
        "https://user:password@api.weather.gov/",
        "https://api.weather.gov:444/",
        "file:///etc/passwd",
    ],
)
async def test_egress_allowlist(url):
    g = gateway(lambda r: httpx.Response(200))
    try:
        with pytest.raises(UpstreamError, match="egress_blocked"):
            await g.get_bytes(url)
    finally:
        await g.close()


async def test_redirect_is_not_followed():
    calls = []

    def h(r):
        calls.append(str(r.url))
        return httpx.Response(302, headers={"Location": "http://127.0.0.1/private"})

    g = gateway(h)
    try:
        with pytest.raises(UpstreamError, match="upstream_http_302"):
            await g.get_bytes("https://api.weather.gov/")
        assert len(calls) == 1
    finally:
        await g.close()


async def test_declared_and_actual_size_limits():
    g = gateway(lambda r: httpx.Response(200, content=b"x" * 2001))
    try:
        with pytest.raises(UpstreamError, match="response_too_large"):
            await g.get_bytes("https://api.weather.gov/", limit=1000)
    finally:
        await g.close()


async def test_json_nonfinite_numbers_rejected():
    g = gateway(lambda r: httpx.Response(200, content=b'{"number":NaN}'))
    try:
        with pytest.raises(UpstreamError, match="invalid_json_schema"):
            await g.json("https://api.weather.gov/")
    finally:
        await g.close()


async def test_retry_after_not_shortened_by_circuit_breaker():
    g = gateway(lambda r: httpx.Response(429, headers={"Retry-After": "7200"}))
    try:
        with pytest.raises(UpstreamError, match="upstream_rate_limited"):
            await g.get_bytes("https://api.weather.gov/")
        assert g._blocked["api.weather.gov"] > time.monotonic() + 7190
        for _ in range(6):
            g._failure("api.weather.gov")
        assert g._blocked["api.weather.gov"] > time.monotonic() + 7190
        with pytest.raises(UpstreamError, match="circuit_open"):
            await g.get_bytes("https://api.weather.gov/")
    finally:
        await g.close()


async def test_provider_quota_shared_across_open_meteo_products():
    g = gateway(lambda r: httpx.Response(200, json={}))
    for _ in range(3000):
        g._budgets["open-meteo.com"].append(time.monotonic())
    try:
        with pytest.raises(UpstreamError, match="daily_budget"):
            await g.get_bytes("https://air-quality-api.open-meteo.com/v1/air-quality")
    finally:
        await g.close()


async def test_soil_cold_queries_get_one_longer_bounded_attempt():
    calls = []

    def h(r):
        calls.append(r)
        raise httpx.ReadTimeout("OFFLINE TEST TIMEOUT")

    g = gateway(h)
    try:
        with pytest.raises(UpstreamError, match="upstream_timeout_or_network"):
            await g.get_bytes("https://rest.isric.org/soilgrids/v2.0/properties/query")
        assert len(calls) == 1 and calls[0].extensions["timeout"]["read"] == 22
    finally:
        await g.close()


async def test_isric_fair_use_pacing_is_at_most_five_per_minute():
    g = gateway(lambda r: httpx.Response(200))
    try:
        before = time.monotonic()
        await g._admit("rest.isric.org")
        assert g._next["rest.isric.org"] >= before + 12.1
    finally:
        await g.close()


async def test_same_host_backlog_does_not_consume_other_host_global_slots(monkeypatch):
    release = asyncio.Event()
    two_started = asyncio.Event()
    count = 0

    async def h(r):
        nonlocal count
        if r.url.host == "api.weather.gov":
            count += 1
            if count == 2:
                two_started.set()
            await release.wait()
        return httpx.Response(200, content=b"{}")

    g = gateway(h)

    async def admit(host):
        pass

    monkeypatch.setattr(g, "_admit", admit)
    tasks = [asyncio.create_task(g.get_bytes("https://api.weather.gov/test")) for _ in range(8)]
    try:
        await asyncio.wait_for(two_started.wait(), 1)
        assert await asyncio.wait_for(g.get_bytes("https://earthquake.usgs.gov/test"), 1) == b"{}"
    finally:
        release.set()
        await asyncio.gather(*tasks)
        await g.close()
