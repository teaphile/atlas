"""Schema-checked adapters. Null never becomes zero; source event time never becomes fetch time."""

from __future__ import annotations
import csv, hashlib, html, io, math, re
from datetime import datetime, timezone, timedelta
from email.utils import parsedate_to_datetime
from defusedxml.ElementTree import fromstring
from shapely.geometry import shape
from .schemas import Event, Payload, Point
from .transport import UpstreamError


def number(x):
    if isinstance(x, bool):
        return None
    try:
        f = float(x)
        return f if math.isfinite(f) else None
    except (TypeError, ValueError, OverflowError):
        return None


def timestamp(v):
    if v is None or isinstance(v, bool) or v == "":
        return None
    try:
        if isinstance(v, (int, float)):
            return datetime.fromtimestamp(v / 1000 if abs(v) > 1e11 else v, timezone.utc)
        s = str(v).strip()
        try:
            t = datetime.fromisoformat(s.replace("Z", "+00:00"))
        except ValueError:
            t = parsedate_to_datetime(s)
        return t.replace(tzinfo=timezone.utc) if t.tzinfo is None else t.astimezone(timezone.utc)
    except (ValueError, TypeError, OverflowError, OSError):
        return None


def text(s, limit=600):
    return html.unescape(re.sub(r"<[^<>]*>", " ", str(s or ""))).strip()[:limit]


def point(lat, lon):
    a, b = number(lat), number(lon)
    return (
        Point(lat=a, lon=b)
        if a is not None and b is not None and -90 <= a <= 90 and -180 <= b <= 180
        else None
    )


def records(obj, key):
    if not isinstance(obj, dict) or not isinstance(obj.get(key), list):
        raise UpstreamError("schema_drift")
    return obj[key]


def event(source, id, kind, title, **kwargs):
    return Event(
        id=f"{source}:{id}"[:300],
        source_id=source,
        source_record_id=str(id)[:230],
        kind=kind,
        title=text(title),
        **kwargs,
    )


def finished(events, raw_count, warnings=None, data=None, upstream=None):
    if raw_count and not events and not data:
        raise UpstreamError("all_records_invalid")
    # Idempotent identity; never collapse independent records by title alone.
    unique = {x.id: x for x in events}
    return Payload(
        events=list(unique.values()),
        record_count=len(unique),
        warnings=warnings or [],
        data=data or {},
        upstream_time=upstream,
    )


def usgs(d):
    rows = records(d, "features")
    out = []
    rejected = 0
    for r in rows[:1500]:
        try:
            p = r["properties"]
            c = r["geometry"]["coordinates"]
            pos = point(c[1], c[0])
            mag = number(p.get("mag"))
            if not pos or not r.get("id"):
                raise ValueError()
            level = (
                "unknown"
                if mag is None
                else "critical"
                if mag >= 7.5
                else "high"
                if mag >= 6
                else "moderate"
                if mag >= 4.5
                else "low"
            )
            out.append(
                event(
                    "usgs",
                    r["id"],
                    "earthquake",
                    p.get("place") or "Earthquake",
                    point=pos,
                    occurred_at=timestamp(p.get("time")),
                    updated_at=timestamp(p.get("updated")),
                    severity=level,
                    url=p.get("url", ""),
                    attributes={
                        "magnitude": mag,
                        "depth_km": number(c[2]) if len(c) > 2 else None,
                        "magnitude_type": p.get("magType"),
                        "tsunami_flag": p.get("tsunami"),
                        "review_status": p.get("status"),
                        "severity_basis": "Presentation bucket by magnitude, not predicted impact",
                        "provider_alert": p.get("alert"),
                    },
                )
            )
        except (KeyError, IndexError, TypeError, ValueError):
            rejected += 1
    warnings = ([f"{rejected} malformed records rejected"] if rejected else []) + (
        ["Catalog capped at 1500 events"] if len(rows) > 1500 else []
    )
    return finished(out, len(rows), warnings, upstream=timestamp(d.get("metadata", {}).get("generated")))


