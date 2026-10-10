from __future__ import annotations
import asyncio, csv, html, io, json, logging, re, time
from collections import OrderedDict, Counter
from contextlib import asynccontextmanager
from datetime import timedelta, datetime
from pathlib import Path
from typing import Annotated, Literal
from fastapi import FastAPI, Query, Request, HTTPException
from fastapi.responses import JSONResponse, Response, StreamingResponse, FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.gzip import GZipMiddleware
from .config import Settings, settings
from .engine import Engine
from .registry import SOURCES
from .schemas import AOIRequest, ErosionScenario, ComparisonRequest, utcnow
from .analytics import environment_screen, soil_summary, erosion_scenario
from .insights import analyze_environment
from .geo import filter_events, proximity_groups, polygon_aoi, in_aoi, aoi_area_km2, haversine
from .security import SecurityMiddleware
from .transport import UpstreamError

logging.basicConfig(level=logging.INFO, format="%(message)s")
logging.getLogger("httpx").setLevel(logging.WARNING)
Lat = Annotated[float, Query(ge=-90, le=90, allow_inf_nan=False)]
Lon = Annotated[float, Query(ge=-180, le=180, allow_inf_nan=False)]


def create_app(config: Settings | None = None, engine: Engine | None = None):
    config = config or settings()
    eng = engine or Engine(config)
    tile_cache = OrderedDict()
    asset_inflight = {}

    @asynccontextmanager
    async def lifespan(app):
        await eng.start()
        app.state.engine = eng
        try:
            yield
        finally:
            pending = list(asset_inflight.values()) + list(map_fetches.values())
            for task in pending:
                task.cancel()
            await asyncio.gather(*pending, return_exceptions=True)
            await eng.close()

    app = FastAPI(
        title="ATLAS Earth Intelligence",
        version="2.0.0",
        description="Provenance-first public geospatial intelligence. Not an emergency warning service.",
        docs_url=None,
        redoc_url=None,
        openapi_url="/api/openapi.json",
        lifespan=lifespan,
    )
    app.state.engine = eng
    app.add_middleware(GZipMiddleware, minimum_size=1500)
    app.add_middleware(SecurityMiddleware, config=config)

    @app.get("/api/v1/health")
    async def health():
        return {
            "status": "ok",
            "service": "atlas",
            "version": "2.0.0",
            "uptime_seconds": round((utcnow() - eng.started_at).total_seconds()),
            "read_only": True,
        }

    @app.get("/api/v1/ready")
    async def ready():
        return JSONResponse(
            {"ready": eng.store.db is not None, "upstream_availability_is_not_readiness": True},
            status_code=200 if eng.store.db is not None else 503,
        )

    @app.get("/api/v1/sources")
    async def sources():
        return {
            "sources": eng.catalog(),
            "generated_at": utcnow().isoformat(),
            "adapter_count": len(SOURCES),
            "note": "Fresh describes the fetch cache, not the observation age or scientific validity.",
        }

    @app.get("/api/v1/snapshot")
    async def snapshot(
        request: Request, hours: Annotated[int, Query(ge=1, le=720)] = 168, include_cameras: bool = False
    ):
        envelopes, all_events = eng.snapshot(include_cameras)
        events = filter_events(all_events, hours)
        return {
            "generated_at": utcnow().isoformat(),
            "revision": eng.bus.revision,
            "events": [e.model_dump(mode="json") for e in events],
            "sources": eng.catalog(),
            "summary": {
                "record_count": len(events),
                "mapped_count": sum(e.point is not None for e in events),
                "by_kind": dict(Counter(e.kind for e in events)),
                "fresh_feeds": sum(e.status in ("fresh", "empty") for e in envelopes.values()),
                "loaded_feeds": len(envelopes),
            },
            "context": {id: env.payload.data for id, env in envelopes.items() if env.payload.data},
            "limitations": [
                "Records are not unique incidents. Cross-source overlap is retained.",
                "Missing coverage never means no risk.",
                "Fetch time, event time, model nature and provider scope are separate.",
            ],
        }

    @app.get("/api/v1/sources/{source_id}")
    async def source_data(
        source_id: str,
        lat: Lat = 27.1,
        lon: Lon = 78.15,
        country: Annotated[str, Query(pattern="^[A-Z]{2,3}$")] = "IN",
        q: Annotated[str, Query(max_length=80)] = "",
    ):
        if source_id not in SOURCES:
            raise HTTPException(404, "Unknown source")
        if source_id == "geocoding" and len(q.strip()) < 2:
            raise HTTPException(422, "A place query needs at least two characters")
        env = await eng.get(source_id, lat=lat, lon=lon, country=country, query=q)
        result = env.model_dump(mode="json")
        result["definition"] = SOURCES[source_id].model_dump()
        result["query"] = {"lat": round(lat, 4), "lon": round(lon, 4), "country": country}
        if source_id == "soil":
            result["analysis"] = soil_summary(env.payload.data)
        return result

    @app.get("/api/v1/geocode")
    async def geocode(q: Annotated[str, Query(min_length=2, max_length=80)]):
        env = await eng.get("geocoding", query=q.strip())
        return {
            "results": env.payload.data.get("results", []),
            "status": env.status,
            "error_code": env.error_code,
        }

    @app.get("/api/v1/location")
    async def location(lat: Lat, lon: Lon, include_soil: bool = False):
        from .schemas import Envelope

        ids = ["weather", "air_quality", "flood", "elevation"] + (["soil"] if include_soil else [])
        result = await asyncio.gather(*(eng.get(id, lat=lat, lon=lon) for id in ids))
        envelopes = dict(zip(ids, result))
        if not include_soil:
            envelopes["soil"] = Envelope(
                source_id="soil",
                status="idle",
                warnings=[
                    "Soil profiles load separately so slow soil queries do not block current conditions."
                ],
            )
        _, all_events = eng.snapshot()
        nearby = []
        for e in filter_events(all_events, 168):
            if e.point and e.kind in ("earthquake", "fire", "storm", "flood", "volcano", "weather"):
                distance = haversine(lat, lon, e.point.lat, e.point.lon)
                if distance <= 250:
                    nearby.append({"event": e.model_dump(mode="json"), "distance_km": round(distance, 1)})
        nearby.sort(key=lambda x: x["distance_km"])
        return {
            "point": {"lat": round(lat, 4), "lon": round(lon, 4)},
            "generated_at": utcnow().isoformat(),
            "sources": {k: v.model_dump(mode="json") for k, v in envelopes.items()},
            "screening": environment_screen(envelopes),
            "soil_summary": soil_summary(envelopes["soil"].payload.data),
            "nearby_events": nearby[:35],
            "nearby_method": "Great-circle distance from point to provider point/representative geometry; not a hazard impact radius.",
        }

    @app.get("/api/v1/insights")
    async def insights(
        lat: Lat,
        lon: Lon,
        base_c: Annotated[float, Query(ge=-10, le=49, allow_inf_nan=False)] = 10.0,
        cap_c: Annotated[float, Query(ge=-9, le=50, allow_inf_nan=False)] = 30.0,
        as_of: datetime | None = None,
    ):
        analysis_time = utcnow()
        if base_c >= cap_c:
            raise HTTPException(422, "Thermal base must be below cap")
        if as_of is not None:
            if as_of.tzinfo is None or not -60 <= (analysis_time - as_of).total_seconds() <= 600:
                raise HTTPException(
                    422,
                    "as_of must include a timezone and be within the last ten minutes (not historical replay)",
                )
            analysis_time = as_of
        ids = ["weather", "air_quality"]
        result = await asyncio.gather(*(eng.get(id, lat=lat, lon=lon) for id in ids))
        report = await asyncio.to_thread(
            analyze_environment, dict(zip(ids, result)), analysis_time, base_c, cap_c
        )
        report["point"] = {"lat": round(lat, 4), "lon": round(lon, 4)}
        report["generated_at"] = utcnow().isoformat()
        return report

    @app.post("/api/v1/compare")
    async def compare(body: ComparisonRequest):
        if body.base_c >= body.cap_c:
            raise HTTPException(422, "Thermal base must be below cap")
        as_of = utcnow()

        async def one(point):
            ids = ["weather", "air_quality"]
            values = await asyncio.gather(*(eng.get(id, lat=point.lat, lon=point.lon) for id in ids))
            report = await asyncio.to_thread(
                analyze_environment, dict(zip(ids, values)), as_of, body.base_c, body.cap_c
            )
            report["point"] = {"lat": round(point.lat, 4), "lon": round(point.lon, 4)}
            return report

        reports = await asyncio.gather(*(one(point) for point in body.points))
        return {
            "as_of": as_of.isoformat(),
            "generated_at": utcnow().isoformat(),
            "reports": reports,
            "scope": "Same UTC forecast window; provider-model comparison, not a place safety ranking. Soil and other slow providers are not queried.",
        }

    @app.get("/api/v1/fusion")
    async def fusion(hours: Annotated[int, Query(ge=1, le=168)] = 72):
        _, events = eng.snapshot()
        eligible = filter_events(events, hours)
        return await asyncio.to_thread(proximity_groups, eligible)

    @app.post("/api/v1/aoi")
    async def aoi(body: AOIRequest):
        try:
            p, anchor = polygon_aoi(body.geometry)
        except (ValueError, TypeError) as e:
            raise HTTPException(422, str(e)) from None
        envelopes, events = eng.snapshot(True)
        candidates = filter_events(
            events, body.hours, kinds=body.kinds, minimum_priority=body.minimum_priority, end=body.end
        )
        inside = [e for e in candidates if in_aoi(e, p, anchor)]
        return {
            "geometry": body.geometry,
            "filters": {
                "kinds": body.kinds,
                "hours": body.hours,
                "minimum_priority": body.minimum_priority,
                "end": body.end.isoformat() if body.end else None,
            },
            "area_km2_spherical": aoi_area_km2(p),
            "event_count": len(inside),
            "by_kind": dict(Counter(e.kind for e in inside)),
            "source_ids": sorted({e.source_id for e in inside}),
            "events": [e.model_dump(mode="json") for e in inside],
            "unlocated_records_excluded": sum(e.point is None for e in candidates),
            "generated_at": utcnow().isoformat(),
            "scope": "Cached, bounded public feeds only; polygon membership includes boundaries and excludes hole interiors. Not a complete local risk assessment.",
        }

    @app.post("/api/v1/scenarios/erosion")
    async def scenario(body: ErosionScenario):
        return erosion_scenario(body)

    @app.get("/api/v1/export")
    async def export(
        format: Literal["geojson", "json", "csv"] = "geojson",
        hours: Annotated[int, Query(ge=1, le=720)] = 168,
    ):
        envelopes, events = eng.snapshot(True)
        events = filter_events(events, hours)
        rows = [e.model_dump(mode="json") for e in events]
        meta = {
            "generated_at": utcnow().isoformat(),
            "scope": "Current cached records, not unique incidents or exhaustive coverage",
            "sources": eng.catalog(),
        }
        if format == "geojson":
            features = [
                {
                    "type": "Feature",
                    "id": e.id,
                    "geometry": {"type": "Point", "coordinates": [e.point.lon, e.point.lat]}
                    if e.point
                    else None,
                    "properties": e.model_dump(mode="json", exclude={"point"}),
                }
                for e in events
            ]
            return JSONResponse(
                {"type": "FeatureCollection", "features": features, "metadata": meta},
                headers={"Content-Disposition": 'attachment; filename="atlas-observations.geojson"'},
            )
        if format == "json":
            return JSONResponse(
                {"metadata": meta, "events": rows},
                headers={"Content-Disposition": 'attachment; filename="atlas-observations.json"'},
            )
        s = io.StringIO()
        writer = csv.writer(s)
        writer.writerow(
            [
                "id",
                "kind",
                "source_id",
                "title",
                "latitude",
                "longitude",
                "occurred_at",
                "nature",
                "severity",
                "url",
            ]
        )

        def safe(v):
            return (
                "'" + v
                if isinstance(v, str) and v.lstrip().startswith(("=", "+", "-", "@", "\t", "\r"))
                else v
            )

        for e in events:
            writer.writerow(
                [
                    safe(v)
                    for v in [
                        e.id,
                        e.kind,
                        e.source_id,
                        e.title,
                        e.point.lat if e.point else "",
                        e.point.lon if e.point else "",
                        e.occurred_at.isoformat() if e.occurred_at else "",
                        e.nature,
                        e.severity,
                        e.url,
                    ]
                ]
            )
        return Response(
            s.getvalue(),
            media_type="text/csv",
            headers={"Content-Disposition": 'attachment; filename="atlas-observations.csv"'},
        )

    @app.get("/api/v1/stream")
    async def stream(request: Request):
        try:
            q = eng.bus.subscribe()
        except RuntimeError:
            raise HTTPException(503, "Stream capacity reached") from None

        async def generate():
            try:
                # On every reconnect, request a current-state resync. No durable replay promise.
                yield f'event: sync\nid: {eng.bus.revision}\ndata: {{"revision":{eng.bus.revision}}}\n\n'
                while True:
                    if await request.is_disconnected():
                        break
                    try:
                        msg = await asyncio.wait_for(q.get(), timeout=15)
                        yield f"event: sync\nid: {msg['revision']}\ndata: {json.dumps(msg)}\n\n"
                    except asyncio.TimeoutError:
                        yield ": heartbeat\n\n"
            finally:
                eng.bus.unsubscribe(q)

        return StreamingResponse(
            generate(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
        )

    async def image_bytes(url, ttl=3600, limit=600000):
        if not eng.http:
            raise HTTPException(503, "Image transport unavailable")
        entry = tile_cache.get(url)
        if entry and time.monotonic() - entry[0] < ttl:
            tile_cache.move_to_end(url)
            return entry[1]

        async def load():
            b = await eng.http.get_bytes(url, limit=limit)
            if not (b.startswith(b"\x89PNG") or b.startswith(b"\xff\xd8") or b.startswith(b"RIFF")):
                raise UpstreamError("invalid_image")
            tile_cache[url] = (time.monotonic(), b)
            while len(tile_cache) > 160 or sum(len(v[1]) for v in tile_cache.values()) > 24_000_000:
                tile_cache.popitem(last=False)
            return b

        if url not in asset_inflight:
            if len(asset_inflight) >= 24:
                raise HTTPException(503, "Tile concurrency budget exceeded")
            t = asyncio.create_task(load())
            asset_inflight[url] = t

            def done(task):
                asset_inflight.pop(url, None)
                if not task.cancelled():
                    task.exception()

            t.add_done_callback(done)
        try:
            return await asyncio.shield(asset_inflight[url])
        except UpstreamError as exc:
            raise HTTPException(502, exc.code) from None

    # Versioned, provider-owned vector tiles. The client never supplies an upstream URL.
    map_meta = {"template": None, "fetched": 0.0}
    map_meta_lock = asyncio.Lock()
    map_bytes = OrderedDict()
    map_fetches = {}

    async def map_asset(url: str, limit: int = 4_000_000):
        entry = map_bytes.get(url)
        if entry and time.monotonic() - entry[0] < 21600:
            map_bytes.move_to_end(url)
            return entry[1]

        async def load():
            b = await eng.http.get_bytes(url, limit=limit)
            if b.lstrip().lower().startswith((b"<html", b"<!doctype")):
                raise UpstreamError("unexpected_tile_document")
            map_bytes[url] = (time.monotonic(), b)
            while len(map_bytes) > 220 or sum(len(v[1]) for v in map_bytes.values()) > 32_000_000:
                map_bytes.popitem(last=False)
            return b

        if url not in map_fetches:
            if len(map_fetches) >= 32:
                raise HTTPException(503, "Basemap concurrency budget exceeded")
            task = asyncio.create_task(load())
            map_fetches[url] = task

            def done(t):
                map_fetches.pop(url, None)
                if not t.cancelled():
                    t.exception()

            task.add_done_callback(done)
        try:
            return await asyncio.shield(map_fetches[url])
        except UpstreamError as exc:
            raise HTTPException(502, exc.code) from None

    @app.get("/api/v1/map/tiles/{z}/{x}/{y}.pbf", include_in_schema=False)
    async def vector_tile(z: int, x: int, y: int):
        if not 0 <= z <= 14 or not 0 <= x < 2**z or not 0 <= y < 2**z:
            raise HTTPException(422, "Invalid vector tile coordinate")
        if not eng.http:
            raise HTTPException(503, "Map transport unavailable")
        async with map_meta_lock:
            if not map_meta["template"] or time.monotonic() - map_meta["fetched"] > 21600:
                try:
                    meta = await eng.http.json("https://tiles.openfreemap.org/planet")
                    template = meta.get("tiles", [""])[0]
                    if not re.fullmatch(
                        r"https://tiles\.openfreemap\.org/planet/[0-9]{8}_[0-9]{6}_pt/\{z\}/\{x\}/\{y\}\.pbf",
                        template,
                    ):
                        raise UpstreamError("basemap_template_changed")
                    map_meta.update(template=template, fetched=time.monotonic())
                except (UpstreamError, IndexError, TypeError, AttributeError):
                    if not map_meta["template"] or time.monotonic() - map_meta["fetched"] > 86400:
                        raise HTTPException(502, "Basemap metadata unavailable") from None
        url = map_meta["template"].format(z=z, x=x, y=y)
        return Response(
            await map_asset(url),
            media_type="application/x-protobuf",
            headers={"Cache-Control": "public, max-age=21600"},
        )

    @app.get("/api/v1/map/fonts/{fontstack}/{glyph_range}.pbf", include_in_schema=False)
    async def map_font(fontstack: str, glyph_range: str):
        if fontstack != "Noto Sans Regular":
            raise HTTPException(422, "Unsupported font stack")
        if not re.fullmatch(r"[0-9]{1,7}-[0-9]{1,7}", glyph_range):
            raise HTTPException(422, "Invalid glyph range")
        lo, hi = map(int, glyph_range.split("-"))
        if lo % 256 or hi != lo + 255 or hi > 1114111:
            raise HTTPException(422, "Invalid Unicode block")
        if not eng.http:
            raise HTTPException(503, "Map transport unavailable")
        b = await map_asset(
            f"https://tiles.openfreemap.org/fonts/Noto%20Sans%20Regular/{glyph_range}.pbf", 300000
        )
        return Response(
            b, media_type="application/x-protobuf", headers={"Cache-Control": "public, max-age=604800"}
        )

    @app.get("/api/v1/tiles/{style}/{z}/{x}/{y}")
    async def tile(style: Literal["satellite"], z: int, x: int, y: int):
        maxzoom = 9
        if not 0 <= z <= maxzoom or not 0 <= x < 2**z or not 0 <= y < 2**z:
            raise HTTPException(422, "Invalid tile coordinate")
        date = (utcnow().date() - timedelta(days=2)).isoformat()
        url = f"https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/{date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg"
        mime = "image/jpeg"
        b = await image_bytes(url)
        return Response(b, media_type=mime, headers={"Cache-Control": "public, max-age=3600"})

    @app.get("/api/v1/cameras/{code}/snapshot")
    async def camera_snapshot(code: str):
        if not re.fullmatch(r"[A-Za-z0-9_.-]{1,60}", code):
            raise HTTPException(422, "Invalid camera identifier")
        env = await eng.get("tfl")
        if not any(e.attributes.get("camera_code") == code for e in env.payload.events):
            raise HTTPException(404, "Camera not in the current public operator catalog")
        b = await image_bytes(f"https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/{code}.jpg", ttl=30)
        return Response(
            b,
            media_type="image/jpeg",
            headers={"Cache-Control": "public, max-age=30", "X-Capture-Time": "unknown"},
        )

    @app.get("/api/v1/metrics")
    async def metrics():
        lines = [
            "# TYPE atlas_cache_entries gauge",
            f"atlas_cache_entries {len(eng.cache)}",
            "# TYPE atlas_cache_hits_total counter",
            f"atlas_cache_hits_total {eng.cache_hits}",
            "# TYPE atlas_ingestion_inflight gauge",
            f"atlas_ingestion_inflight {len(eng.inflight)}",
            "# TYPE atlas_source_available gauge",
        ]
        for s in eng.catalog():
            lines.append(
                f'atlas_source_available{{source="{s["id"]}"}} {int(s["health"]["status"] in ("fresh", "empty"))}'
            )
        return Response("\n".join(lines) + "\n", media_type="text/plain")

    @app.get("/docs", response_class=HTMLResponse)
    async def api_docs():
        rows = "".join(
            f"<tr><td>{html.escape(method.upper())}</td><td><code>{html.escape(path)}</code></td><td>{html.escape(v.get('summary', ''))}</td></tr>"
            for path, methods in app.openapi()["paths"].items()
            for method, v in methods.items()
        )
        return (
            '<!doctype html><html><head><meta name="viewport" content="width=device-width"><title>ATLAS API reference</title><style>body{background:#0b1118;color:#d7e5e3;font:15px system-ui;max-width:1100px;margin:60px auto;padding:24px}a{color:#8aebc4}td{border-bottom:1px solid #24333d;padding:14px}code{color:#9ce8c9}table{width:100%}h1{font-size:38px}</style></head><body><p>ATLAS / DEVELOPER REFERENCE</p><h1>Evidence in. Intelligence out.</h1><p>Same-origin, read-only public feeds. Optional deployment authentication: <code>X-Atlas-Key</code>. No keys in URLs.</p><p><a href="/api/openapi.json">Download OpenAPI 3.1 schema</a> · <a href="/">Open dashboard</a></p><table>'
            + rows
            + "</table><p>Freshness is transport state, not scientific validity. Analysis is screening only, not emergency guidance.</p></body></html>"
        )

    front = Path(config.frontend_path)
    if (front / "assets").exists():
        app.mount("/assets", StaticFiles(directory=front / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    async def frontend(path: str):
        if path.startswith(("api/", "docs/")):
            raise HTTPException(404, "Unknown endpoint")
        candidate = (front / path).resolve()
        if front.resolve() in candidate.parents and candidate.is_file():
            return FileResponse(candidate)
        if (front / "index.html").exists():
            return FileResponse(front / "index.html")
        return HTMLResponse(
            '<h1>ATLAS API is running</h1><p>Build the frontend with <code>cd frontend && npm ci && npm run build</code>.</p><a href="/docs">API reference</a>'
        )

    return app


app = create_app()
