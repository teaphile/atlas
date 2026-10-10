"""Antimeridian-aware AOIs and bounded ECEF spacetime candidate indexing."""

from __future__ import annotations
import math
from collections import defaultdict
from datetime import datetime, timezone
from itertools import product
from shapely.geometry import Polygon, Point as SPoint
from .schemas import Event

R = 6371.0088


def haversine(lat1, lon1, lat2, lon2):
    a, b = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    h = math.sin((b - a) / 2) ** 2 + math.cos(a) * math.cos(b) * math.sin(dl / 2) ** 2
    return R * 2 * math.asin(math.sqrt(min(1, max(0, h))))


def ecef(lat, lon):
    a, b = math.radians(lat), math.radians(lon)
    return R * math.cos(a) * math.cos(b), R * math.cos(a) * math.sin(b), R * math.sin(a)


def polygon_aoi(geometry: dict):
    if geometry.get("type") != "Polygon":
        raise ValueError("Only a GeoJSON Polygon is supported")
    rings = geometry.get("coordinates")
    if not isinstance(rings, list) or not 1 <= len(rings) <= 4:
        raise ValueError("Provide one outer ring and at most three holes")
    if sum(len(r) for r in rings if isinstance(r, list)) > 200:
        raise ValueError("At most 200 vertices are allowed")
    unwrapped = []
    anchor = None
    for ring in rings:
        if not isinstance(ring, list) or not 4 <= len(ring) <= 200 or ring[0] != ring[-1]:
            raise ValueError("Rings need at least four vertices and must be closed")
        out = []
        prev = anchor
        for c in ring:
            if (
                not isinstance(c, (list, tuple))
                or len(c) != 2
                or any(
                    isinstance(x, bool) or not isinstance(x, (float, int)) or not math.isfinite(x) for x in c
                )
            ):
                raise ValueError("Coordinates must be finite [longitude,latitude] pairs")
            lon, lat = c
            if not -180 <= lon <= 180 or not -90 <= lat <= 90:
                raise ValueError("Coordinate out of range")
            if prev is not None:
                lon += 360 * round((prev - lon) / 360)
            out.append((lon, lat))
            prev = lon
        if anchor is None:
            anchor = out[0][0]
        unwrapped.append(out)
    p = Polygon(unwrapped[0], unwrapped[1:])
    if p.is_empty or not p.is_valid or p.area < 1e-8 or p.bounds[2] - p.bounds[0] >= 180:
        raise ValueError("Polygon must be simple, non-degenerate and span less than 180° longitude")
    return p, anchor


def in_aoi(event: Event, polygon, anchor):
    if not event.point:
        return False
    lon = event.point.lon + 360 * round((anchor - event.point.lon) / 360)
    return polygon.covers(SPoint(lon, event.point.lat))


def aoi_area_km2(polygon):
    def ring_area(ring):
        cs = list(ring.coords)
        a = 0.0
        for (x1, y1), (x2, y2) in zip(cs, cs[1:]):
            a += math.radians(x2 - x1) * (2 + math.sin(math.radians(y1)) + math.sin(math.radians(y2)))
        return abs(a) * R * R / 2

    return round(max(0, ring_area(polygon.exterior) - sum(ring_area(h) for h in polygon.interiors)), 2)


def filter_events(
    events: list[Event],
    hours: int = 168,
    now: datetime | None = None,
    kinds=None,
    bbox=None,
    minimum_priority=0,
    end=None,
):
    now = now or datetime.now(timezone.utc)
    cutoff = now.timestamp() - hours * 3600
    out = []
    for e in events:
        if kinds is not None and e.kind not in kinds:
            continue
        if {"critical": 5, "high": 4, "moderate": 3, "low": 2, "info": 1, "unknown": 0}.get(
            e.severity, 0
        ) < minimum_priority:
            continue
        if end is not None and e.occurred_at and e.occurred_at > end:
            continue
        if e.kind in ("aircraft", "satellite") and (
            not e.occurred_at
            or (now - e.occurred_at).total_seconds() > (180 if e.kind == "aircraft" else 120)
        ):
            continue
        if e.expires_at and e.expires_at <= now:
            continue
        # Active warnings remain active even if their onset predates the window.
        if (
            e.nature != "catalog"
            and e.occurred_at
            and e.occurred_at.timestamp() < cutoff
            and not (e.expires_at and e.expires_at > now)
        ):
            continue
        if e.occurred_at and (e.occurred_at - now).total_seconds() > 3600 and e.nature != "forecast":
            continue
        if bbox:
            if not e.point:
                continue
            west, south, east, north = bbox
            within_lon = (
                west <= e.point.lon <= east if west <= east else e.point.lon >= west or e.point.lon <= east
            )
            if not within_lon or not south <= e.point.lat <= north:
                continue
        out.append(e)
    return out