def eonet(d):
    rows = records(d, "events")
    out = []
    kinds = {
        "wildfires": "fire",
        "severeStorms": "storm",
        "volcanoes": "volcano",
        "floods": "flood",
        "drought": "drought",
        "earthquakes": "earthquake",
    }
    for r in rows[:300]:
        if not isinstance(r, dict) or not r.get("id"):
            continue
        geometries = sorted(
            [g for g in r.get("geometry", []) if isinstance(g, dict)], key=lambda g: str(g.get("date", ""))
        )
        g = geometries[-1] if geometries else {}
        c = g.get("coordinates", [])
        pos = None
        if g.get("type") == "Point" and len(c) >= 2:
            pos = point(c[1], c[0])
        cats = r.get("categories") or [{}]
        links = r.get("sources") or [{}]
        out.append(
            event(
                "eonet",
                r["id"],
                kinds.get(cats[0].get("id"), "other"),
                r.get("title", "Natural event"),
                point=pos,
                occurred_at=timestamp(g.get("date")),
                nature="bulletin",
                url=links[0].get("url") or r.get("link", ""),
                description=text(r.get("description"), 1000),
                attributes={
                    "category": cats[0].get("title"),
                    "original_sources": links,
                    "location_semantics": "Latest provider event geometry; not a complete hazard footprint",
                },
            )
        )
    return finished(out, len(rows), ["EONET is a curated event inventory, not real-time detection coverage."])


def gdacs(xml):
    root = fromstring(xml)
    rows = root.findall("./channel/item")
    out = []
    if root.tag != "rss":
        raise UpstreamError("schema_drift")

    def value(r, tag):
        el = next((n for n in r.iter() if n.tag.split("}")[-1] == tag), None)
        return el.text if el is not None else None

    for r in rows[:400]:
        et = value(r, "eventtype")
        eid = value(r, "eventid")
        color = value(r, "alertlevel")
        mag = None
        if not eid:
            continue
        sev = next((n for n in r if n.tag.split("}")[-1] == "severity"), None)
        if et == "EQ" and sev is not None:
            mag = number(sev.attrib.get("value"))
        out.append(
            event(
                "gdacs",
                f"{et}-{eid}",
                {
                    "EQ": "earthquake",
                    "FL": "flood",
                    "TC": "storm",
                    "VO": "volcano",
                    "WF": "fire",
                    "DR": "drought",
                }.get(et, "other"),
                value(r, "title"),
                point=point(value(r, "lat"), value(r, "long")),
                occurred_at=timestamp(value(r, "fromdate")),
                updated_at=timestamp(value(r, "datemodified")),
                nature="bulletin",
                severity={"Green": "low", "Orange": "moderate", "Red": "high"}.get(color, "unknown"),
                url=value(r, "link") or "",
                description=text(value(r, "description"), 1200),
                attributes={
                    "provider_alert": color,
                    "country": value(r, "country"),
                    "iso3": value(r, "iso3"),
                    "magnitude": mag,
                    "severity_basis": "Original GDACS alert category",
                },
            )
        )
    return finished(out, len(rows))


def nws(d):
    rows = records(d, "features")
    out = []
    for r in rows[:600]:
        p = r.get("properties") or {}
        pos = None
        if r.get("geometry"):
            try:
                g = shape(r["geometry"])
                if not g.is_empty and g.is_valid:
                    q = g.representative_point()
                    pos = point(q.y, q.x)
            except (ValueError, TypeError, KeyError):
                pass
        if not p.get("id") and not r.get("id"):
            continue
        out.append(
            event(
                "nws",
                hashlib.sha256(str(p.get("id", r.get("id"))).encode()).hexdigest()[:20],
                "weather",
                p.get("event", "Weather warning"),
                point=pos,
                occurred_at=timestamp(p.get("onset") or p.get("sent")),
                updated_at=timestamp(p.get("sent")),
                expires_at=timestamp(p.get("expires")),
                nature="bulletin",
                severity={
                    "Extreme": "critical",
                    "Severe": "high",
                    "Moderate": "moderate",
                    "Minor": "low",
                }.get(p.get("severity"), "unknown"),
                url=p.get("@id") or r.get("id", ""),
                description=text(p.get("headline") or p.get("description"), 1600),
                attributes={
                    "area": p.get("areaDesc"),
                    "urgency": p.get("urgency"),
                    "certainty": p.get("certainty"),
                    "instruction": text(p.get("instruction"), 1000),
                    "location_semantics": "Representative point inside official alert polygon, NOT an incident point"
                    if pos
                    else "No geometry supplied by NWS; retained as an unlocated warning",
                },
            )
        )
    return finished(out, len(rows), upstream=timestamp(d.get("updated")))


