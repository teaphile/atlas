import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  FileText,
  Leaf,
  Waves,
  FlaskConical,
  ShieldCheck,
  CloudSun,
  Download,
  Activity,
  Flame,
  Database,
  Sun,
  MapPin,
  Info,
  Check,
  ArrowRight,
  Layers3,
} from "lucide-react";
import type { Envelope, Fusion, LocationData, Place, Snapshot } from "../types";
import { api, isAbort } from "../api";
import { num, dateLabel, download, ago } from "../utils";
import { ExternalLink, Note, Sparkline, Spinner, Status } from "./UI";
export type IntelligenceTab =
  "brief" | "soil" | "water" | "ecosystem" | "scenario" | "cyber";
const TABS: [IntelligenceTab, string, typeof FileText][] = [
  ["brief", "Evidence brief", FileText],
  ["soil", "Soil profile", Layers3],
  ["water", "Weather & water", Waves],
  ["ecosystem", "Environmental context", Leaf],
  ["scenario", "Scenario lab", FlaskConical],
  ["cyber", "Cyber advisories", ShieldCheck],
];
export function Intelligence({
  tab,
  onTab,
  snapshot,
  location,
  place,
  onLocation,
  onSource,
  onMessage,
}: {
  tab: IntelligenceTab;
  onTab: (t: IntelligenceTab) => void;
  snapshot: Snapshot | null;
  location: LocationData | null;
  place: Place;
  onLocation: () => void;
  onSource: (id: string) => void;
  onMessage: (s: string) => void;
}) {
  const [depth, setDepth] = useState("0-5cm");
  const [fusion, setFusion] = useState<Fusion | null>(null);
  const [fusionLoading, setFusionLoading] = useState(false);
  const [contexts, setContexts] = useState<Record<string, Envelope>>({});
  const [contextLoading, setContextLoading] = useState("");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function loadContext(id: string) {
    if (id === "worldbank" && !place.countryCode) {
      onMessage(
        "Search a named place first so the country is explicit. No country is inferred from coordinates.",
      );
      return;
    }
    setContextLoading(id);
    try {
      const d = await api<Envelope>(
        `/api/v1/sources/${id}?lat=${place.lat}&lon=${place.lon}&country=${place.countryCode || "IN"}`,
      );
      if (mounted.current) setContexts((c) => ({ ...c, [id]: d }));
    } catch (e) {
      if (!isAbort(e))
        onMessage(
          "Context source could not be reached. No substitute data was created.",
        );
    } finally {
      if (mounted.current) setContextLoading("");
    }
  }
  async function loadFusion() {
    setFusionLoading(true);
    try {
      const r = await api<Fusion>("/api/v1/fusion?hours=72");
      if (mounted.current) setFusion(r);
    } catch {
      onMessage("Could not compute proximity groups.");
    } finally {
      if (mounted.current) setFusionLoading(false);
    }
  }
  const soil = location?.sources.soil;
  const props = soil?.payload.data.properties ?? {};
  const get = (id: string) =>
    props[id]?.depths?.find((r: { depth: string }) => r.depth === depth);
  const w = location?.sources.weather?.payload.data;
  const discharge = location?.sources.flood?.payload.data;
  const forecast = w?.daily;
  const usgs = snapshot?.events.filter((e) => e.source_id === "usgs") ?? [];
  const maximum = usgs.length
    ? Math.max(...usgs.map((e) => e.attributes.magnitude ?? 0))
    : null;
  const cyber = snapshot?.events.filter((e) => e.kind === "cyber") ?? [];
  const news = snapshot?.events.filter((e) => e.kind === "news") ?? [];
  return (
    <main className="workspace-page intelligence-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            <i className="live-dot" />
            CONNECTED INTELLIGENCE
          </div>
          <h1>Go beyond the map.</h1>
          <p>
            Understand the environment. Inspect the evidence. Keep the
            uncertainty.
          </p>
        </div>
        <button
          className="button"
          onClick={() =>
            download(
              "atlas-location-report.json",
              JSON.stringify(
                {
                  place,
                  location,
                  source_attributions: snapshot?.sources,
                  limitations:
                    "Unvalidated environmental screening; not emergency guidance.",
                },
                null,
                2,
              ),
            )
          }
        >
          <Download size={14} />
          Export report
        </button>
      </div>
      <div className="workspace-tabs">
        {TABS.map(([id, label, Icon]) => (
          <button
            className={tab === id ? "active" : ""}
            onClick={() => onTab(id)}
            key={id}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>
      <div className="workspace-content">
        {tab === "brief" && (
          <>
            <div className="brief-hero">
              <div className="brief-orbit">
                <GlobeMark />
              </div>
              <span className="eyebrow">SOURCE-LINKED · NO LLM REQUIRED</span>
              <h2>Your world, with more context.</h2>
              <p>
                A factual brief assembled from the current source snapshot.
                Reports can overlap; counts are not unique disasters.
              </p>
              <div className="brief-stamp">
                <Check size={13} />
                {snapshot
                  ? dateLabel(snapshot.generated_at)
                  : "Awaiting first source snapshot"}
                <span>•</span>Evidence, not predictions
              </div>
            </div>
            <div className="insight-grid three">
              <article className="insight-card">
                <Activity className="amber-text" size={20} />
                <span>USGS catalog</span>
                <strong>{num(usgs.length, 0)}</strong>
                <p>
                  M2.5+ reports in the 7-day feed.
                  <br />
                  Largest catalog magnitude:{" "}
                  <b>{maximum == null ? "—" : "M " + num(maximum)}</b>
                </p>
                <button onClick={() => onSource("usgs")}>
                  Inspect source
                  <ArrowUpRight size={13} />
                </button>
              </article>
              <article className="insight-card">
                <Flame className="orange-text" size={20} />
                <span>South Asia thermal detections</span>
                <strong>
                  {num(
                    snapshot?.events.filter((e) => e.source_id === "firms")
                      .length ?? null,
                    0,
                  )}
                </strong>
                <p>
                  NOAA-20 VIIRS 24-hour product.
                  <br />
                  These are <b>not confirmed wildfires.</b>
                </p>
                <button onClick={() => onSource("firms")}>
                  Inspect detections
                  <ArrowUpRight size={13} />
                </button>
              </article>
              <article className="insight-card">
                <MapPin className="mint-text" size={20} />
                <span>{place.name}</span>
                <strong>
                  {num(location?.screening.score, 0)}
                  <small>/100</small>
                </strong>
                <p>
                  Model-based attention index.
                  <br />
                  {num((location?.screening.coverage ?? 0) * 100, 0)}% of
                  defined signal weights available.
                </p>
                <button onClick={() => onTab("water")}>
                  Inspect inputs
                  <ArrowUpRight size={13} />
                </button>
              </article>
            </div>
            <div className="two-column-content">
              <section className="content-card">
                <div className="content-heading">
                  <div>
                    <span className="eyebrow">SPATIOTEMPORAL ANALYSIS</span>
                    <h3>Related places. Separate evidence.</h3>
                  </div>
                  <Layers3 size={19} />
                </div>
                <p className="muted">
                  Find same-domain reports within 40 km and 6 hours.
                  Earth-centered spatial indexing handles the date line and
                  poles; source identities remain intact.
                </p>
                {fusion ? (
                  <>
                    <div className="fusion-results">
                      {fusion.groups.slice(0, 5).map((g) => (
                        <div key={g.anchor_id}>
                          <span className="fusion-number">
                            {g.record_count}
                          </span>
                          <div>
                            <b>{g.title}</b>
                            <small>
                              {g.source_ids
                                .map((s) => s.toUpperCase())
                                .join(" + ")}
                            </small>
                          </div>
                          <span className="subtle-pill">{g.kind}</span>
                        </div>
                      ))}
                    </div>
                    <Note>
                      {fusion.meaning}
                      {fusion.budget_exhausted
                        ? " Computation budget reached; groups are partial."
                        : ""}
                    </Note>
                  </>
                ) : (
                  <button
                    className="button button-primary"
                    onClick={loadFusion}
                    disabled={fusionLoading}
                  >
                    {fusionLoading ? (
                      <Spinner label="Comparing cached observations…" />
                    ) : (
                      <>
                        <Layers3 size={14} />
                        Find proximity groups
                      </>
                    )}
                  </button>
                )}
              </section>
              <section className="content-card">
                <div className="content-heading">
                  <div>
                    <span className="eyebrow">PUBLISHER CONTEXT</span>
                    <h3>Across the world</h3>
                  </div>
                  <ExternalLink url="https://www.bbc.com/news/world">
                    BBC News
                  </ExternalLink>
                </div>
                <div className="news-list">
                  {news.length ? (
                    news.slice(0, 6).map((e) => (
                      <ExternalLink key={e.id} url={e.url}>
                        <div>
                          <b>{e.title}</b>
                          <small>{ago(e.occurred_at)} · Publisher report</small>
                        </div>
                      </ExternalLink>
                    ))
                  ) : (
                    <p className="empty-state">
                      No news feed is currently available.
                    </p>
                  )}
                </div>
              </section>
            </div>
            <Note>
              Source agreement is not independence. GDACS, EONET and news
              providers can cite the same original observation. No “confidence
              boost” is applied just because a report appears twice.
            </Note>
          </>
        )}
        {tab === "soil" && (
          <>
            <Note tone="warning">
              Regional soil context only. ISRIC advises against local or
              farm-level use of SoilGrids. These predictions and derived stock
              are not a field diagnosis or a calibrated crop recommendation.
            </Note>
            <div className="section-toolbar">
              <div>
                <h2>Under the surface.</h2>
                <p>
                  <button className="text-link" onClick={onLocation}>
                    {place.name}
                    <ArrowUpRight size={12} />
                  </button>{" "}
                  · ISRIC SoilGrids 2.0 · 250 m static model
                </p>
              </div>
              <div className="depth-picker">
                {["0-5cm", "5-15cm", "15-30cm"].map((d) => (
                  <button
                    key={d}
                    onClick={() => setDepth(d)}
                    className={depth === d ? "active" : ""}
                  >
                    {d.replace("-", "–")}
                  </button>
                ))}
              </div>
            </div>
            {soil ? (
              <div className="data-origin-strip">
                <Database size={14} />
                <Status status={soil.status} />
                <span>Fetched {ago(soil.fetched_at)}</span>
                <span>Nature: static model prediction</span>
                <button onClick={() => onSource("soil")}>
                  Full provenance
                  <ArrowUpRight size={12} />
                </button>
              </div>
            ) : (
              <Spinner label="Soil profile is not loaded yet…" />
            )}
            {soil?.status === "refreshing" || soil?.status === "idle" ? (
              <Spinner label="Querying depth profiles and surface uncertainty. This source can take 20–30 seconds…" />
            ) : null}
            {soil?.status === "unavailable" || soil?.status === "empty" ? (
              <Note tone="warning">
                {soil.warnings[0] ||
                  "The soil provider is unavailable. No latitude-based or invented values are substituted."}
              </Note>
            ) : null}
            <div className="soil-properties">
              {[
                ["phh2o", "Soil pH", "pH", "Soil reaction"],
                ["soc", "Organic carbon", "g/kg", "Not carbon potential"],
                ["nitrogen", "Total nitrogen", "g/kg", "Not plant-available N"],
                ["bdod", "Bulk density", "g/cm³", "Fine-earth bulk density"],
                [
                  "cec",
                  "Cation exchange",
                  "cmol(c)/kg",
                  "Nutrient retention proxy",
                ],
                ["cfvo", "Coarse fragments", "% vol", "Volume fraction"],
              ].map(([id, label, unit, note]) => {
                const d = get(id);
                return (
                  <article className="soil-property" key={id}>
                    <span>{label}</span>
                    <strong>
                      {num(d?.mean, 2)}
                      <small>{unit}</small>
                    </strong>
                    <div className="uncertainty-range">
                      {d?.q05 != null && d?.q95 != null ? (
                        <>
                          <span className="range-line" />
                          Q05 {num(d.q05, 2)} — Q95 {num(d.q95, 2)}
                        </>
                      ) : (
                        <span>
                          Uncertainty{" "}
                          {depth === "0-5cm"
                            ? "unavailable"
                            : "not requested at this depth"}
                        </span>
                      )}
                    </div>
                    <small>{note}</small>
                  </article>
                );
              })}
            </div>
            <div className="two-column-content">
              <section className="content-card">
                <span className="eyebrow">PHYSICAL STRUCTURE · {depth}</span>
                <h3>Soil texture fractions</h3>
                <div className="texture-bar">
                  {[
                    ["sand", "#d5b887"],
                    ["silt", "#829b89"],
                    ["clay", "#79bfa6"],
                  ].map(([id, color]) => (
                    <div
                      key={id}
                      style={{
                        width: `${get(id)?.mean ?? 0}%`,
                        background: color,
                      }}
                    />
                  ))}
                </div>
                <div className="texture-legend">
                  {[
                    ["sand", "Sand", "#d5b887"],
                    ["silt", "Silt", "#829b89"],
                    ["clay", "Clay", "#79bfa6"],
                  ].map(([id, label, color]) => (
                    <div key={id}>
                      <i style={{ background: color }} />
                      <span>{label}</span>
                      <strong>{num(get(id)?.mean)}%</strong>
                    </div>
                  ))}
                </div>
                <p className="muted">
                  Fractions are model means. This is not a laboratory
                  particle-size analysis or a validated USDA texture
                  classification.
                </p>
              </section>
              <section className="content-card carbon-card">
                <Leaf size={27} />
                <span className="eyebrow">DERIVED STOCK · 0–30 CM</span>
                <h3>
                  {num(location?.soil_summary.carbon_stock_0_30cm_t_ha, 1)}{" "}
                  <small>t C / ha</small>
                </h3>
                <p>
                  SOC × bulk density × horizon thickness, corrected for coarse
                  fragments. Computed only when all three horizons are present.
                </p>
                <Note>
                  No sequestration potential, future carbon credit or
                  field-level certainty is implied.
                </Note>
              </section>
            </div>
            <section className="content-card">
              <div className="content-heading">
                <div>
                  <span className="eyebrow">
                    AGRONOMIC CONTEXT · SURFACE pH ONLY
                  </span>
                  <h3>A starting point, not a prescription.</h3>
                </div>
                <Leaf size={18} />
              </div>
              <div className="crop-grid">
                {location?.soil_summary.crop_ph_screen.map((c) => (
                  <div key={c.crop}>
                    <b>{c.crop}</b>
                    <span>General pH {c.range.join("–")}</span>
                    <small
                      className={c.distance === 0 ? "mint-text" : "amber-text"}
                    >
                      {c.ph_fit}
                    </small>
                  </div>
                ))}
              </div>
              <Note>
                Soil, season, salinity, irrigation, varieties and laboratory
                tests are still required. No yield claims or fertilizer
                application rates are generated from this model.
              </Note>
            </section>
          </>
        )}
        {tab === "water" && (
          <>
            <div className="section-toolbar">
              <div>
                <h2>A changing environment.</h2>
                <p>
                  {place.name} · Numerical weather, composition and river models
                </p>
              </div>
              <span className="subtle-pill">NOT IN-SITU SENSORS</span>
            </div>
            <div className="two-column-content">
              <section className="content-card">
                <div className="content-heading">
                  <h3>Environmental attention</h3>
                  <Info size={17} />
                </div>
                <div className="big-screening">
                  <strong>{num(location?.screening.score, 0)}</strong>
                  <span>
                    /100
                    <br />
                    {location?.screening.label ?? "Insufficient data"}
                  </span>
                </div>
                <div className="signal-bars">
                  {location?.screening.signals.map((s) => (
                    <div key={s.id}>
                      <span>{s.label}</span>
                      <div>
                        <i style={{ width: `${s.score ?? 0}%` }} />
                      </div>
                      <b>
                        {num(s.value, 1)} <small>{s.unit}</small>
                      </b>
                    </div>
                  ))}
                </div>
                <div className="screening-bounds">
                  <span>
                    Input-weight coverage{" "}
                    <b>{num((location?.screening.coverage ?? 0) * 100, 0)}%</b>
                  </span>
                  <span>
                    Missing-data bounds{" "}
                    <b>
                      {location?.screening.missing_data_bounds
                        .map((x) => num(x))
                        .join(" – ") ?? "—"}
                    </b>
                  </span>
                </div>
                <Note>
                  Unvalidated priority index. Bounds are missing-input
                  sensitivity, not confidence intervals. No landslide,
                  liquefaction, flood probability or “safe” verdict is
                  generated.
                </Note>
              </section>
              <section className="content-card">
                <div className="content-heading">
                  <div>
                    <span className="eyebrow">
                      COPERNICUS GLOFAS / OPEN-METEO
                    </span>
                    <h3>River discharge · 7-day outlook</h3>
                  </div>
                  <Waves size={21} />
                </div>
                <div className="river-value">
                  {num(discharge?.daily?.river_discharge?.[0])}
                  <small>m³/s · modeled first day</small>
                </div>
                <Sparkline
                  values={discharge?.daily?.river_discharge ?? []}
                  height={110}
                  color="#72bbdd"
                />
                <div className="chart-date-labels">
                  <span>{discharge?.daily?.time?.[0] ?? "—"}</span>
                  <span>{discharge?.daily?.time?.at(-1) ?? "—"}</span>
                </div>
                <p className="muted">
                  Model grid: {num(discharge?.latitude, 4)},{" "}
                  {num(discharge?.longitude, 4)}. May differ from the selected
                  point. Local river geometry and defenses are not modeled here.
                </p>
                <Note tone="warning">
                  Discharge is not inundation depth. Without local calibration,
                  no return period or flood probability is defensible.
                </Note>
                <button className="text-link" onClick={() => onSource("flood")}>
                  Inspect river source
                  <ArrowUpRight size={12} />
                </button>
              </section>
            </div>
            <section className="content-card">
              <div className="content-heading">
                <h3>Daily weather outlook</h3>
                <CloudSun size={20} />
              </div>
              <div className="forecast-grid">
                {forecast?.time?.map((t: string, i: number) => (
                  <div key={t}>
                    <span>
                      {new Date(t + "T12:00:00Z").toLocaleDateString("en-GB", {
                        weekday: "short",
                        day: "numeric",
                        timeZone: "UTC",
                      })}
                    </span>
                    <Sun size={25} />
                    <b>
                      {num(forecast.temperature_2m_max?.[i])}°{" "}
                      <small>{num(forecast.temperature_2m_min?.[i])}°</small>
                    </b>
                    <p>
                      {num(forecast.precipitation_sum?.[i])} mm total
                      precipitation
                    </p>
                    <span>
                      {num(forecast.precipitation_probability_max?.[i], 0)}%
                      model precipitation probability
                    </span>
                  </div>
                ))}
              </div>
              <p className="muted small">
                Includes the requested previous-day context. Probability here is
                the provider’s precipitation forecast, not a disaster
                probability.
              </p>
            </section>
            <section className="content-card">
              <div className="content-heading">
                <h3>Soil moisture by model depth</h3>
                <button
                  className="text-link"
                  onClick={() => onSource("weather")}
                >
                  Open model
                  <ArrowUpRight size={12} />
                </button>
              </div>
              <div className="moisture-depths">
                {[
                  ["0_to_1", "0–1 cm"],
                  ["1_to_3", "1–3 cm"],
                  ["3_to_9", "3–9 cm"],
                  ["9_to_27", "9–27 cm"],
                  ["27_to_81", "27–81 cm"],
                ].map(([id, label]) => {
                  const ts = w?.hourly?.time as string[] | undefined;
                  const i =
                    ts?.reduce(
                      (best, t, n) =>
                        Date.parse(t + "Z") <= Date.now() ? n : best,
                      -1,
                    ) ?? -1;
                  const v = w?.hourly?.[`soil_moisture_${id}cm`]?.[i];
                  return (
                    <div key={id}>
                      <span>{label}</span>
                      <div>
                        <i
                          style={{
                            width: `${typeof v === "number" ? Math.min(100, v * 200) : 0}%`,
                          }}
                        />
                      </div>
                      <b>{num(typeof v === "number" ? v * 100 : null)}% v/v</b>
                    </div>
                  );
                })}
              </div>
              <Note>
                Modeled volumetric water content. Soil layer depths are provider
                model horizons, not matching SoilGrids horizons; they are never
                silently merged.
              </Note>
            </section>
          </>
        )}
        {tab === "ecosystem" && (
          <>
            <div className="section-toolbar">
              <div>
                <h2>The longer view.</h2>
                <p>
                  Historical and reference context for {place.name}. These
                  datasets are not live incident feeds.
                </p>
              </div>
              <span className="subtle-pill">FETCH ON DEMAND</span>
            </div>
            <div className="context-selector">
              {[
                [
                  "nasa_power",
                  "Solar & climate",
                  Sun,
                  "Seven recent days, with a 10-day reporting lag.",
                ],
                [
                  "gbif",
                  "Biodiversity records",
                  Leaf,
                  "Historical occurrence records in a 0.4° box.",
                ],
                [
                  "worldbank",
                  "Country population",
                  GlobeMark,
                  "Annual national estimate, not local exposure.",
                ],
              ].map(([id, label, Icon, desc]) => {
                const I = Icon as typeof Sun;
                return (
                  <article className="content-card" key={String(id)}>
                    <I size={26} />
                    <h3>{String(label)}</h3>
                    <p className="muted">{String(desc)}</p>
                    <button
                      className="button"
                      disabled={!!contextLoading}
                      onClick={() => loadContext(String(id))}
                    >
                      {contextLoading === id ? (
                        <Spinner label="Fetching…" />
                      ) : (
                        <>
                          <Database size={13} />
                          Fetch public data
                        </>
                      )}
                    </button>
                    {contexts[String(id)] && (
                      <Status status={contexts[String(id)].status} />
                    )}
                  </article>
                );
              })}
            </div>
            {contexts.nasa_power && (
              <section className="content-card">
                <div className="content-heading">
                  <h3>NASA POWER · irradiance history</h3>
                  <button
                    className="text-link"
                    onClick={() => onSource("nasa_power")}
                  >
                    Provenance
                    <ArrowUpRight size={12} />
                  </button>
                </div>
                <Sparkline
                  values={
                    Object.values(
                      contexts.nasa_power.payload.data.properties?.parameter
                        ?.ALLSKY_SFC_SW_DWN ?? {},
                    ) as (number | null)[]
                  }
                  height={130}
                  color="#dfba72"
                />
                <div className="chart-date-labels">
                  {Object.keys(
                    contexts.nasa_power.payload.data.properties?.parameter
                      ?.ALLSKY_SFC_SW_DWN ?? {},
                  ).map((d) => (
                    <span key={d}>
                      {d.slice(4, 6)}/{d.slice(6)}
                    </span>
                  ))}
                </div>
                <Note>
                  Daily all-sky surface shortwave irradiance. Read the
                  provider’s parameter units in the source response. Missing
                  sentinels are null, not zero.
                </Note>
              </section>
            )}
            {contexts.worldbank && (
              <section className="content-card">
                <span className="eyebrow">WORLD BANK · ANNUAL CONTEXT</span>
                {contexts.worldbank.payload.data.indicators?.map((r: any) => (
                  <div key={r.date}>
                    <h3>
                      {r.country?.value} · {r.date}
                    </h3>
                    <div className="reference-number">{num(r.value, 0)}</div>
                    <p>
                      {r.indicator?.value} · latest available year, not a
                      real-time counter
                    </p>
                  </div>
                ))}
                <Note>
                  Country totals cannot be used to calculate people exposed
                  around the selected map point.
                </Note>
              </section>
            )}
            {contexts.gbif && (
              <section className="content-card">
                <div className="content-heading">
                  <h3>Occurrence catalog sample</h3>
                  <span className="subtle-pill">
                    {num(contexts.gbif.payload.data.total_matching_records, 0)}{" "}
                    matching records
                  </span>
                </div>
                <div className="data-table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Scientific name</th>
                        <th>Recorded</th>
                        <th>Basis</th>
                        <th>License & record</th>
                      </tr>
                    </thead>
                    <tbody>
                      {contexts.gbif.payload.data.records?.map((r: any) => (
                        <tr key={r.key}>
                          <td>{r.scientificName}</td>
                          <td>{r.eventDate?.slice(0, 10) ?? "Unknown"}</td>
                          <td>{r.basisOfRecord?.replaceAll("_", " ")}</td>
                          <td>
                            <ExternalLink
                              url={`https://www.gbif.org/occurrence/${r.key}`}
                            >
                              {r.license?.includes("by-nc")
                                ? "CC BY-NC"
                                : r.license?.includes("by/")
                                  ? "CC BY"
                                  : r.license?.includes("zero")
                                    ? "CC0"
                                    : "See record"}
                            </ExternalLink>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Note>
                  Records are not individuals or species counts. Sensitive
                  species coordinates and personal observer names are not
                  displayed. Dataset-specific licenses apply.
                </Note>
              </section>
            )}
            {!Object.keys(contexts).length && (
              <div className="context-empty">
                <Leaf size={42} />
                <h3>More context. Less unnecessary collection.</h3>
                <p>
                  Choose a dataset to fetch bounded records for this location.
                  <br />
                  No bulk datasets are cloned.
                </p>
              </div>
            )}
          </>
        )}
        {tab === "scenario" && <ScenarioLab onMessage={onMessage} />}
        {tab === "cyber" && (
          <>
            <div className="section-toolbar">
              <div>
                <h2>Defensive intelligence. No scanning.</h2>
                <p>
                  CISA’s Known Exploited Vulnerabilities catalog ·{" "}
                  {num(snapshot?.context.cisa?.catalog_total, 0)} total entries
                </p>
              </div>
              <button className="button" onClick={() => onSource("cisa")}>
                <Database size={14} />
                Source details
              </button>
            </div>
            <Note>
              Showing the latest 60 catalog additions. “Date added” is not
              exploitation onset. No vulnerable hosts, private identities or
              attack locations are inferred.
            </Note>
            <section className="content-card">
              <div className="data-table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Vulnerability</th>
                      <th>Vendor / product</th>
                      <th>Added</th>
                      <th>Known ransomware use</th>
                      <th>Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cyber.map((e) => (
                      <tr key={e.id}>
                        <td>
                          <b>{e.attributes.cveID}</b>
                          <small>
                            {e.title.replace(e.attributes.cveID + " · ", "")}
                          </small>
                        </td>
                        <td>
                          {e.attributes.vendorProject}
                          <small>{e.attributes.product}</small>
                        </td>
                        <td className="mono">{e.attributes.dateAdded}</td>
                        <td>{e.attributes.knownRansomwareCampaignUse}</td>
                        <td>
                          <ExternalLink url={e.url}>NVD</ExternalLink>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
function GlobeMark({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
    >
      <circle cx="20" cy="20" r="16" />
      <ellipse cx="20" cy="20" rx="8" ry="16" />
      <ellipse cx="20" cy="20" rx="16" ry="7" />
      <path d="M4 20h32M20 4v32" />
    </svg>
  );
}
function ScenarioLab({ onMessage }: { onMessage: (s: string) => void }) {
  const [values, setValues] = useState({
    rainfall_erosivity: 1500,
    soil_erodibility: 0.025,
    slope_percent: 8,
    slope_length_m: 60,
    cover_factor: 0.2,
    practice_factor: 1,
    alternative_cover_factor: 0.08,
  });
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const inputs: [
    keyof typeof values,
    string,
    string,
    number,
    number,
    number,
  ][] = [
    [
      "rainfall_erosivity",
      "Rainfall erosivity · R",
      "MJ·mm / (ha·h·year)",
      0,
      10000,
      50,
    ],
    [
      "soil_erodibility",
      "Soil erodibility · K",
      "t·h / (MJ·mm)",
      0,
      0.1,
      0.001,
    ],
    ["slope_percent", "Slope gradient", "Percent rise / run", 0, 60, 1],
    ["slope_length_m", "Slope length", "Meters", 1, 300, 1],
    ["cover_factor", "Baseline cover · C", "Dimensionless", 0, 1, 0.01],
    ["practice_factor", "Support practice · P", "Dimensionless", 0, 1, 0.01],
    [
      "alternative_cover_factor",
      "Alternative cover · C",
      "Dimensionless",
      0,
      1,
      0.01,
    ],
  ];
  async function run() {
    setLoading(true);
    try {
      setResult(
        await api("/api/v1/scenarios/erosion", {
          method: "POST",
          body: JSON.stringify(values),
        }),
      );
    } catch {
      onMessage(
        "Scenario could not be computed. Check inputs and server availability.",
      );
    } finally {
      setLoading(false);
    }
  }
  const dirty =
    result && JSON.stringify(result.inputs) !== JSON.stringify(values);
  return (
    <>
      <div className="section-toolbar">
        <div>
          <h2>Explore a better “what if”.</h2>
          <p>
            A transparent RUSLE erosion calculator. All inputs are explicit
            assumptions.
          </p>
        </div>
        <span className="subtle-pill amber-text">
          SCENARIO · NOT A FORECAST
        </span>
      </div>
      <Note tone="warning">
        The initial values are illustrative and are not derived from the
        selected location. Calibrate factors regionally before agronomic use.
      </Note>
      <div className="scenario-grid">
        <section className="content-card scenario-inputs">
          <div className="content-heading">
            <h3>Define your assumptions</h3>
            <FlaskConical size={18} />
          </div>
          {inputs.map(([key, label, unit, min, max, step]) => (
            <label className="scenario-input" key={key}>
              <span>
                {label}
                <small>{unit}</small>
              </span>
              <div>
                <input
                  type="range"
                  min={min}
                  max={max}
                  step={step}
                  value={values[key]}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, [key]: Number(e.target.value) }))
                  }
                />
                <output>{num(values[key], 3)}</output>
              </div>
            </label>
          ))}
          <button
            className="button button-primary full-width"
            disabled={loading}
            onClick={run}
          >
            {loading ? (
              <Spinner label="Computing explicit factors…" />
            ) : (
              <>
                <FlaskConical size={15} />
                Compare scenarios
                <ArrowRight size={15} />
              </>
            )}
          </button>
        </section>
        <section className="content-card scenario-output">
          <span className="eyebrow">A = R × K × LS × C × P</span>
          <h3>
            Change the assumptions.
            <br />
            See the consequence.
          </h3>
          {result ? (
            <>
              <div className="scenario-comparison">
                <div>
                  <span>Baseline</span>
                  <strong>{num(result.baseline_t_ha_yr, 2)}</strong>
                  <small>t / ha / year</small>
                </div>
                <ArrowRight size={24} />
                <div>
                  <span>Alternative</span>
                  <strong className="mint-text">
                    {num(result.alternative_t_ha_yr, 2)}
                  </strong>
                  <small>t / ha / year</small>
                </div>
              </div>
              <div className="scenario-change">
                {result.relative_change_pct == null
                  ? "Undefined baseline ratio"
                  : `${num(Math.abs(result.relative_change_pct), 1)}% ${result.relative_change_pct <= 0 ? "less" : "more"} modeled soil loss`}
              </div>
              <p className="muted">
                LS factor: {num(result.ls_factor, 4)}.{" "}
                {dirty
                  ? "Inputs changed — run again to update these results."
                  : "These results correspond to the last submitted inputs."}
              </p>
              <button
                className="button"
                onClick={() =>
                  download(
                    "atlas-erosion-scenario.json",
                    JSON.stringify(result, null, 2),
                  )
                }
              >
                <Download size={14} />
                Export assumptions & result
              </button>
            </>
          ) : (
            <div className="scenario-placeholder">
              <FlaskConical size={54} />
              <p>
                Run the scenario to compare annual
                <br />
                sheet and rill erosion.
              </p>
            </div>
          )}
          <Note>
            No single-storm erosion, riverbank erosion, landslide or calibrated
            local forecast. The outputs are scenario calculations, not
            measurements.
          </Note>
        </section>
      </div>
    </>
  );
}
