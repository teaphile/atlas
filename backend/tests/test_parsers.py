import pytest
from atlas_app import parsers as p
from atlas_app.transport import UpstreamError
from defusedxml.common import EntitiesForbidden
from shapely.geometry import Point as SPoint
from shapely.geometry import shape


@pytest.mark.parametrize(
    "raw,expected",
    [
        (0, 0),
        (False, None),
        (None, None),
        ("4.5", 4.5),
        ("bad", None),
        (float("nan"), None),
        (float("inf"), None),
        ("-1", -1),
    ],
)
def test_finite_numbers(raw, expected):
    assert p.number(raw) == expected


@pytest.mark.parametrize(
    "raw", [1791610407, 1791610407000, "2026-10-10T05:33:27Z", "Sat, 10 Oct 2026 05:33:27 GMT"]
)
def test_timestamp_formats_have_utc(raw):
    dt = p.timestamp(raw)
    assert dt.year == 2026 and dt.month == 10 and dt.utcoffset().total_seconds() == 0


@pytest.mark.parametrize("lat,lon", [(91, 0), (0, 181), (float("nan"), 10), (10, "bad")])
def test_bad_positions_are_not_zeroed(lat, lon):
    assert p.point(lat, lon) is None


def test_usgs_identity_time_and_units():
    d = {
        "metadata": {"generated": 1791610407000},
        "features": [
            {
                "id": "fixture",
                "properties": {
                    "mag": 6.1,
                    "time": 1791610407000,
                    "place": "Test location",
                    "url": "https://earthquake.usgs.gov/test",
                },
                "geometry": {"coordinates": [78.15, 27.1, 16.5]},
            }
        ],
    }
    out = p.usgs(d)
    e = out.events[0]
    assert e.id == "usgs:fixture" and e.attributes["depth_km"] == 16.5
    assert e.point.lon == 78.15 and e.severity == "high" and e.nature == "observation"


def test_valid_empty_usgs_not_outage():
    assert p.usgs({"features": []}).record_count == 0


def test_schema_drift_is_not_empty_success():
    with pytest.raises(UpstreamError, match="schema_drift"):
        p.usgs({"items": []})


def test_source_links_cannot_be_javascript():
    e = p.event("test", "id", "news", "Title", url="javascript:alert(1)")
    assert e.url == ""


def test_soil_conversion_and_nulls():
    def layer(name, factor, value):
        return {
            "name": name,
            "unit_measure": {"d_factor": factor, "target_units": "fixture"},
            "depths": [{"label": "0-5cm", "values": {"mean": value, "Q0.05": None, "Q0.95": None}}],
        }

    d = {
        "properties": {
            "layers": [
                layer("phh2o", 10, 83),
                layer("nitrogen", 100, 133),
                layer("soc", 10, 90),
                layer("bdod", 100, 138),
                layer("clay", 10, None),
            ]
        }
    }
    out = p.soil(d)
    v = out.data["properties"]
    assert v["phh2o"]["depths"][0]["mean"] == 8.3
    assert v["nitrogen"]["depths"][0]["mean"] == 1.33
    assert v["soc"]["depths"][0]["mean"] == 9
    assert v["bdod"]["depths"][0]["mean"] == 1.38
    assert v["clay"]["depths"][0]["mean"] is None and out.record_count == 4


def test_soil_requires_metadata_unit_factor():
    with pytest.raises(UpstreamError, match="soil_unit_conversion_missing"):
        p.soil({"properties": {"layers": [{"name": "soc", "depths": []}]}})


def test_no_soil_cell_preserves_unknown():
    r = p.soil(
        {
            "properties": {
                "layers": [
                    {
                        "name": "phh2o",
                        "unit_measure": {"d_factor": 10},
                        "depths": [{"label": "0-5cm", "values": {"mean": None}}],
                    }
                ]
            }
        }
    )
    assert r.record_count == 0 and r.data["properties"]["phh2o"]["depths"][0]["mean"] is None
    assert "No fallback values" in r.warnings[0]