def firms(csv_text, source="firms"):
    reader = csv.DictReader(io.StringIO(csv_text))
    required = {"latitude", "longitude", "acq_date", "acq_time"}
    if not required.issubset(set(reader.fieldnames or [])):
        raise UpstreamError("schema_drift")
    out = []
    total = 0
    for r in reader:
        total += 1
        if total > 8000:
            raise UpstreamError("record_budget_exceeded")
        pos = point(r["latitude"], r["longitude"])
        t = timestamp(f"{r['acq_date']}T{r['acq_time'].zfill(4)[:2]}:{r['acq_time'].zfill(4)[2:]}:00Z")
        if not pos or not t:
            continue
        frp = number(r.get("frp"))
        rawid = f"{pos.lat}:{pos.lon}:{t.isoformat()}:{r.get('satellite', '')}"
        out.append(
            event(
                source,
                hashlib.sha256(rawid.encode()).hexdigest()[:20],
                "fire",
                f"Thermal anomaly · {pos.lat:.2f}, {pos.lon:.2f}",
                point=pos,
                occurred_at=t,
                severity="moderate" if frp is not None and frp >= 50 else "low",
                url="https://firms.modaps.eosdis.nasa.gov/map/",
                attributes={
                    "frp_mw": frp,
                    "detection_confidence": r.get("confidence"),
                    "satellite": r.get("satellite"),
                    "resolution_m": 375,
                    "severity_basis": "FRP display bucket, NOT wildfire danger",
                    "caveat": "Hotspots may include agriculture, industrial activity and other thermal anomalies.",
                },
            )
        )
    out.sort(key=lambda e: e.occurred_at, reverse=True)
    cap = 1800
    return finished(
        out[:cap],
        total,
        ["Thermal detections are not confirmed wildfires."]
        + ([f"Showing latest {cap} of {len(out)} records (display cap)"] if len(out) > cap else []),
        data={"upstream_count": len(out), "display_cap": cap},
    )


def kp(d):
    if not isinstance(d, list) or not d:
        raise UpstreamError("schema_drift")
    if isinstance(d[0], list):
        fields = d[0]
        rows = [dict(zip(fields, r)) for r in d[1:]]
    else:
        rows = d
    series = []
    for r in rows:
        t = timestamp(r.get("time_tag"))
        v = number(r.get("Kp", r.get("kp")))
        if t and v is not None and 0 <= v <= 9:
            series.append({"time": t.isoformat(), "kp": v})
    if not series:
        raise UpstreamError("all_records_invalid")
    series.sort(key=lambda r: r["time"])
    last = series[-1]
    return Payload(
        data={"current": last, "series": series[-80:]},
        record_count=len(series),
        upstream_time=timestamp(last["time"]),
    )


def space_alerts(d):
    if not isinstance(d, list):
        raise UpstreamError("schema_drift")
    out = []
    for r in d[:45]:
        if not isinstance(r, dict):
            continue
        message = text(r.get("message"), 2000)
        id = str(r.get("product_id", "")) + str(r.get("issue_datetime", ""))
        if not id or not message:
            continue
        headline = next(
            (
                l.strip()
                for l in message.splitlines()
                if l.strip().startswith(("WARNING:", "ALERT:", "WATCH:", "SUMMARY:"))
            ),
            message[:100],
        )
        out.append(
            event(
                "space_alerts",
                hashlib.sha256(id.encode()).hexdigest()[:20],
                "space",
                headline,
                nature="bulletin",
                occurred_at=timestamp(r.get("issue_datetime")),
                description=message,
                url="https://www.swpc.noaa.gov/products/alerts-watches-and-warnings",
            )
        )
    return finished(out, len(d))


