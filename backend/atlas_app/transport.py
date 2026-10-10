"""Bounded, fixed-origin egress. No public arbitrary-URL proxy.
Rate limits are deployment-local; horizontal replicas need a shared egress budget.
"""

from __future__ import annotations
import asyncio, json, random, time
from collections import defaultdict, deque
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import urlsplit
import httpx
from .config import Settings

ALLOWED_HOSTS = frozenset(
    {
        "earthquake.usgs.gov",
        "eonet.gsfc.nasa.gov",
        "www.gdacs.org",
        "api.weather.gov",
        "firms.modaps.eosdis.nasa.gov",
        "services.swpc.noaa.gov",
        "api.wheretheiss.at",
        "feeds.bbci.co.uk",
        "www.cisa.gov",
        "api.open-meteo.com",
        "air-quality-api.open-meteo.com",
        "flood-api.open-meteo.com",
        "geocoding-api.open-meteo.com",
        "rest.isric.org",
        "api.adsb.lol",
        "api.tfl.gov.uk",
        "power.larc.nasa.gov",
        "api.gbif.org",
        "api.worldbank.org",
        "api.gdeltproject.org",
        "tiles.openfreemap.org",
        "gibs.earthdata.nasa.gov",
        "s3-eu-west-1.amazonaws.com",
    }
)


class UpstreamError(Exception):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


class HttpGateway:
    def __init__(self, config: Settings, client: httpx.AsyncClient | None = None):
        self.config = config
        self.client = client or httpx.AsyncClient(
            timeout=httpx.Timeout(config.http_timeout, connect=6),
            limits=httpx.Limits(max_connections=16, max_keepalive_connections=12),
            follow_redirects=False,
            headers={"User-Agent": config.user_agent},
        )
        self._global = asyncio.Semaphore(8)
        self._slots = defaultdict(lambda: asyncio.Semaphore(2))
        self._locks = defaultdict(asyncio.Lock)
        self._next = defaultdict(float)
        self._blocked = defaultdict(float)
        self._failures = defaultdict(int)
        self._budgets = defaultdict(deque)
        self.metrics = defaultdict(int)

    def validate_url(self, url: str) -> str:
        try:
            p = urlsplit(url)
            port = p.port
        except ValueError:
            raise UpstreamError("egress_blocked") from None
        if (
            p.scheme != "https"
            or p.hostname not in ALLOWED_HOSTS
            or p.username
            or p.password
            or port not in (None, 443)
        ):
            raise UpstreamError("egress_blocked")
        return p.hostname

    async def _admit(self, host: str):
        family = "open-meteo.com" if host.endswith("open-meteo.com") else host
        async with self._locks[family]:
            now = time.monotonic()
            if self._blocked[host] > now:
                raise UpstreamError("circuit_open_or_retry_after")
            budget = self._budgets[family]
            while budget and budget[0] < now - 86400:
                budget.popleft()
            limit = 3000 if family == "open-meteo.com" else 10000
            if len(budget) >= limit:
                raise UpstreamError("deployment_daily_budget_exhausted")
            delay = max(0, self._next[family] - now)
            if delay:
                await asyncio.sleep(delay)
            budget.append(time.monotonic())
            self._next[family] = time.monotonic() + (
                12.1 if host == "rest.isric.org" else 1.1 if host == "api.adsb.lol" else 0.18
            )

    async def get_bytes(self, url: str, params=None, limit: int | None = None, accept: str = "*/*") -> bytes:
        host = self.validate_url(url)
        limit = limit or self.config.max_response_bytes
        try:
            async with asyncio.timeout(self.config.http_timeout * 2 + 3):
                async with self._slots[host], self._global:
                    attempts = 1 if host == "rest.isric.org" else 2
                    for attempt in range(attempts):
                        await self._admit(host)
                        self.metrics[f"{host}:requests"] += 1
                        try:
                            async with self.client.stream(
                                "GET",
                                url,
                                params=params,
                                headers={"Accept": accept},
                                timeout=httpx.Timeout(22, connect=6)
                                if host == "rest.isric.org"
                                else httpx.Timeout(self.config.http_timeout, connect=6),
                            ) as res:
                                if res.status_code == 429:
                                    raw = res.headers.get("Retry-After", "60")
                                    try:
                                        delay = float(raw)
                                    except ValueError:
                                        try:
                                            delay = (
                                                parsedate_to_datetime(raw) - datetime.now(timezone.utc)
                                            ).total_seconds()
                                        except Exception:
                                            delay = 60
                                    self._blocked[host] = time.monotonic() + max(1, min(delay, 86400))
                                    raise UpstreamError("upstream_rate_limited")
                                if res.status_code >= 500 and attempt + 1 < attempts:
                                    await asyncio.sleep(0.3 + random.random() * 0.4)
                                    continue
                                if res.status_code != 200:
                                    raise UpstreamError(f"upstream_http_{res.status_code}")
                                # No redirects are followed; credentials cannot leak to a redirect host.
                                length = res.headers.get("Content-Length", "")
                                if length.isdigit() and int(length) > limit:
                                    raise UpstreamError("response_too_large")
                                data = bytearray()
                                async for chunk in res.aiter_bytes():
                                    data.extend(chunk)
                                    if len(data) > limit:
                                        raise UpstreamError("response_too_large")
                                self._failures[host] = 0
                                return bytes(data)
                        except (httpx.TimeoutException, httpx.NetworkError):
                            if attempt + 1 >= attempts:
                                raise UpstreamError("upstream_timeout_or_network")
                            await asyncio.sleep(0.25 + random.random() * 0.4)
        except TimeoutError:
            self._failure(host)
            raise UpstreamError("upstream_deadline") from None
        except UpstreamError:
            self._failure(host)
            raise
        except httpx.HTTPError:
            self._failure(host)
            raise UpstreamError("upstream_transport_error") from None
        raise UpstreamError("upstream_exhausted")

    def _failure(self, host):
        self.metrics[f"{host}:errors"] += 1
        self._failures[host] += 1
        if self._failures[host] >= 3:
            # Never shorten a provider's Retry-After.
            self._blocked[host] = max(
                self._blocked[host], time.monotonic() + min(900, 30 * 2 ** min(5, self._failures[host] - 3))
            )

    async def json(self, url, params=None):
        data = await self.get_bytes(url, params, accept="application/json, application/geo+json")
        try:
            return json.loads(data, parse_constant=lambda x: (_ for _ in ()).throw(ValueError(x)))
        except (ValueError, UnicodeDecodeError):
            raise UpstreamError("invalid_json_schema") from None

    async def text(self, url, params=None):
        data = await self.get_bytes(url, params)
        try:
            return data.decode("utf-8-sig")
        except UnicodeDecodeError:
            raise UpstreamError("invalid_text_encoding") from None

    async def close(self):
        await self.client.aclose()
