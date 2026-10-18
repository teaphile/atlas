from datetime import timedelta

import pytest
from atlas_app.geo import aoi_area_km2, filter_events, haversine, in_aoi, polygon_aoi, proximity_groups
from atlas_app.schemas import utcnow


def test_haversine_antimeridian():
    assert haversine(0, 179.9, 0, -179.9) == pytest.approx(22.239, abs=0.01)


def test_haversine_coincident_and_antipodal():
    assert haversine(27, 78, 27, 78) == 0
    assert haversine(0, 0, 0, 180) == pytest.approx(20015.114, abs=0.01)


def test_aoi_dateline_not_greenwich(make_event):
    p, a = polygon_aoi(
        {"type": "Polygon", "coordinates": [[[170, -10], [-170, -10], [-170, 10], [170, 10], [170, -10]]]}
    )
    assert in_aoi(make_event(lon=175, lat=0), p, a)
    assert in_aoi(make_event(lon=-175, lat=0), p, a)
    assert not in_aoi(make_event(lon=0, lat=0), p, a)


def test_aoi_hole_and_boundary(make_event):
    p, a = polygon_aoi(
        {
            "type": "Polygon",
            "coordinates": [
                [[0, 0], [5, 0], [5, 5], [0, 5], [0, 0]],
                [[1, 1], [2, 1], [2, 2], [1, 2], [1, 1]],
            ],
        }
    )
    assert not in_aoi(make_event(lat=1.5, lon=1.5), p, a)
    assert in_aoi(make_event(lat=0, lon=2), p, a)


@pytest.mark.parametrize(
    "g",
    [
        {"type": "LineString", "coordinates": []},
        {"type": "Polygon", "coordinates": [[[0, 0], [1, 1], [0, 1], [1, 0], [0, 0]]]},
        {"type": "Polygon", "coordinates": [[[0, 0], [2, 0], [2, 1], [0, 1]]]},
        {"type": "Polygon", "coordinates": [[[0, 0], [2, 0], [2, 91], [0, 0]]]},
        {"type": "Polygon", "coordinates": [[[0, 0], [2, 0], [2, float("nan")], [0, 0]]]},
    ],
)
def test_invalid_aoi_rejected(g):
    with pytest.raises(ValueError):
        polygon_aoi(g)


def test_area_is_spherical_and_hole_subtracted():
    p, _ = polygon_aoi({"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]})
    assert 12000 < aoi_area_km2(p) < 12500


def test_proximity_across_dateline(make_event):
    out = proximity_groups([make_event("a", 0, 179.9), make_event("b", 0, -179.9, source="gdacs")])
    assert out["groups"][0]["record_count"] == 2 and len(out["groups"][0]["source_ids"]) == 2


def test_proximity_handles_poles(make_event):
    out = proximity_groups([make_event("a", 89.9, 0), make_event("b", 89.9, 179.9)])
    assert out["groups"][0]["record_count"] == 2


def test_proximity_does_not_join_different_hazards(make_event):
    assert not proximity_groups([make_event("a", kind="fire"), make_event("b", kind="earthquake")])["groups"]


def test_proximity_has_dense_work_budget(make_event):
    out = proximity_groups([make_event(str(i)) for i in range(200)], max_comparisons=25)
    assert out["budget_exhausted"] and out["comparisons"] == 25


def test_expired_warnings_removed(make_event):
    old = make_event(expires_at=utcnow() - timedelta(seconds=1))
    assert filter_events([old]) == []


def test_active_warning_survives_old_onset(make_event):
    e = make_event(at=utcnow() - timedelta(days=10), expires_at=utcnow() + timedelta(hours=3))
    assert filter_events([e], hours=24) == [e]


def test_old_catalog_is_reference_not_event_window(make_event):
    e = make_event(at=utcnow() - timedelta(days=100), kind="cyber", nature="catalog")
    assert filter_events([e], hours=24) == [e]


def test_unknown_location_not_inside_bbox(make_event):
    e = make_event()
    e.point = None
    assert not filter_events([e], bbox=[-180, -90, 180, 90])