def iss(d):
    if not isinstance(d, dict):
        raise UpstreamError("schema_drift")
    pos = point(d.get("latitude"), d.get("longitude"))
    t = timestamp(d.get("timestamp"))
    if not pos or not t:
        raise UpstreamError("schema_drift")
    return finished(
        [
            event(
                "iss",
                "25544",
                "satellite",
                "International Space Station",
                point=pos,
                occurred_at=t,
                nature="model",
                severity="info",
                url="https://wheretheiss.at/",
                attributes={
                    "altitude_km": number(d.get("altitude")),
                    "velocity_kmh": number(d.get("velocity")),
                    "visibility": d.get("visibility"),
                },
            )
        ],
        1,
        upstream=t,
    )


def rss(xml):
    root = fromstring(xml)
    if root.tag != "rss":
        raise UpstreamError("schema_drift")
    rows = root.findall("./channel/item")
    out = []
    for r in rows[:35]:
        url = r.findtext("link") or ""
        title = r.findtext("title")
        if not title or not url:
            continue
        out.append(
            event(
                "news",
                hashlib.sha256(url.encode()).hexdigest()[:20],
                "news",
                title,
                nature="news",
                occurred_at=timestamp(r.findtext("pubDate")),
                url=url,
                description=text(r.findtext("description"), 450),
            )
        )
    return finished(
        out,
        len(rows),
        ["Headlines are publisher reports; no automated geolocation or verification is asserted."],
    )


def cisa(d):
    rows = records(d, "vulnerabilities")
    rows = sorted(rows, key=lambda r: str(r.get("dateAdded", "")), reverse=True)
    out = []
    for r in rows[:60]:
        if not re.fullmatch(r"CVE-\d{4}-\d{4,}", r.get("cveID", "")):
            continue
        out.append(
            event(
                "cisa",
                r["cveID"],
                "cyber",
                f"{r['cveID']} · {r.get('vulnerabilityName', '')}",
                nature="catalog",
                occurred_at=timestamp(r.get("dateAdded")),
                url=f"https://nvd.nist.gov/vuln/detail/{r['cveID']}",
                description=text(r.get("shortDescription"), 900),
                attributes={
                    k: r.get(k)
                    for k in (
                        "cveID",
                        "vendorProject",
                        "product",
                        "dateAdded",
                        "dueDate",
                        "requiredAction",
                        "knownRansomwareCampaignUse",
                    )
                },
            )
        )
    return finished(
        out,
        len(rows),
        data={"catalog_total": len(rows), "version": d.get("catalogVersion")},
        upstream=timestamp(d.get("dateReleased")),
    )


def aviation(d):
    rows = records(d, "ac")
    now = timestamp(d.get("now"))
    out = []
    if not now:
        raise UpstreamError("schema_drift")
    for r in rows[:400]:
        pos = point(r.get("lat"), r.get("lon"))
        age = number(r.get("seen_pos"))
        if not pos or age is None or not 0 <= age <= 60 or not r.get("hex"):
            continue
        altitude = number(r.get("alt_baro"))
        out.append(
            event(
                "aviation",
                r["hex"],
                "aircraft",
                text(r.get("flight")).strip() or "Public ADS-B aircraft",
                point=pos,
                occurred_at=now - timedelta(seconds=age),
                severity="info",
                url="https://globe.adsb.lol/",
                attributes={
                    "aircraft_type": r.get("t"),
                    "altitude_ft": altitude,
                    "altitude_m": round(altitude * 0.3048) if altitude is not None else None,
                    "speed_knots": number(r.get("gs")),
                    "heading": number(r.get("track")),
                    "position_age_at_fetch_s": age,
                    "receiver_type": r.get("type"),
                    "location_semantics": "Public receiver report; coverage is incomplete",
                },
            )
        )
    # An empty or entirely positionless airspace snapshot is a legitimate empty result.
    return Payload(
        events=out,
        record_count=len(out),
        upstream_time=now,
        warnings=["No position extrapolation. Reception-limited regional view, not all aircraft."],
    )


