import { useEffect, useMemo, useState } from "react";
import { BarChart3, Download, Search } from "lucide-react";
import type { AtlasEvent, Snapshot } from "../types";
import {
  COLORS,
  LABELS,
  dateLabel,
  exportEvents,
  histogram,
  num,
} from "../utils";
import { BarChart, TimeChart } from "./Charts";
import { ExternalLink, Note } from "./UI";
export function Observatory({
  events,
  snapshot,
  hours,
  now,
  onEvent,
}: {
  events: AtlasEvent[];
  snapshot: Snapshot | null;
  hours: number;
  now: number;
  onEvent: (e: AtlasEvent) => void;
}) {
  const [q, setQ] = useState(""),
    [page, setPage] = useState(0);
  const records = useMemo(
    () =>
      events
        .filter((e) =>
          `${e.title} ${e.source_id} ${e.kind}`
            .toLowerCase()
            .includes(q.toLowerCase()),
        )
        .sort(
          (a, b) =>
            Date.parse(b.occurred_at ?? "1970-01-01") -
            Date.parse(a.occurred_at ?? "1970-01-01"),
        ),
    [events, q],
  );
  useEffect(() => setPage(0), [q, events.length, hours]);
  const count = (key: "kind" | "severity" | "source_id") => {
    const c: Record<string, number> = {};
    for (const e of events) c[e[key]] = (c[e[key]] ?? 0) + 1;
    return Object.entries(c)
      .sort((a, b) => b[1] - a[1])
      .map(([k, value]) => ({
        label: key === "kind" ? LABELS[k as keyof typeof LABELS] : k,
        value,
        color: key === "kind" ? COLORS[k as keyof typeof COLORS] : undefined,
      }));
  };
  const bins = Math.min(48, Math.max(6, hours));
  const times = Array.from({ length: bins }, (_, i) =>
    new Date(
      now - hours * 3600000 + ((i * hours) / bins) * 3600000,
    ).toISOString(),
  );
  const counts = histogram(events, hours, bins, now);
  const quakes = events
    .filter(
      (e) =>
        e.source_id === "usgs" &&
        typeof e.attributes.magnitude === "number" &&
        Number.isFinite(e.attributes.magnitude) &&
        typeof e.attributes.depth_km === "number" &&
        Number.isFinite(e.attributes.depth_km) &&
        e.attributes.depth_km >= -10 &&
        e.attributes.depth_km <= 1000 &&
        e.attributes.magnitude >= -2 &&
        e.attributes.magnitude <= 10,
    )
    .slice(0, 600);
  const depth = Math.max(10, ...quakes.map((e) => e.attributes.depth_km));
  const minMag = Math.min(0, ...quakes.map((e) => e.attributes.magnitude)),
    maxMag = Math.max(5, ...quakes.map((e) => e.attributes.magnitude));
  const pages = Math.max(1, Math.ceil(records.length / 15));
  const current = Math.min(page, pages - 1);
  const temporalUnknown = events.filter((e) => !e.occurred_at).length;
  return (
    <div className="observatory">
      <div className="section-toolbar">
        <div>
          <span className="eyebrow">
            CURRENT MAP FILTERS · NO EXTRA PROVIDER REQUESTS
          </span>
          <h2>The shape of the evidence.</h2>
          <p>
            Explore record distributions while keeping source coverage separate
            from real-world incidence.
          </p>
        </div>
        <BarChart3 size={30} className="section-symbol" />
      </div>
      <div className="record-kpis">
        <div>
          <b>{num(events.length, 0)}</b>
          <span>filtered records</span>
        </div>
        <div>
          <b>{num(events.filter((e) => !!e.point).length, 0)}</b>
          <span>with mapped points</span>
        </div>
        <div>
          <b>{new Set(events.map((e) => e.source_id)).size}</b>
          <span>contributing feeds</span>
        </div>
        <div>
          <b>{temporalUnknown}</b>
          <span>without event time</span>
        </div>
      </div>
      <Note>
        Counts are provider records, not unique incidents or
        population-normalized rates. Detections, warnings and catalogs have
        different sampling processes. Layer, priority and event-time filters
        follow the map.
      </Note>
      <div className="lab-chart-grid">
        <TimeChart
          title="Time distribution of natural-event records"
          description={`${hours}-hour window · bin starts in UTC · old active warnings and undated records are not forced into bins`}
          times={times}
          lines={[{ name: "Record count", values: counts, color: "#9ce9c9" }]}
          unit="records / bin"
          zero
        />
        <BarChart
          title="Records by type"
          description="Cross-source overlaps are retained"
          rows={count("kind")}
        />
        <BarChart
          title="Provider contribution"
          description="A larger catalog does not imply a more hazardous region"
          rows={count("source_id")}
        />
        <BarChart
          title="Reported priority"
          description="Provider-specific normalization, not a calibrated cross-hazard scale"
          rows={count("severity")}
        />
        <section className="chart-card">
          <div className="chart-heading">
            <div>
              <h3>Earthquake magnitude & depth</h3>
              <p>
                USGS only · provider-reported magnitudes; magnitude types can
                differ
              </p>
            </div>
          </div>
          {quakes.length ? (
            <svg
              viewBox="0 0 620 260"
              className="scatter-chart"
              role="img"
              aria-label={`${quakes.length} USGS records, magnitude versus depth. Depth increases downward. Read underlying records in the table.`}
            >
              {[0, 1, 2, 3, 4].map((i) => (
                <g key={i}>
                  <line
                    x1="52"
                    x2="595"
                    y1={25 + i * 47}
                    y2={25 + i * 47}
                    stroke="#30414b"
                    strokeDasharray="3 5"
                  />
                  <text
                    x="43"
                    y={29 + i * 47}
                    textAnchor="end"
                    className="chart-tick"
                  >
                    {num((depth * i) / 4, 0)}
                  </text>
                  <text
                    x={52 + i * 135}
                    y="237"
                    textAnchor="middle"
                    className="chart-tick"
                  >
                    {num(minMag + ((maxMag - minMag) * i) / 4, 1)}
                  </text>
                </g>
              ))}
              {quakes.map((e) => (
                <circle
                  key={e.id}
                  cx={
                    52 +
                    ((e.attributes.magnitude - minMag) / (maxMag - minMag)) *
                      540
                  }
                  cy={25 + (Math.max(0, e.attributes.depth_km) / depth) * 188}
                  r="3.4"
                  fill="#e9bb87"
                  opacity=".62"
                >
                  <title>
                    {e.title}: M{e.attributes.magnitude},{" "}
                    {e.attributes.depth_km} km
                  </title>
                </circle>
              ))}
              <text x="320" y="257" textAnchor="middle" className="chart-tick">
                Reported magnitude
              </text>
              <text x="8" y="13" className="chart-tick">
                Depth km ↓
              </text>
            </svg>
          ) : (
            <div className="chart-no-data">
              No usable USGS magnitude/depth pairs in these filters.
            </div>
          )}
          <p className="muted small">
            Up to 600 records. Negative reported depths are shown at the
            surface. Depth and magnitude do not by themselves establish shaking,
            damage or individual risk.
          </p>
        </section>
        <section className="chart-card">
          <div className="chart-heading">
            <div>
              <h3>Coverage before conclusions</h3>
              <p>
                Fresh retrieval is not fresh observation or scientific
                verification
              </p>
            </div>
          </div>
          <div
            className="source-coverage-list"
            tabIndex={0}
            aria-label="Default source coverage"
          >
            {snapshot?.sources
              .filter((s) => s.enabled_by_default)
              .map((s) => (
                <div key={s.id}>
                  <span>{s.name}</span>
                  <b className={`source-health-${s.health.status}`}>
                    {s.health.status}
                  </b>
                  <small>{s.coverage}</small>
                </div>
              ))}
          </div>
        </section>
      </div>
      <section className="content-card record-explorer">
        <div className="content-heading">
          <h3>Inspect the underlying records</h3>
          <button
            className="button"
            onClick={() =>
              exportEvents(records, "csv", {
                generated_at: new Date().toISOString(),
                scope:
                  "Filtered current provider records, not unique incidents",
              })
            }
          >
            <Download size={14} />
            Export matching CSV
          </button>
        </div>
        <label className="record-search">
          <Search size={16} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter title, source or type"
            aria-label="Filter underlying records"
            maxLength={100}
          />
          <span>{records.length} matches</span>
        </label>
        <div
          className="data-table-wrap"
          tabIndex={0}
          aria-label="Filtered record list"
        >
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Record</th>
                <th scope="col">Source / nature</th>
                <th scope="col">Event time (UTC)</th>
                <th scope="col">Evidence</th>
              </tr>
            </thead>
            <tbody>
              {records.slice(current * 15, current * 15 + 15).map((e) => (
                <tr key={e.id}>
                  <th scope="row">
                    <button className="record-open" onClick={() => onEvent(e)}>
                      {e.title}
                    </button>
                    <small>
                      {LABELS[e.kind]} · {e.severity}
                    </small>
                  </th>
                  <td>
                    {e.source_id}
                    <small>{e.nature}</small>
                  </td>
                  <td>{dateLabel(e.occurred_at)}</td>
                  <td>
                    {e.url ? (
                      <ExternalLink url={e.url}>Provider</ExternalLink>
                    ) : (
                      "No link"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!records.length && (
          <p className="muted">
            No matching records. Missing coverage is not an all-clear.
          </p>
        )}
        <div className="pagination">
          <button
            className="button"
            disabled={current === 0}
            onClick={() => setPage((v) => Math.max(0, v - 1))}
          >
            Previous
          </button>
          <span>
            Page {current + 1} of {pages}
          </span>
          <button
            className="button"
            disabled={current === pages - 1}
            onClick={() => setPage((v) => v + 1)}
          >
            Next
          </button>
        </div>
      </section>
    </div>
  );
}
