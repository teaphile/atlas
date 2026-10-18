"""Hand-authored offline fixtures. Never loaded into the live application."""

import asyncio

import pytest
from atlas_app.schemas import Event, Payload, Point, utcnow
from atlas_app.transport import UpstreamError


@pytest.fixture
def make_event():
    def make(id="test-1", lat=27.1, lon=78.15, kind="earthquake", source="usgs", at=None, **kw):
        return Event(
            id=f"{source}:{id}",
            source_id=source,
            source_record_id=id,
            kind=kind,
            title="OFFLINE TEST FIXTURE",
            point=Point(lat=lat, lon=lon),
            occurred_at=at or utcnow(),
            **kw,
        )

    return make


class FakeProviders:
    def __init__(self):
        self.calls = 0
        self.fail = False
        self.empty = False
        self.delay = 0.01

    async def fetch(self, id, **params):
        self.calls += 1
        await asyncio.sleep(self.delay)
        if self.fail:
            raise UpstreamError("test_outage")
        if self.empty:
            return Payload()
        return Payload(
            events=[
                Event(
                    id=f"{id}:fixture",
                    source_id=id,
                    source_record_id="fixture",
                    kind="earthquake",
                    title="OFFLINE TEST FIXTURE",
                    point=Point(lat=27.1, lon=78.15),
                    occurred_at=utcnow(),
                )
            ],
            record_count=1,
        )


@pytest.fixture
def fake_providers():
    return FakeProviders()