def cameras(d):
    if not isinstance(d, list):
        raise UpstreamError("schema_drift")
    out = []
    for r in d[:1500]:
        pos = point(r.get("lat"), r.get("lon"))
        code = str(r.get("id", "")).replace("JamCams_", "")
        props = {
            p.get("key"): p.get("value") for p in r.get("additionalProperties", []) if isinstance(p, dict)
        }
        if not pos or not re.fullmatch(r"[A-Za-z0-9_.-]{1,60}", code):
            continue
        out.append(
            event(
                "tfl",
                code,
                "camera",
                r.get("commonName", "Public traffic camera"),
                point=pos,
                nature="catalog",
                severity="info",
                url="https://www.tfl.gov.uk/traffic/status/",
                attributes={
                    "camera_code": code,
                    "operator_available": props.get("available") == "true",
                    "snapshot_url": f"/api/v1/cameras/{code}/snapshot",
                    "capture_time": None,
                    "location_semantics": "Public operator camera site. Catalog availability is not a current stream health check.",
                },
            )
        )
    return finished(
        out,
        len(d),
        ["Public TfL catalog; snapshot capture time is unknown. No people identification or analytics."],
    )


SOIL_LIMITS = {
    "phh2o": (0, 14),
    "soc": (0, 1000),
    "nitrogen": (0, 100),
    "clay": (0, 100),
    "sand": (0, 100),
    "silt": (0, 100),
    "bdod": (0, 3),
    "cec": (0, 300),
    "cfvo": (0, 100),
}


def soil(d):
    layers = records(d.get("properties", {}) if isinstance(d, dict) else {}, "layers")
    out = {}
    count = 0
    warnings = []
    for l in layers:
        name = l.get("name")
        if name not in SOIL_LIMITS:
            continue
        factor = number(l.get("unit_measure", {}).get("d_factor"))
        if not factor or factor <= 0:
            raise UpstreamError("soil_unit_conversion_missing")
        depths = []
        for row in l.get("depths", []):
            label = row.get("label")
            if label not in {"0-5cm", "5-15cm", "15-30cm"}:
                continue
            values = {}
            for upstream, key in [("mean", "mean"), ("Q0.05", "q05"), ("Q0.95", "q95")]:
                raw = number(row.get("values", {}).get(upstream))
                v = raw / factor if raw is not None else None
                if v is not None and not SOIL_LIMITS[name][0] <= v <= SOIL_LIMITS[name][1]:
                    warnings.append(f"Out-of-range {name}/{label}/{key} rejected")
                    v = None
                values[key] = round(v, 4) if v is not None else None
            if values["q05"] is not None and values["q95"] is not None and values["q05"] > values["q95"]:
                warnings.append(f"Inverted interval {name}/{label} rejected")
                values["q05"] = values["q95"] = None
            if values["mean"] is not None:
                count += 1
            depths.append({"depth": label, **values})
        out[name] = {
            "unit": l.get("unit_measure", {}).get("target_units"),
            "d_factor": factor,
            "depths": depths,
        }
    if not out:
        raise UpstreamError("schema_drift")
    if not count:
        warnings.append(
            "The queried cell has no modeled soil values (common for urban areas/water). No fallback values were invented."
        )
    return Payload(
        data={
            "properties": out,
            "resolution_m": 250,
            "model": "SoilGrids 2.0",
            "reference_period": "Static model; not a real-time soil measurement",
            "query_geometry": d.get("geometry"),
        },
        record_count=count,
        warnings=warnings,
    )
