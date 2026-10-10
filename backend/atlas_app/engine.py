from __future__ import annotations
import asyncio, json, logging, random, time
from collections import OrderedDict, deque
from .config import Settings
from .schemas import Envelope, utcnow
from .registry import SOURCES, GLOBAL_SOURCES
from .transport import HttpGateway, UpstreamError
from .providers import Providers
from .storage import SnapshotStore

log = logging.getLogger("atlas.ingestion")


class EventBus:
    """Bounded invalidation stream, not an emergency-alert delivery system."""

    def __init__(self):
        self.revision = 0
        self.listeners = set()
        self.history = deque(maxlen=128)

    def publish(self, source_id):
        self.revision += 1
        msg = {"revision": self.revision, "source_id": source_id, "at": utcnow().isoformat()}
        self.history.append(msg)
        for q in tuple(self.listeners):
            if q.full():
                try:
                    q.get_nowait()
                except asyncio.QueueEmpty:
                    pass
            q.put_nowait(msg)

    def subscribe(self):
        if len(self.listeners) >= 64:
            raise RuntimeError("stream_capacity")
        q = asyncio.Queue(maxsize=8)
        self.listeners.add(q)
        return q

    def unsubscribe(self, q):
        self.listeners.discard(q)


class Engine:
    def __init__(
        self, config: Settings, providers: Providers | None = None, store: SnapshotStore | None = None
    ):
        self.config = config
        self.http = HttpGateway(config) if providers is None else None
        self.providers = providers or Providers(self.http, config)
        self.store = store or SnapshotStore(config.database_path, config.max_cache_entries)
        self.cache = OrderedDict()
        self.cache_sizes = {}
        self.cache_bytes = 0
        self.max_cache_bytes = 48_000_000
        self.failures = OrderedDict()
        self.inflight = {}
        self.last = {}
        self.tasks = []
        self.bus = EventBus()
        self.started_at = utcnow()
        self.cache_hits = 0

    async def start(self):
        await self.store.open()
        if self.config.collect:
            self.tasks = [asyncio.create_task(self._poll(id), name=f"collect:{id}") for id in GLOBAL_SOURCES]

    async def close(self):
        tasks = self.tasks + list(self.inflight.values())
        for t in tasks:
            t.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        if self.http:
            await self.http.close()
        await self.store.close()

    def key(self, id, params):
        spec = SOURCES[id]
        if spec.scope in ("global", "regional"):
            return f"v1:{id}"
        clean = {}
        if id == "geocoding":
            clean = {"query": params.get("query", "").strip().casefold()}
        elif id == "worldbank":
            clean = {"country": params.get("country", "IN")}
        elif id == "gdelt":
            clean = {}
        else:
            clean = {k: round(params[k], 4) for k in ("lat", "lon") if params.get(k) is not None}
        return f"v1:{id}:" + json.dumps(clean, sort_keys=True, separators=(",", ":"))

    def view(self, env: Envelope, id: str, error: Envelope | None = None):
        age = max(0, (utcnow() - env.fetched_at).total_seconds()) if env.fetched_at else None
        spec = SOURCES[id]
        if age is None or age > spec.max_stale_seconds:
            return Envelope(
                source_id=id,
                status="unavailable",
                fetched_at=env.fetched_at,
                age_seconds=age,
                checked_at=error.checked_at if error else utcnow(),
                error_code=error.error_code if error else "expired_last_good_snapshot",
            )
        stale = age > spec.ttl_seconds or error is not None
        return env.model_copy(
            update={
                "age_seconds": round(age, 2),
                "status": "stale" if stale else ("fresh" if env.payload.record_count else "empty"),
                "error_code": error.error_code if error else None,
                "checked_at": error.checked_at if error else env.checked_at,
                "warnings": env.payload.warnings
                + (["Serving last-good data; timestamp was not reset."] if stale else []),
            }
        )

    async def get(self, id: str, **params) -> Envelope:
        if id not in SOURCES:
            raise KeyError(id)
        if SOURCES[id].key_env and not self.config.firms_map_key:
            return Envelope(
                source_id=id,
                status="disabled",
                error_code="credentials_required",
                warnings=[f"Set {SOURCES[id].key_env} on the server to enable this optional feed."],
            )
        params = {
            k: round(v, 4) if k in ("lat", "lon") and isinstance(v, (int, float)) else v
            for k, v in params.items()
        }
        key = self.key(id, params)
        now = utcnow()
        cached = self.cache.get(key)
        if cached:
            self.cache.move_to_end(key)
            if (now - cached.fetched_at).total_seconds() < SOURCES[id].ttl_seconds:
                self.cache_hits += 1
                return self._served(id, self.view(cached, id))
        failure = self.failures.get(key)
        if failure and time.monotonic() < failure[1]:
            return self._served(id, self.view(cached, id, failure[0]) if cached else failure[0])
        if key in self.inflight:
            return await asyncio.shield(self.inflight[key])
        # The task is installed before the first await; all callers share disk read + fetch.
        if len(self.inflight) >= 48:
            return (
                self.view(
                    cached,
                    id,
                    Envelope(source_id=id, status="unavailable", error_code="ingestion_busy", checked_at=now),
                )
                if cached
                else Envelope(source_id=id, status="unavailable", error_code="ingestion_busy", checked_at=now)
            )
        task = asyncio.create_task(self._load_refresh(key, id, params))
        self.inflight[key] = task

        def done(t):
            self.inflight.pop(key, None)
            if not t.cancelled():
                t.exception()  # Always consume exceptions, even after client disconnect.

        task.add_done_callback(done)
        return await asyncio.shield(task)

    async def _load_refresh(self, key, id, params):
        cached = self.cache.get(key)
        if not cached:
            try:
                saved = await self.store.load(key)
            except Exception:
                saved = None
                log.warning(json.dumps({"event": "cache_read_failed", "source": id}))
            if saved:
                try:
                    cached = Envelope.model_validate_json(saved)
                    if cached.source_id != id or cached.fetched_at is None:
                        raise ValueError("invalid cached envelope")
                    self._remember(key, cached)
                    if (utcnow() - cached.fetched_at).total_seconds() < SOURCES[id].ttl_seconds:
                        self.last[id] = cached
                        self.bus.publish(id)
                        return self.view(cached, id)
                except ValueError:
                    cached = None
        start = time.monotonic()
        try:
            async with asyncio.timeout(30):
                payload = await self.providers.fetch(id, **params)
            now = utcnow()
            env = Envelope(
                source_id=id,
                status="fresh" if payload.record_count else "empty",
                fetched_at=now,
                checked_at=now,
                upstream_time=payload.upstream_time,
                age_seconds=0,
                latency_ms=round((time.monotonic() - start) * 1000),
                payload=payload,
                warnings=payload.warnings,
            )
            self._remember(key, env)
            self.failures.pop(key, None)
            try:
                await self.store.save(key, env.model_dump_json(), SOURCES[id].max_stale_seconds)
            except Exception:
                env.payload.warnings.append(
                    "Persistent cache unavailable; this result is retained in memory only."
                )
                env.warnings = list(env.payload.warnings)
                log.warning(json.dumps({"event": "cache_write_failed", "source": id}))
            self.last[id] = env
            self.bus.publish(id)
            log.info(
                json.dumps(
                    {
                        "event": "source_refresh",
                        "source": id,
                        "status": env.status,
                        "records": payload.record_count,
                        "latency_ms": env.latency_ms,
                    }
                )
            )
            return env
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            code = (
                exc.code
                if isinstance(exc, UpstreamError)
                else "upstream_deadline"
                if isinstance(exc, TimeoutError)
                else "normalization_failed"
            )
            error = Envelope(
                source_id=id,
                status="unavailable",
                checked_at=utcnow(),
                error_code=code,
                latency_ms=round((time.monotonic() - start) * 1000),
            )
            self.failures[key] = (error, time.monotonic() + 60)
            while len(self.failures) > self.config.max_cache_entries:
                self.failures.popitem(last=False)
            out = self.view(cached, id, error) if cached else error
            self.last[id] = out
            self.bus.publish(id)
            log.warning(
                json.dumps(
                    {
                        "event": "source_error",
                        "source": id,
                        "error_code": code,
                        "exception_type": type(exc).__name__,
                    }
                )
            )
            return out

    def _served(self, id, env):
        previous = self.last.get(id)
        self.last[id] = env
        signature = lambda e: (e.fetched_at, e.checked_at, e.status, e.error_code, e.payload.record_count)
        if previous is None or signature(previous) != signature(env):
            self.bus.publish(id)
        return env

    def _remember(self, key, env):
        size = len(env.model_dump_json().encode())
        self.cache_bytes -= self.cache_sizes.pop(key, 0)
        self.cache[key] = env
        self.cache_sizes[key] = size
        self.cache_bytes += size
        self.cache.move_to_end(key)
        while len(self.cache) > self.config.max_cache_entries or self.cache_bytes > self.max_cache_bytes:
            old, _ = self.cache.popitem(last=False)
            self.cache_bytes -= self.cache_sizes.pop(old, 0)

    async def _poll(self, id):
        while True:
            env = await self.get(id)
            ttl = SOURCES[id].ttl_seconds
            if env.status in ("stale", "unavailable"):
                delay = min(ttl, 60)
            else:
                # A restored/cache-hit response does not earn a second full TTL.
                delay = max(1, ttl - (env.age_seconds or 0))
            await asyncio.sleep(delay + random.uniform(0, min(2, ttl * 0.01)))

    def peek(self, id):
        env = self.last.get(id)
        if env:
            if env.status in ("fresh", "empty", "stale"):
                return self.view(env, id, env if env.error_code else None)
            return env
        return Envelope(
            source_id=id,
            status="refreshing" if any(k.startswith(f"v1:{id}") for k in self.inflight) else "idle",
        )

    def catalog(self):
        out = []
        for id, spec in SOURCES.items():
            env = self.peek(id)
            if spec.key_env and not self.config.firms_map_key:
                env = Envelope(source_id=id, status="disabled", error_code="credentials_required")
            out.append(
                {
                    **spec.model_dump(),
                    "health": env.model_dump(mode="json", exclude={"payload"}),
                    "record_count": env.payload.record_count,
                }
            )
        return out

    def snapshot(self, include_cameras=False):
        ids = GLOBAL_SOURCES + (["tfl"] if include_cameras else [])
        envelopes = {id: self.peek(id) for id in ids}
        events = {}
        for env in envelopes.values():
            for e in env.payload.events:
                # Expiration is applied even when the source has not refreshed.
                if e.expires_at and e.expires_at < utcnow():
                    continue
                events[e.id] = e
        return envelopes, list(events.values())
