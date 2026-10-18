import asyncio
from datetime import timedelta

import pytest
from atlas_app.config import Settings
from atlas_app.engine import Engine, EventBus
from atlas_app.registry import SOURCES
from atlas_app.schemas import utcnow


@pytest.fixture
async def engine(fake_providers):
    e = Engine(Settings(collect=False, database_path=":memory:", _env_file=None), fake_providers)
    await e.start()
    try:
        yield e
    finally:
        await e.close()


async def test_singleflight_includes_disk_lookup(engine, fake_providers):
    results = await asyncio.gather(*(engine.get("usgs") for _ in range(100)))
    assert fake_providers.calls == 1 and all(r.status == "fresh" for r in results)


async def test_disconnect_does_not_cancel_shared_ingestion(engine, fake_providers):
    fake_providers.delay = 0.05
    a = asyncio.create_task(engine.get("usgs"))
    await asyncio.sleep(0.005)
    a.cancel()
    with pytest.raises(asyncio.CancelledError):
        await a
    assert (await engine.get("usgs")).status == "fresh" and fake_providers.calls == 1


async def test_valid_empty_replaces_old_nonempty(engine, fake_providers):
    first = await engine.get("usgs")
    assert first.payload.record_count == 1
    first.fetched_at = utcnow() - timedelta(seconds=SOURCES["usgs"].ttl_seconds + 1)
    fake_providers.empty = True
    second = await engine.get("usgs")
    assert second.status == "empty" and second.payload.record_count == 0 and not second.payload.events
    assert engine.snapshot()[1] == []


async def test_failure_retains_original_age(engine, fake_providers):
    first = await engine.get("usgs")
    old = utcnow() - timedelta(seconds=SOURCES["usgs"].ttl_seconds + 1)
    first.fetched_at = old
    fake_providers.fail = True
    out = await engine.get("usgs")
    assert out.status == "stale" and out.fetched_at == old and out.payload.record_count == 1
    assert out.error_code == "test_outage"


async def test_negative_cache_stops_refresh_storm(engine, fake_providers):
    fake_providers.fail = True
    await engine.get("usgs")
    await asyncio.gather(*(engine.get("usgs") for _ in range(30)))
    assert fake_providers.calls == 1


async def test_expired_last_good_never_escapes(engine, fake_providers):
    first = await engine.get("usgs")
    first.fetched_at = utcnow() - timedelta(seconds=SOURCES["usgs"].max_stale_seconds + 1)
    fake_providers.fail = True
    out = await engine.get("usgs")
    assert out.status == "unavailable" and not out.payload.events
    assert not engine.snapshot()[1]


async def test_persistence_roundtrip_without_provider_refetch(tmp_path, fake_providers):
    settings = Settings(collect=False, database_path=str(tmp_path / "atlas.db"), _env_file=None)
    a = Engine(settings, fake_providers)
    await a.start()
    first = await a.get("usgs")
    await a.close()
    b = Engine(settings, fake_providers)
    await b.start()
    try:
        out = await b.get("usgs")
        assert out.fetched_at == first.fetched_at and fake_providers.calls == 1
    finally:
        await b.close()


async def test_cache_write_failure_does_not_discard_good_data(engine, monkeypatch):
    async def broken(*args):
        raise OSError("OFFLINE TEST DISK FAILURE")

    monkeypatch.setattr(engine.store, "save", broken)
    out = await engine.get("usgs")
    assert out.status == "fresh" and out.warnings
    assert "memory only" in out.warnings[0]


async def test_cache_read_failure_falls_back_to_provider(engine, monkeypatch):
    async def broken(*args):
        raise OSError("OFFLINE TEST DISK FAILURE")

    monkeypatch.setattr(engine.store, "load", broken)
    assert (await engine.get("usgs")).status == "fresh"


async def test_corrupt_persisted_envelope_does_not_block_refresh(engine):
    await engine.store.save(engine.key("usgs", {}), "{invalid}", 1000)
    assert (await engine.get("usgs")).status == "fresh"


async def test_absent_key_is_disabled_not_zero(engine, fake_providers):
    assert (await engine.get("firms_area")).status == "disabled" and fake_providers.calls == 0


def test_coordinate_cache_not_two_decimal_alias(engine):
    assert engine.key("soil", {"lat": 27.101, "lon": 78.151}) != engine.key(
        "soil", {"lat": 27.104, "lon": 78.154}
    )


def test_source_identity_keys_are_query_specific(engine):
    assert engine.key("worldbank", {"country": "IN"}) != engine.key("worldbank", {"country": "JP"})


def test_bus_has_backpressure_and_latest_revision():
    bus = EventBus()
    q = bus.subscribe()
    for _ in range(20):
        bus.publish("test")
    assert q.qsize() == 8
    while not q.empty():
        last = q.get_nowait()
    assert last["revision"] == 20
    bus.unsubscribe(q)
    assert len(bus.listeners) == 0


def test_stream_capacity_is_bounded():
    bus = EventBus()
    for _ in range(64):
        bus.subscribe()
    with pytest.raises(RuntimeError, match="stream_capacity"):
        bus.subscribe()


async def test_restart_poll_does_not_grant_cached_data_a_second_ttl(engine, monkeypatch):
    from atlas_app.schemas import Envelope

    remaining = []

    async def get(*args):
        return Envelope(source_id="usgs", status="fresh", age_seconds=50)

    async def sleep(seconds):
        remaining.append(seconds)
        raise asyncio.CancelledError

    monkeypatch.setattr(engine, "get", get)
    monkeypatch.setattr(asyncio, "sleep", sleep)
    with pytest.raises(asyncio.CancelledError):
        await engine._poll("usgs")
    assert SOURCES["usgs"].ttl_seconds - 50 <= remaining[0] <= SOURCES["usgs"].ttl_seconds - 48


async def test_memory_cache_has_byte_limit_not_only_entry_limit(engine):
    from atlas_app.schemas import Envelope, Payload

    engine.max_cache_bytes = 1200
    for i in range(10):
        engine._remember(
            str(i),
            Envelope(source_id="weather", status="fresh", payload=Payload(data={"fixture": "x" * 400})),
        )
    assert engine.cache_bytes <= 1200 and len(engine.cache) < 10
    assert sum(engine.cache_sizes.values()) == engine.cache_bytes


async def test_query_cache_hit_updates_last_served_health(engine, fake_providers):
    await engine.get("soil", lat=27.1, lon=78.15)
    fake_providers.fail = True
    assert (await engine.get("soil", lat=28, lon=78)).status == "unavailable"
    assert engine.peek("soil").status == "unavailable"
    assert (await engine.get("soil", lat=27.1, lon=78.15)).status == "fresh"
    assert engine.peek("soil").status == "fresh"
