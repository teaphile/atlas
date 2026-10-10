import pytest
from atlas_app.providers import Providers
from atlas_app.config import Settings
from atlas_app.transport import UpstreamError


class SplitGateway:
    def __init__(self, means, quantiles):
        self.means = means
        self.quantiles = quantiles

    async def json(self, url, params):
        value = self.quantiles if ("value", "Q0.05") in params else self.means
        if isinstance(value, Exception):
            raise value
        return value


def profile(surface=False, mean=80):
    return {
        "properties": {
            "layers": [
                {
                    "name": "phh2o",
                    "unit_measure": {"d_factor": 10},
                    "depths": [
                        {
                            "label": depth,
                            "values": {
                                "mean": mean,
                                "Q0.05": 60 if surface else None,
                                "Q0.95": 100 if surface else None,
                            },
                        }
                        for depth in (["0-5cm"] if surface else ["0-5cm", "5-15cm", "15-30cm"])
                    ],
                }
            ]
        }
    }


@pytest.mark.parametrize("failure", [{}, UpstreamError("test_outage")])
async def test_surface_preserved_when_means_fail(failure):
    p = Providers(SplitGateway(failure, profile(True)), Settings(_env_file=None))
    r = await p.fetch("soil", lat=27, lon=78)
    assert r.record_count == 1 and r.data["properties"]["phh2o"]["depths"][0]["q05"] == 6
    assert any("Partial soil" in w for w in r.warnings)


@pytest.mark.parametrize("failure", [{}, UpstreamError("test_outage")])
async def test_means_preserved_when_quantiles_fail(failure):
    p = Providers(SplitGateway(profile(), failure), Settings(_env_file=None))
    r = await p.fetch("soil", lat=27, lon=78)
    assert r.record_count == 3 and r.data["properties"]["phh2o"]["depths"][0]["q05"] is None


async def test_soil_split_merge_no_deeper_interval_fabrication():
    p = Providers(SplitGateway(profile(), profile(True)), Settings(_env_file=None))
    r = await p.fetch("soil", lat=27, lon=78)
    d = r.data["properties"]["phh2o"]["depths"]
    assert len(d) == 3 and d[0]["q05"] == 6 and d[1]["q05"] is None and d[2]["q95"] is None


async def test_mismatched_surface_means_do_not_get_paired_quantiles():
    p = Providers(SplitGateway(profile(), profile(True, 70)), Settings(_env_file=None))
    r = await p.fetch("soil", lat=27, lon=78)
    assert r.data["properties"]["phh2o"]["depths"][0]["q05"] is None
    assert any("differed" in w for w in r.warnings)


async def test_both_profiles_fail_is_unavailable_not_empty():
    p = Providers(SplitGateway({}, {}), Settings(_env_file=None))
    with pytest.raises(UpstreamError, match="soil_profile_unavailable"):
        await p.fetch("soil", lat=27, lon=78)
