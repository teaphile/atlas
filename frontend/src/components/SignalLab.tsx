import { memo, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowDownToLine,
  FlaskConical,
  RefreshCw,
  SlidersHorizontal,
} from "lucide-react";
import type { Place } from "../types";
import type { InsightReport } from "../insightTypes";
import { api, isAbort } from "../api";
import { dateLabel, download, num, utcMillis } from "../utils";
import { convert, unitFor } from "../workspace";
import { usePreferences } from "./Preferences";
import { TimeChart, WindRose, CorrelationMatrix } from "./Charts";
import { Note, Spinner } from "./UI";
const COLORS = ["#9ce9c9", "#e6b57c", "#9db5f5", "#d298db"];
const LABELS: Record<string, string> = {
  temperature_c: "Temperature",
  humidity_pct: "Humidity",
  wind_kmh: "Wind",
  precipitation_mm: "Precipitation",
  us_aqi: "US AQI",
};
export function exportInsights(
  report: InsightReport,
  format: "json" | "csv",
  place: Place,
) {
  if (format === "json") {
    download(
      "atlas-signal-lab.json",
      JSON.stringify(
        {
          place,
          report,
          notice:
            "Derived provider-model data. Not new measurements or calibrated hazard probabilities.",
        },
        null,
        2,
      ),
    );
    return;
  }
  const keys = Object.keys(report.units);
  const quote = (v: unknown) => {
    let s = String(v ?? "");
    if (typeof v === "string" && /^[\s]*[=+@\-\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  };
  const meta = [
    report.version,
    report.nature,
    report.as_of,
    report.point.lat,
    report.point.lon,
    report.provenance.weather?.fetched_at ?? "",
    report.provenance.air_quality?.fetched_at ?? "",
    report.provenance.weather?.model_time ?? "",
    report.provenance.air_quality?.model_time ?? "",
    report.provenance.weather?.grid?.latitude ?? "",
    report.provenance.weather?.grid?.longitude ?? "",
    report.provenance.weather?.docs_url ?? "",
    report.provenance.air_quality?.docs_url ?? "",
  ];
  const headers = [
    "method_version",
    "nature",
    "analysis_as_of_utc",
    "requested_latitude",
    "requested_longitude",
    "weather_fetched_at_utc",
    "air_fetched_at_utc",
    "weather_model_time_utc",
    "air_model_time_utc",
    "weather_grid_latitude",
    "weather_grid_longitude",
    "weather_docs_url",
    "air_docs_url",
  ];
  const rows = report.series.time.map((t, i) =>
    [t, ...meta, ...keys.map((k) => report.series[k]?.[i] ?? "")]
      .map(quote)
      .join(","),
  );
  download(
    "atlas-derived-series.csv",
    [["time_utc", ...headers, ...keys].join(","), ...rows].join("\r\n"),
    "text/csv",
  );
}
export const SignalLab = memo(function SignalLab({ place }: { place: Place }) {
  const [report, setReport] = useState<InsightReport | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [retry, setRetry] = useState(0);
  const [scope, setScope] = useState<"forecast" | "baseline" | "all">(
      "forecast",
    ),
    [horizon, setHorizon] = useState(24);
  const [base, setBase] = useState("10"),
    [cap, setCap] = useState("30"),
    [parameters, setParameters] = useState({ base: 10, cap: 30 });
  const { preferences, setPreferences } = usePreferences();
  const units = preferences.units;
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!document.hidden) setRetry((x) => x + 1);
    }, 600000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setReport(null);
    setError("");
    void api<InsightReport>(
      `/api/v1/insights?lat=${place.lat}&lon=${place.lon}&base_c=${parameters.base}&cap_c=${parameters.cap}`,
      { signal: ac.signal },
    )
      .then((d) => {
        if (!ac.signal.aborted) setReport(d);
      })
      .catch((e) => {
        if (!ac.signal.aborted && !isAbort(e))
          setError(e instanceof Error ? e.message : "Analysis unavailable");
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [place.lat, place.lon, parameters, retry]);
  const indices = useMemo(
    () =>
      report
        ? report.series.time
            .map((_, i) => i)
            .filter(
              (i) =>
                scope === "all" ||
                (scope === "baseline"
                  ? utcMillis(report.series.time[i]) <= utcMillis(report.as_of)
                  : utcMillis(report.series.time[i]) >
                    utcMillis(report.forecast_start)),
            )
        : [],
    [report, scope],
  );
  const times = indices.map((i) => report!.series.time[i]);
  const vals = (key: string) =>
    indices.map((i) => convert(report?.series[key]?.[i], key, units));
  const line = (
    key: string,
    name: string,
    color = COLORS[0],
    dashed = false,
  ) => ({ name, values: vals(key), color, dashed });
  const w = report?.windows.find((w) => w.hours === horizon);
  return (
    <div className="signal-lab">
      <div className="section-toolbar">
        <div>
          <span className="eyebrow">
            INTERPRETABLE MODELS · NO DOWNLOADED WEIGHTS
          </span>
          <h2>Make the relationships visible.</h2>
          <p>{place.name} · seven-day modeled baseline + 72-hour outlook</p>
        </div>
        <button
          className="button"
          onClick={() => setRetry((x) => x + 1)}
          disabled={loading}
        >
          <RefreshCw size={14} />
          Refresh analysis
        </button>
      </div>
      <div className="lab-controls">
        <div className="segmented" aria-label="Series window">
          {(["forecast", "baseline", "all"] as const).map((s) => (
            <button
              key={s}
              aria-pressed={scope === s}
              className={scope === s ? "active" : ""}
              onClick={() => setScope(s)}
            >
              {s === "forecast"
                ? "72-hour outlook"
                : s === "baseline"
                  ? "7-day baseline"
                  : "Both windows"}
            </button>
          ))}
        </div>
        <label>
          Chart units
          <select
            value={units}
            onChange={(e) =>
              setPreferences({
                ...preferences,
                units: e.target.value as typeof units,
              })
            }
          >
            <option value="metric">Metric</option>
            <option value="imperial">US display</option>
          </select>
        </label>
        <div className="button-row">
          <button
            className="button"
            disabled={!report}
            onClick={() => report && exportInsights(report, "csv", place)}
          >
            <ArrowDownToLine size={14} />
            CSV
          </button>
          <button
            className="button"
            disabled={!report}
            onClick={() => report && exportInsights(report, "json", place)}
          >
            JSON + methods
          </button>
        </div>
      </div>
      {loading && (
        <div className="lab-loading">
          <Spinner label="Aligning model timestamps and calculating transparent derivatives…" />
          <p>
            Weather and air-quality requests share the source cache. Soil is not
            queried here.
          </p>
        </div>
      )}
      {error && (
        <Note tone="warning">
          {error}{" "}
          <button className="text-link" onClick={() => setRetry((x) => x + 1)}>
            Retry
          </button>
        </Note>
      )}
      {report && (
        <>
          {report.status !== "available" && (
            <Note tone="warning">
              Current weather inputs are stale or unavailable. Weather-derived
              outputs are withheld; remaining usable sources are shown
              independently.
            </Note>
          )}
          <div className="lab-provenance">
            <span>
              <i className="status-dot" />
              DERIVED · NOT OBSERVED
            </span>
            <span>As of {dateLabel(report.as_of)}</span>
            <span>
              Weather: {report.provenance.weather?.status ?? "missing"}
            </span>
            <span>
              Air: {report.provenance.air_quality?.status ?? "missing"}
            </span>
          </div>
          <div className="summary-window-heading">
            <h3>One consistent analysis window</h3>
            <div className="segmented" aria-label="Summary horizon">
              {[24, 48, 72].map((h) => (
                <button
                  key={h}
                  aria-pressed={horizon === h}
                  className={horizon === h ? "active" : ""}
                  onClick={() => setHorizon(h)}
                >
                  {h} h
                </button>
              ))}
            </div>
          </div>
          <p className="muted small">
            {w ? `${dateLabel(w.start)} → ${dateLabel(w.end)}` : ""}. Full
            future intervals only. Every expected value is required for a total
            or maximum.
          </p>
          <div className="derived-metrics">
            {[
              [
                "precipitation_mm",
                "Precipitation",
                "Provider interval totals",
                "precipitation_mm",
              ],
              [
                "reference_et0_mm",
                "Reference ET₀",
                "Well-watered grass reference",
                "reference_et0_mm",
              ],
              [
                "reference_balance_mm",
                "P − ET₀",
                "Atmospheric reference balance",
                "reference_balance_mm",
              ],
              [
                "gdd_c_day",
                "Thermal accumulation",
                `Base ${parameters.base}°C · cap ${parameters.cap}°C`,
                "temperature_c",
              ],
              [
                "max_vpd_kpa",
                "Maximum VPD",
                "Derived over liquid water",
                "vpd_kpa",
              ],
              [
                "max_us_aqi",
                "Maximum US AQI",
                "Modeled index, not a station",
                "us_aqi",
              ],
            ].map(([key, label, detail, coverage]) => (
              <article key={key}>
                <span>{label}</span>
                <strong>
                  {num(
                    convert(
                      w?.[key as keyof typeof w] as number | null,
                      key,
                      units,
                    ),
                    2,
                  )}
                  <small>{unitFor(key, units)}</small>
                </strong>
                <p>{detail}</p>
                <div className="coverage-mini">
                  <i
                    style={{
                      width: `${((w?.coverage[coverage] ?? 0) / horizon) * 100}%`,
                    }}
                  />
                </div>
                <small>
                  {w?.coverage[coverage] ?? 0}/{horizon} input hours
                </small>
              </article>
            ))}
          </div>
          <div className="lab-chart-grid">
            <TimeChart
              title="Thermal profile & dew point"
              description="Hourly model temperature + Tetens-derived dew point"
              unit={unitFor("temperature_c", units)}
              times={times}
              lines={[
                line("temperature_c", "Temperature"),
                line("dewpoint_c", "Dew point", COLORS[2], true),
              ]}
              referenceTime={report.as_of}
            />
            <TimeChart
              title="Atmospheric drying demand"
              description="Vapor pressure deficit · hourly T/RH derivative, not crop stress"
              unit="kPa"
              times={times}
              lines={[line("vpd_kpa", "VPD", COLORS[1])]}
              zero
              referenceTime={report.as_of}
            />
            <TimeChart
              title="Precipitation & reference ET₀"
              description="Hourly interval totals · model values, not soil water storage"
              unit={unitFor("precipitation_mm", units)}
              times={times}
              lines={[
                line("precipitation_mm", "Precipitation", COLORS[2]),
                line("reference_et0_mm", "Reference ET₀", COLORS[1], true),
              ]}
              zero
              referenceTime={report.as_of}
            />
            <TimeChart
              title="Air-quality trajectory"
              description="CAMS modeled US AQI · not India NAQI or a monitoring station"
              unit="US AQI"
              times={times}
              lines={[line("us_aqi", "US AQI", COLORS[3])]}
              zero
              referenceTime={report.as_of}
            />
            <TimeChart
              title="Reference atmospheric balance"
              description="P − ET₀ · negative does not establish an irrigation need"
              unit={unitFor("reference_balance_mm", units)}
              times={times}
              lines={[line("reference_balance_mm", "Reference balance")]}
              zero
              referenceTime={report.as_of}
            />
            <TimeChart
              title="Joint-weather novelty"
              description="Robust diurnal residuals + regularized covariance · not hazard probability"
              unit="distance"
              times={times}
              lines={[
                line("novelty_distance", "Mahalanobis distance", COLORS[1]),
              ]}
              zero
              referenceTime={report.as_of}
            />
            <WindRose
              bins={report.wind_rose.bins}
              calm={report.wind_rose.calm_hours}
              missing={report.wind_rose.missing_hours}
            />
            <CorrelationMatrix pairs={report.correlations} labels={LABELS} />
          </div>
          <div className="lab-model-grid">
            <section className="content-card model-card">
              <div className="content-heading">
                <h3>
                  <Activity size={18} /> A small model you can inspect
                </h3>
                <span className="subtle-pill">
                  {report.novelty.status === "ready"
                    ? "FIT AVAILABLE"
                    : "INSUFFICIENT HISTORY"}
                </span>
              </div>
              <p>{report.novelty.method}</p>
              <dl className="model-facts">
                <div>
                  <dt>Complete training rows</dt>
                  <dd>
                    {report.novelty.training_samples} / ≥
                    {report.novelty.minimum_samples}
                  </dd>
                </div>
                <div>
                  <dt>Learned numeric parameters</dt>
                  <dd>{report.novelty.parameter_count ?? "—"}</dd>
                </div>
                <div>
                  <dt>Numeric array payload</dt>
                  <dd>
                    {report.novelty.serialized_parameter_bytes
                      ? `${report.novelty.serialized_parameter_bytes} bytes`
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt>Covariance shrinkage</dt>
                  <dd>{num(report.novelty.shrinkage, 2)}</dd>
                </div>
              </dl>
              <p className="muted small">
                Array payload excludes Python/runtime memory. Four variables:
                temperature, humidity, wind and surface pressure. Only complete
                past rows train the model; UTC-hour medians remove the regular
                daily cycle.
              </p>
              <ul className="method-notes">
                {report.novelty.limitations.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </section>
            <section className="content-card model-card">
              <div className="content-heading">
                <h3>
                  <SlidersHorizontal size={18} /> Thermal-time sandbox
                </h3>
                <span className="subtle-pill">EXPLICIT ASSUMPTIONS</span>
              </div>
              <p>
                Explore capped hourly degree-day accumulation. The baseline and
                cap are assumptions, not crop recommendations.
              </p>
              <form
                className="thermal-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (
                    !base.trim() ||
                    !cap.trim() ||
                    !Number.isFinite(+base) ||
                    !Number.isFinite(+cap) ||
                    +base < -10 ||
                    +cap > 50 ||
                    +base >= +cap
                  ) {
                    setError(
                      "Use −10 ≤ base < cap ≤ 50 °C. Blank inputs are not zero.",
                    );
                    return;
                  }
                  setParameters({ base: +base, cap: +cap });
                }}
              >
                <label>
                  Base (°C)
                  <input
                    type="number"
                    min="-10"
                    max="49"
                    step="0.5"
                    required
                    value={base}
                    onChange={(e) => setBase(e.target.value)}
                  />
                </label>
                <label>
                  Cap (°C)
                  <input
                    type="number"
                    min="-9"
                    max="50"
                    step="0.5"
                    required
                    value={cap}
                    onChange={(e) => setCap(e.target.value)}
                  />
                </label>
                <button className="button primary" type="submit">
                  <FlaskConical size={14} />
                  Recalculate
                </button>
              </form>
              <code className="formula">
                Σ max(0, min(T_hour, cap) − base) / 24
              </code>
              <p className="muted small">
                Hours are integrated using endpoint temperatures, not a
                reconstructed continuous temperature path. The output stays
                °C·day even when chart display uses °F.
              </p>
              <div className="trend-descriptors">
                <h4>72-hour descriptive slopes</h4>
                {Object.entries(report.trends).map(([key, t]) => (
                  <p key={key}>
                    <span>{LABELS[key] ?? key}</span>
                    <b>
                      {num(t.slope_per_day, 2)}{" "}
                      {key === "temperature_c" ? "°C/day" : "AQI/day"}
                    </b>
                    <small>{t.samples} hourly samples · Theil–Sen</small>
                  </p>
                ))}
                <p className="muted small">
                  Slopes describe the supplied forecast window. They are not
                  additional forecasts or statistical significance tests.
                </p>
              </div>
            </section>
          </div>
          <details className="method-details">
            <summary>Equations, input clocks & scientific boundaries</summary>
            <div className="method-detail-body">
              <h3>Tetens psychrometrics</h3>
              <code className="formula">
                eₛ = 0.6108 exp(17.27T / (T + 237.3)); eₐ = RH × eₛ / 100; VPD =
                eₛ − eₐ
              </code>
              <p>
                Pressure in kPa; T in °C. Dew point inverts the same equation.
                RH = 0 has no finite dew point. Values outside −40…50 °C are
                withheld; liquid-water approximation, not an ice/frost-point
                model.
              </p>
              <h3>Input provenance</h3>
              <div className="data-table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Source</th>
                      <th>Cache state</th>
                      <th>Model time</th>
                      <th>Fetched</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(report.provenance).map(([id, s]) => (
                      <tr key={id}>
                        <th>{id}</th>
                        <td>{s.status}</td>
                        <td>{dateLabel(s.model_time)}</td>
                        <td>{dateLabel(s.fetched_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="method-notes">
                {report.limitations.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
              <p className="muted">
                Method version {report.version}. Canonical arrays, coverage
                counts and the fitted-baseline rank are included in JSON/CSV
                exports.
              </p>
            </div>
          </details>
        </>
      )}
    </div>
  );
});
