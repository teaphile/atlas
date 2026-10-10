from __future__ import annotations
from datetime import timedelta
import hashlib, re
from . import parsers as P
from .schemas import Payload, utcnow
from .transport import HttpGateway, UpstreamError
from .config import Settings


class Providers:
    def __init__(self, http: HttpGateway, config: Settings):
        self.http = http
        self.config = config

    async def fetch(
        self,
        id: str,
        lat: float | None = None,
        lon: float | None = None,
        country: str = "IN",
        query: str = "",
    ) -> Payload:
        h = self.http
        if id == "usgs":
            return P.usgs(
                await h.json("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson")
            )
        if id == "eonet":
            return P.eonet(
                await h.json(
                    "https://eonet.gsfc.nasa.gov/api/v3/events", {"status": "open", "days": 30, "limit": 150}
                )
            )
        if id == "gdacs":
            return P.gdacs(await h.text("https://www.gdacs.org/xml/rss.xml"))
        if id == "nws":
            return P.nws(
                await h.json(
                    "https://api.weather.gov/alerts/active", {"status": "actual", "message_type": "alert"}
                )
            )
        if id == "firms":
            return P.firms(
                await h.text(
                    "https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_South_Asia_24h.csv"
                )
            )
        if id == "space_kp":
            return P.kp(await h.json("https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json"))
        if id == "space_alerts":
            return P.space_alerts(await h.json("https://services.swpc.noaa.gov/products/alerts.json"))
        if id == "iss":
            return P.iss(await h.json("https://api.wheretheiss.at/v1/satellites/25544"))
        if id == "news":
            return P.rss(await h.text("https://feeds.bbci.co.uk/news/world/rss.xml"))
        if id == "cisa":
            return P.cisa(
                await h.json(
                    "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json"
                )
            )
        if id == "tfl":
            return P.cameras(await h.json("https://api.tfl.gov.uk/Place/Type/JamCam"))
        if id == "gdelt":
            d = await h.json(
                "https://api.gdeltproject.org/api/v2/doc/doc",
                {
                    "query": "(flood OR earthquake OR wildfire)",
                    "mode": "artlist",
                    "format": "json",
                    "maxrecords": 20,
                    "timespan": "24h",
                    "sort": "datedesc",
                },
            )
            rows = P.records(d, "articles")
            out = []
            for r in rows:
                url = r.get("url", "")
                t = r.get("seendate", "")
                try:
                    t = utcnow().strptime(t, "%Y%m%dT%H%M%SZ").replace(tzinfo=utcnow().tzinfo)
                except (ValueError, TypeError):
                    t = None
                out.append(
                    P.event(
                        "gdelt",
                        hashlib.sha256(url.encode()).hexdigest()[:20],
                        "news",
                        r.get("title", "Headline"),
                        nature="news",
                        url=url,
                        occurred_at=t,
                        attributes={"publisher": r.get("domain"), "language": r.get("language")},
                    )
                )
            return P.finished(
                out, len(rows), ["Seen-date is GDELT discovery time, not necessarily publication time."]
            )
        if id == "geocoding":
            d = await h.json(
                "https://geocoding-api.open-meteo.com/v1/search",
                {"name": query, "count": 6, "language": "en", "format": "json"},
            )
            if not isinstance(d, dict) or "generationtime_ms" not in d:
                raise UpstreamError("schema_drift")
            results = [
                {
                    k: r.get(k)
                    for k in (
                        "id",
                        "name",
                        "latitude",
                        "longitude",
                        "country",
                        "country_code",
                        "admin1",
                        "timezone",
                    )
                }
                for r in d.get("results", [])
            ]
            return Payload(data={"results": results}, record_count=len(results))
        if id == "worldbank":
            if not re.fullmatch("[A-Z]{2,3}", country):
                raise UpstreamError("invalid_country")
            d = await h.json(
                f"https://api.worldbank.org/v2/country/{country}/indicator/SP.POP.TOTL",
                {"format": "json", "mrnev": 1},
            )
            if not isinstance(d, list) or len(d) < 2 or not isinstance(d[1], list):
                raise UpstreamError("schema_drift")
            return Payload(
                data={"indicators": d[1]},
                record_count=len(d[1]),
                warnings=["Country-scale annual estimate; do not use it as local population exposure."],
            )
        if lat is None or lon is None:
            raise UpstreamError("location_required")
        params = {"latitude": lat, "longitude": lon}
        if id == "weather":
            d = await h.json(
                "https://api.open-meteo.com/v1/forecast",
                {
                    **params,
                    "current": "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,wind_speed_10m,wind_gusts_10m,weather_code",
                    "hourly": "temperature_2m,relative_humidity_2m,precipitation,precipitation_probability,wind_speed_10m,soil_moisture_0_to_1cm,soil_moisture_1_to_3cm,soil_moisture_3_to_9cm,soil_moisture_9_to_27cm,soil_moisture_27_to_81cm",
                    "daily": "temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max",
                    "past_days": 1,
                    "forecast_days": 3,
                    "timezone": "UTC",
                    "temperature_unit": "celsius",
                    "wind_speed_unit": "kmh",
                    "precipitation_unit": "mm",
                },
            )
            if (
                not isinstance(d, dict)
                or not P.timestamp(d.get("current", {}).get("time"))
                or not isinstance(d.get("hourly", {}).get("time"), list)
            ):
                raise UpstreamError("schema_drift")
            return Payload(
                data=d,
                record_count=len(d["hourly"]["time"]),
                upstream_time=P.timestamp(d["current"]["time"]),
                warnings=["Weather and soil moisture are numerical model values, not in-situ observations."],
            )
        if id == "air_quality":
            d = await h.json(
                "https://air-quality-api.open-meteo.com/v1/air-quality",
                {
                    **params,
                    "current": "us_aqi,pm2_5,pm10,ozone,nitrogen_dioxide",
                    "hourly": "us_aqi,pm2_5",
                    "forecast_days": 2,
                    "timezone": "UTC",
                },
            )
            if not isinstance(d, dict) or not P.timestamp(d.get("current", {}).get("time")):
                raise UpstreamError("schema_drift")
            return Payload(
                data=d,
                record_count=1,
                upstream_time=P.timestamp(d["current"]["time"]),
                warnings=["CAMS model grid; US AQI scale, not India NAQI or a monitoring-station reading."],
            )
        if id == "flood":
            d = await h.json(
                "https://flood-api.open-meteo.com/v1/flood",
                {**params, "daily": "river_discharge", "forecast_days": 7},
            )
            if not isinstance(d, dict) or not isinstance(d.get("daily", {}).get("river_discharge"), list):
                raise UpstreamError("schema_drift")
            return Payload(
                data=d,
                record_count=sum(P.number(x) is not None for x in d["daily"]["river_discharge"]),
                warnings=[
                    "Modeled river discharge at nearest grid cell. Flood probability/depth/return period cannot be inferred without calibrated local hydrology."
                ],
            )
        if id == "elevation":
            d = await h.json("https://api.open-meteo.com/v1/elevation", params)
            if not isinstance(d, dict) or not isinstance(d.get("elevation"), list) or not d["elevation"]:
                raise UpstreamError("schema_drift")
            value = P.number(d["elevation"][0])
            return Payload(data={"elevation_m": value}, record_count=int(value is not None))
        if id == "soil":
            import asyncio

            base = [("lat", lat), ("lon", lon)] + [("property", x) for x in P.SOIL_LIMITS]
            means = base + [("depth", x) for x in ("0-5cm", "5-15cm", "15-30cm")] + [("value", "mean")]
            quantiles = base + [("depth", "0-5cm")] + [("value", x) for x in ("mean", "Q0.05", "Q0.95")]
            # Two bounded requests, sharing host throttling. Deeper intervals are not invented.
            results = await asyncio.gather(
                h.json("https://rest.isric.org/soilgrids/v2.0/properties/query", means),
                h.json("https://rest.isric.org/soilgrids/v2.0/properties/query", quantiles),
                return_exceptions=True,
            )
            good = []
            for result in results:
                if isinstance(result, Exception):
                    continue
                try:
                    good.append(P.soil(result))
                except (UpstreamError, ValueError, TypeError, KeyError):
                    continue
            if not good:
                raise UpstreamError("soil_profile_unavailable")
            parsed = good[0]
            if len(good) > 1:
                top = good[1]
                parsed.warnings.extend(w for w in top.warnings if w not in parsed.warnings)
                for name, prop in top.data["properties"].items():
                    existing = parsed.data["properties"].get(name)
                    if existing is None:
                        parsed.data["properties"][name] = prop
                        continue
                    for surface in prop["depths"]:
                        depth = next((d for d in existing["depths"] if d["depth"] == surface["depth"]), None)
                        if depth is None:
                            existing["depths"].append(surface)
                        elif depth["mean"] == surface["mean"]:
                            depth["q05"] = surface["q05"]
                            depth["q95"] = surface["q95"]
                        else:
                            parsed.warnings.append(
                                "A surface mean differed between the two queries; mismatched prediction intervals were not combined."
                            )
                parsed.record_count = sum(
                    d["mean"] is not None
                    for prop in parsed.data["properties"].values()
                    for d in prop["depths"]
                )
            parsed.warnings.append(
                "5th/95th prediction quantiles are requested for 0–5 cm only. Deeper horizons show means; missing uncertainty is not interpolated."
            )
            if len(good) < 2:
                parsed.warnings.append(
                    "Partial soil response: one bounded profile request failed. Available values are preserved without filling gaps."
                )
            return parsed
        if id == "aviation":
            return P.aviation(await h.json(f"https://api.adsb.lol/v2/lat/{lat:.4f}/lon/{lon:.4f}/dist/150"))
        if id == "nasa_power":
            end = utcnow().date() - timedelta(days=10)
            start = end - timedelta(days=6)
            d = await h.json(
                "https://power.larc.nasa.gov/api/temporal/daily/point",
                {
                    "parameters": "ALLSKY_SFC_SW_DWN,T2M,PRECTOTCORR",
                    "community": "AG",
                    "longitude": lon,
                    "latitude": lat,
                    "start": start.strftime("%Y%m%d"),
                    "end": end.strftime("%Y%m%d"),
                    "format": "JSON",
                },
            )
            if not isinstance(d, dict) or not isinstance(d.get("properties", {}).get("parameter"), dict):
                raise UpstreamError("schema_drift")
            fill = P.number(d.get("header", {}).get("fill_value"))
            for series in d["properties"]["parameter"].values():
                for k, v in series.items():
                    if P.number(v) is None or v in (-999, -9999, fill):
                        series[k] = None
            return Payload(
                data={k: d.get(k) for k in ("geometry", "properties", "header", "parameters")},
                record_count=7,
                warnings=["Delayed historical model context. Missing-value sentinels are converted to null."],
            )
        if id == "gbif":
            d = await h.json(
                "https://api.gbif.org/v1/occurrence/search",
                {
                    "decimalLatitude": f"{max(-90, lat - 0.2)},{min(90, lat + 0.2)}",
                    "decimalLongitude": f"{max(-180, lon - 0.2)},{min(180, lon + 0.2)}",
                    "limit": 30,
                    "hasCoordinate": "true",
                },
            )
            rows = P.records(d, "results")
            records = []
            for r in rows:
                # Suppress personal observer names and precise coordinates of potentially sensitive species.
                records.append(
                    {
                        k: r.get(k)
                        for k in (
                            "key",
                            "scientificName",
                            "vernacularName",
                            "kingdom",
                            "eventDate",
                            "basisOfRecord",
                            "license",
                            "datasetKey",
                            "occurrenceStatus",
                        )
                    }
                )
            return Payload(
                data={"records": records, "total_matching_records": d.get("count"), "bbox_degrees": 0.4},
                record_count=len(records),
                warnings=[
                    "Historical occurrence sample, not species abundance. No personal observer information or exact species positions are exposed."
                ],
            )
        if id == "firms_area":
            if not self.config.firms_map_key:
                raise UpstreamError("credentials_required")
            bbox = f"{max(-180, lon - 2):.3f},{max(-90, lat - 2):.3f},{min(180, lon + 2):.3f},{min(90, lat + 2):.3f}"
            return P.firms(
                await h.text(
                    f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/{self.config.firms_map_key}/VIIRS_NOAA20_NRT/{bbox}/1"
                ),
                source="firms_area",
            )
        raise UpstreamError("unknown_source")
