# Attribution, licensing and origin

ATLAS is an original integration, not an official release, endorsement, or literal source-tree merge of either upstream project.

## Reviewed project influences (not vendored source)

- **TerraWatch AI**, MIT, copyright 2026 TerraWatch AI. Reviewed revision `1f91f9eb521659051ee39fce6a5067ac8b9aec05`: https://huggingface.co/spaces/teaphile/terrawatch
- **OSIRIS**, MIT, copyright 2026 simplifaisoul. Reviewed revision `83b8cd1be24d0d6134c0c1f775625330fcb87996`: https://github.com/simplifaisoul/osiris

No repository was cloned. Neither upstream source tree, dataset, generated camera catalog, model weights nor git history is in this distribution. `docs/audit-manifest.json` contains review metadata and hashes, not source bodies.

## Bundled geographic/design assets

- **Natural Earth**: simplified 177-country boundary asset, public domain. https://www.naturalearthdata.com/about/terms-of-use/ . This is a small schematic fallback, not an official boundary determination. A public geographic asset is distinct from either reviewed project's datasets.
- **OpenFreeMap Dark style**: retrieved from https://tiles.openfreemap.org/styles/dark . Adapted by ATLAS to same-origin bounded vector/glyph endpoints, English-first labels, omitted POI icons, and blue ocean colors. OpenFreeMap infrastructure is ©2023 Zsolt Ero, MIT; included upstream license/distribution notices in `docs/licenses/openfreemap-styles.md` and `/licenses/openfreemap-styles.md` in the built site. OpenMapTiles schema/design and style ancestry have additional BSD/CC-BY notices; see also `docs/licenses/positron-style.md`.
- **Map attribution**: OpenFreeMap · © OpenMapTiles · © OpenStreetMap contributors. OSM data is ODbL, not ATLAS MIT. https://www.openstreetmap.org/copyright . The upstream notices and required map attribution are retained. The service's no-key public instance is not an SLA.
- **NASA GIBS/MODIS imagery**: attribution retained on the satellite layer; imagery is fetched on demand, not bundled as a dataset. https://www.earthdata.nasa.gov/engage/open-data-services-and-software/earthdata-developer-portal/gibs-api
- **Noto Sans map glyphs**: provider-served, SIL Open Font License 1.1; see OpenFreeMap notices. No rasterized Open Sans fallback block is retained.

## Application libraries and fonts

React (MIT), MapLibre GL JS (BSD-3-Clause), Lucide (ISC), Inter (SIL OFL 1.1), IBM Plex Mono (SIL OFL 1.1), FastAPI (MIT), Uvicorn (BSD-3-Clause), HTTPX (BSD-3-Clause), Pydantic (MIT), defusedxml (PSF), and Shapely (BSD-3-Clause). Binary wheels may bundle GEOS under its own LGPL terms. Preserve dependency licenses when redistributing compiled images. Dependency packages retain their own license files; additional frontend distribution notices are in `docs/licenses/frontend-libraries.txt` and `/licenses/frontend-libraries.txt`.

## API data

Provider data is not relicensed by this project's MIT license. BBC articles remain publisher content: the app displays feed excerpts/headlines and links, not full-article mirrors. GBIF records have dataset-specific licenses. Open-Meteo data attribution and non-commercial free-hosting terms both apply. NASA, NOAA, USGS, TfL, GeoNames, World Bank and other sources retain their own notices. Read `docs/API_GUIDE.md` and the runtime source catalog before redistribution or commercial deployment.

The provider license file enumerates older style families but does not separately enumerate the newer Dark style. This distribution preserves the full provider/ancestral notices and attribution rather than asserting that all style material is MIT. Verify current style provenance/requirements with the provider before a commercial redistribution.