def proximity_groups(events: list[Event], radius_km=40.0, window_seconds=21600, max_comparisons=60000):
    """Groups mean spatial/temporal proximity, not deduplication or independent corroboration.
    3-D Earth-centered cells avoid longitude/polar artifacts. Exact great-circle distance
    follows broad-phase neighbor lookup. Worst-case dense neighborhoods have an explicit cap.
    """
    if (
        isinstance(radius_km, bool)
        or not isinstance(radius_km, (int, float))
        or not math.isfinite(radius_km)
        or not 0.1 <= radius_km <= 1000
    ):
        raise ValueError("radius_km must be 0.1–1000")
    if (
        isinstance(window_seconds, bool)
        or not isinstance(window_seconds, (int, float))
        or not math.isfinite(window_seconds)
        or not 1 <= window_seconds <= 604800
    ):
        raise ValueError("window_seconds must be 1–604800")
    if (
        isinstance(max_comparisons, bool)
        or not isinstance(max_comparisons, int)
        or not 1 <= max_comparisons <= 60000
    ):
        raise ValueError("max_comparisons must be an integer 1–60000")
    eligible = [
        e
        for e in events
        if e.point and e.occurred_at and e.kind in {"earthquake", "fire", "flood", "storm", "volcano"}
    ]
    candidates = sorted(eligible, key=lambda e: e.occurred_at, reverse=True)[:3500]
    n = len(candidates)
    parent = list(range(n))
    sizes = [1] * n
    bins = defaultdict(list)
    comparisons = 0
    capped = False

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(i, j):
        i, j = find(i), find(j)
        if i == j:
            return
        if sizes[i] < sizes[j]:
            i, j = j, i
        parent[j] = i
        sizes[i] += sizes[j]

    offsets = list(product((-1, 0, 1), repeat=3))
    for i, e in enumerate(candidates):
        x, y, z = (math.floor(v / radius_km) for v in ecef(e.point.lat, e.point.lon))
        t = int(e.occurred_at.timestamp() // window_seconds)
        if not capped:
            for dx, dy, dz in offsets:
                if capped:
                    break
                for dt in (-1, 0, 1):
                    if capped:
                        break
                    for j in bins.get((e.kind, x + dx, y + dy, z + dz, t + dt), []):
                        comparisons += 1
                        if comparisons > max_comparisons:
                            capped = True
                            break
                        q = candidates[j]
                        if (
                            abs((e.occurred_at - q.occurred_at).total_seconds()) <= window_seconds
                            and haversine(e.point.lat, e.point.lon, q.point.lat, q.point.lon) <= radius_km
                        ):
                            union(i, j)
        bins[(e.kind, x, y, z, t)].append(i)
    groups = defaultdict(list)
    for i in range(n):
        groups[find(i)].append(candidates[i])
    out = []
    for group in groups.values():
        if len(group) < 2:
            continue
        # A real member anchors the group; a fabricated centroid is not an event location.
        representative = max(group, key=lambda e: e.occurred_at)
        out.append(
            {
                "anchor_id": representative.id,
                "kind": representative.kind,
                "record_count": len(group),
                "source_ids": sorted({e.source_id for e in group}),
                "event_ids": [e.id for e in group],
                "point": representative.point.model_dump(),
                "title": representative.title,
            }
        )
    out.sort(key=lambda g: g["record_count"], reverse=True)
    return {
        "groups": out[:40],
        "comparisons": min(comparisons, max_comparisons),
        "budget_exhausted": capped,
        "candidate_count": n,
        "eligible_count": len(eligible),
        "candidates_truncated": len(eligible) > 3500,
        "groups_truncated": len(out) > 40,
        "radius_km": radius_km,
        "window_seconds": window_seconds,
        "meaning": "Proximity groups, including transitive links. Not unique disasters, causal connections or independent corroboration.",
    }