def test_inverted_soil_interval_is_rejected():
    r = p.soil(
        {
            "properties": {
                "layers": [
                    {
                        "name": "phh2o",
                        "unit_measure": {"d_factor": 10},
                        "depths": [{"label": "0-5cm", "values": {"mean": 70, "Q0.05": 90, "Q0.95": 40}}],
                    }
                ]
            }
        }
    )
    assert r.data["properties"]["phh2o"]["depths"][0]["q05"] is None and r.warnings


def test_firms_deduplicates_exact_identity_not_nearby_points():
    csv = "latitude,longitude,acq_date,acq_time,satellite,frp,confidence\n27.1,78.15,2026-10-10,0030,N20,12,nominal\n27.1,78.15,2026-10-10,0030,N20,12,nominal\n27.1001,78.15,2026-10-10,0030,N20,12,nominal\n"
    r = p.firms(csv)
    assert len(r.events) == 2 and r.events[0].occurred_at.hour == 0
    assert "not confirmed wildfires" in r.warnings[0]


def test_invalid_firms_message_does_not_become_healthy_empty():
    with pytest.raises(UpstreamError):
        p.firms("Invalid MAP_KEY")


def test_kp_accepts_both_provider_schema_variants():
    one = p.kp([["time_tag", "Kp"], ["2026-10-10T00:00:00", "3.33"]])
    two = p.kp([{"time_tag": "2026-10-10T00:00:00", "Kp": 3.33}])
    assert one.data == two.data and one.upstream_time is not None


def test_nws_null_geometry_stays_unlocated():
    r = p.nws(
        {
            "features": [
                {
                    "id": "https://api.weather.gov/fixture",
                    "geometry": None,
                    "properties": {
                        "event": "Test advisory",
                        "severity": "Unknown",
                        "sent": "2026-10-10T00:00:00Z",
                    },
                }
            ]
        }
    )
    assert r.events[0].point is None and r.events[0].severity == "unknown"


def test_nws_representative_point_within_official_polygon():
    g = {"type": "Polygon", "coordinates": [[[0, 0], [5, 0], [5, 1], [1, 1], [1, 5], [0, 5], [0, 0]]]}
    r = p.nws(
        {
            "features": [
                {"id": "https://api.weather.gov/fixture", "geometry": g, "properties": {"event": "Test"}}
            ]
        }
    )
    q = r.events[0].point
    assert shape(g).covers(SPoint(q.lon, q.lat))


def test_xml_entity_expansion_blocked():
    with pytest.raises(EntitiesForbidden):
        p.gdacs(
            '<!DOCTYPE rss [<!ENTITY a "boom">]><rss><channel><item><title>&a;</title></item></channel></rss>'
        )


def test_aviation_filters_stale_and_missing_positions():
    r = p.aviation(
        {
            "now": 1791610407000,
            "ac": [
                {"hex": "one", "lat": 27, "lon": 78, "seen_pos": 0, "alt_baro": 0},
                {"hex": "old", "lat": 27, "lon": 78, "seen_pos": 61},
                {"hex": "none", "seen_pos": 2},
            ],
        }
    )
    assert len(r.events) == 1 and r.events[0].attributes["altitude_m"] == 0


def test_rss_strips_markup_and_keeps_publication_time():
    out = p.rss(
        "<rss><channel><item><title>&lt;b&gt;A headline&lt;/b&gt;</title><link>https://example.org/story</link><pubDate>Sat, 10 Oct 2026 00:00:00 GMT</pubDate></item></channel></rss>"
    )
    assert (
        "<b>" not in out.events[0].title
        and out.events[0].point is None
        and out.events[0].occurred_at is not None
    )


def test_unclosed_html_like_text_has_linear_bounded_processing():
    from atlas_app.parsers import text

    assert len(text("<" * 1_000_000, limit=80)) == 80
