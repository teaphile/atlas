import { memo, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRightLeft, Download } from "lucide-react";
import type { Place, SavedArea } from "../types";
import type { InsightReport } from "../insightTypes";
import { api, isAbort } from "../api";
import { dateLabel, download, num } from "../utils";
import { convert, unitFor } from "../workspace";
import { usePreferences } from "./Preferences";
import { TimeChart } from "./Charts";
import { Note, Spinner } from "./UI";
const PRESETS: Place[] = [
  {
    name: "New Delhi",
    country: "India",
    countryCode: "IN",
    lat: 28.6139,
    lon: 77.209,
  },
  {
    name: "Mumbai",
    country: "India",
    countryCode: "IN",
    lat: 19.076,
    lon: 72.8777,
  },
  {
    name: "London",
    country: "United Kingdom",
    countryCode: "GB",
    lat: 51.5074,
    lon: -0.1278,
  },
  {
    name: "Singapore",
    country: "Singapore",
    countryCode: "SG",
    lat: 1.3521,
    lon: 103.8198,
  },
];
const COLORS = ["#9ce9c9", "#e6b57c", "#9db5f5"];
const METRICS = [
  ["mean_temperature_c", "Mean temperature", "temperature_c"],
  ["max_temperature_c", "Maximum temperature", "temperature_c"],
  ["precipitation_mm", "Precipitation total", "precipitation_mm"],
  ["reference_et0_mm", "Reference ET₀", "reference_et0_mm"],
  ["reference_balance_mm", "P − ET₀ balance", "reference_balance_mm"],
  ["max_vpd_kpa", "Maximum VPD", "vpd_kpa"],
  ["max_wind_kmh", "Maximum wind", "wind_kmh"],
  ["max_us_aqi", "Maximum US AQI", "us_aqi"],
  ["gdd_c_day", "Degree-day accumulation", "temperature_c"],
];
interface Result {
  as_of: string;
  generated_at: string;
  reports: InsightReport[];
  scope: string;
  places: Place[];
}
export const Compare = memo(function Compare({
  place,
  saved,
}: {
  place: Place;
  saved: SavedArea[];
}) {
  const pool = useMemo(() => {
    const p = [
      place,
      ...saved.map((s) => s.place).filter((p): p is Place => !!p),
      ...PRESETS,
    ];
    return p.filter(
      (v, i) => p.findIndex((o) => o.lat === v.lat && o.lon === v.lon) === i,
    );
  }, [place, saved]);
  const [selected, setSelected] = useState([0, 1, 2]),
    [result, setResult] = useState<Result | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [horizon, setHorizon] = useState(24);
  const controller = useRef<AbortController | null>(null);
  const { preferences } = usePreferences(),
    units = preferences.units;
  useEffect(() => {
    controller.current?.abort();
    setSelected([0, 1, 2]);
    setResult(null);
    setError("");
    setBusy(false);
    return () => controller.current?.abort();
  }, [pool]);
  async function run() {
    const choices = selected
      .filter((i) => i >= 0)
      .map((i) => pool[i])
      .filter(Boolean);
    if (
      choices.length < 2 ||
      new Set(choices.map((p) => `${p.lat},${p.lon}`)).size !== choices.length
    ) {
      setError("Choose two or three different locations.");
      return;
    }
    controller.current?.abort();
    const ac = new AbortController();
    controller.current = ac;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const r = await api<Omit<Result, "places">>("/api/v1/compare", {
        method: "POST",
        body: JSON.stringify({
          points: choices.map((p) => ({ lat: p.lat, lon: p.lon })),
        }),
        signal: ac.signal,
      });
      if (!ac.signal.aborted) setResult({ ...r, places: choices });
    } catch (e) {
      if (!isAbort(e) && !ac.signal.aborted)
        setError(e instanceof Error ? e.message : "Comparison unavailable");
    } finally {
      if (!ac.signal.aborted) setBusy(false);
    }
  }
  const start = result?.reports[0]?.forecast_start;
  const indices =
    result?.reports[0]?.series.time
      .map((_, i) => i)
      .filter(
        (i) =>
          Date.parse(result.reports[0].series.time[i]) > Date.parse(start!),
      ) ?? [];
  const times = indices.map((i) => result!.reports[0].series.time[i]);
  const consistent = result?.reports.every((r) => r.forecast_start === start);
  return (
    <div className="compare-lab">
      <div className="section-toolbar">
        <div>
          <span className="eyebrow">
            LIKE-FOR-LIKE · BOUNDED TO THREE PLACES
          </span>
          <h2>Different places. The same clock.</h2>
          <p>
            Compare explicit model quantities, not an invented “safest city”
            score.
          </p>
        </div>
        <ArrowRightLeft className="section-symbol" size={30} />
      </div>
      <form
        className="compare-picker"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        {selected.map((value, i) => (
          <label key={i}>
            Location {i + 1}
            {i === 2 ? " (optional)" : ""}
            <select
              value={value}
              disabled={busy}
              onChange={(e) => {
                setSelected((old) =>
                  old.map((v, j) => (i === j ? Number(e.target.value) : v)),
                );
                setResult(null);
              }}
            >
              {i === 2 && <option value={-1}>None — compare two</option>}
              {pool.map((p, j) => (
                <option key={`${p.lat},${p.lon}`} value={j}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        ))}
        <button className="button primary" disabled={busy} type="submit">
          <ArrowRightLeft size={15} />
          {busy ? "Comparing…" : "Compare places"}
        </button>
      </form>
      <p className="muted small">
        Your selected and saved locations appear alongside a few named presets.
        Save any searched place to add it here. No soil requests; weather/AQI
        cache entries are reused.
      </p>
      {busy && (
        <Spinner label="Requesting aligned, timestamped model reports…" />
      )}
      {error && <Note tone="warning">{error}</Note>}
      {!result && !busy && !error && (
        <div className="compare-empty">
          <ArrowRightLeft size={38} />
          <h3>Patterns become clearer in context.</h3>
          <p>
            Select two or three locations above. Every value keeps its units,
            input coverage and source clocks.
          </p>
        </div>
      )}
      {result && (
        <>
          {!consistent && (
            <Note tone="warning">
              Forecast windows do not match. Comparison charts are withheld
              rather than silently aligned.
            </Note>
          )}
          <div className="summary-window-heading">
            <h3>{dateLabel(result.as_of)}</h3>
            <div className="segmented" aria-label="Comparison horizon">
              {[24, 48, 72].map((h) => (
                <button
                  key={h}
                  className={h === horizon ? "active" : ""}
                  aria-pressed={h === horizon}
                  onClick={() => setHorizon(h)}
                >
                  {h} h
                </button>
              ))}
            </div>
            <button
              className="button"
              onClick={() =>
                download(
                  "atlas-location-comparison.json",
                  JSON.stringify(result, null, 2),
                )
              }
            >
              <Download size={14} />
              Export comparison
            </button>
          </div>
          <div
            className="comparison-table-wrap data-table-wrap"
            tabIndex={0}
            aria-label="Location comparison"
          >
            <table className="data-table comparison-table">
              <caption>
                {horizon}-hour model quantities · thermal base 10°C, cap 30°C ·
                — means unavailable/incomplete
              </caption>
              <thead>
                <tr>
                  <th scope="col">Quantity</th>
                  {result.places.map((p, i) => (
                    <th scope="col" key={i}>
                      <i style={{ background: COLORS[i] }} />
                      {p.name}
                      <small>
                        {num(p.lat, 3)}, {num(p.lon, 3)}
                      </small>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {METRICS.map(([key, label, coverage]) => (
                  <tr key={key}>
                    <th scope="row">
                      {label}
                      <small>{unitFor(key, units)}</small>
                    </th>
                    {result.reports.map((r, i) => {
                      const w = r.windows.find((w) => w.hours === horizon);
                      return (
                        <td key={i}>
                          <b>
                            {num(
                              convert(
                                w
                                  ? (w as unknown as Record<string, number>)[
                                      key
                                    ]
                                  : null,
                                key,
                                units,
                              ),
                              2,
                            )}
                          </b>
                          <small>
                            {w?.coverage[coverage] ?? 0}/{horizon} hourly inputs
                          </small>
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr>
                  <th scope="row">Source state</th>
                  {result.reports.map((r, i) => (
                    <td key={i}>
                      Weather: {r.provenance.weather?.status}
                      <small>Air: {r.provenance.air_quality?.status}</small>
                    </td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">Window begins</th>
                  {result.reports.map((r, i) => (
                    <td key={i}>{dateLabel(r.forecast_start)}</td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
          {consistent && (
            <div className="lab-chart-grid">
              {[
                ["temperature_c", "Temperature paths"],
                ["us_aqi", "Air-quality paths"],
                ["vpd_kpa", "Vapor pressure deficit"],
                ["reference_balance_mm", "Reference atmospheric balance"],
              ].map(([key, title]) => (
                <TimeChart
                  key={key}
                  title={title}
                  description="Next 72 complete forecast intervals · shared UTC window"
                  times={times}
                  unit={unitFor(key, units)}
                  zero={key !== "temperature_c"}
                  lines={result.reports.map((r, i) => ({
                    name: result.places[i].name,
                    color: COLORS[i],
                    dashed: i === 1,
                    values: indices.map((j) =>
                      convert(r.series[key]?.[j], key, units),
                    ),
                  }))}
                />
              ))}
            </div>
          )}
          <Note>
            {result.scope} Grid resolution, local representativeness and
            provider-model uncertainty differ by region. This is not a
            place-level safety assessment.
          </Note>
        </>
      )}
    </div>
  );
});
