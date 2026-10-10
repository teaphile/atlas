import { useId, useMemo, useState } from "react";
import { num } from "../utils";
export interface ChartLine {
  name: string;
  values: (number | null)[];
  color: string;
  dashed?: boolean;
}
const timeLabel = (t: string, long = false) =>
  new Date(t).toLocaleString("en-GB", {
    timeZone: "UTC",
    month: long ? "short" : undefined,
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
export function TimeChart({
  title,
  description,
  times,
  lines,
  unit,
  zero = false,
  referenceTime,
}: {
  title: string;
  description: string;
  times: string[];
  lines: ChartLine[];
  unit: string;
  zero?: boolean;
  referenceTime?: string;
}) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [selected, setSelected] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const W = 680,
    H = 226,
    L = 54,
    R = 20,
    T = 18,
    B = 34,
    pw = W - L - R,
    ph = H - T - B;
  const vals = useMemo(
    () =>
      lines.flatMap((l) =>
        l.values.filter(
          (v): v is number => typeof v === "number" && Number.isFinite(v),
        ),
      ),
    [lines],
  );
  let low = vals.length ? Math.min(...vals) : 0,
    high = vals.length ? Math.max(...vals) : 1;
  if (zero) {
    low = Math.min(0, low);
    high = Math.max(0, high);
  }
  const padding = Math.max((high - low) * 0.1, high === low ? 1 : 0.001);
  if (!zero || low < 0) low -= padding;
  high += padding;
  const x = (i: number) => L + (i / Math.max(1, times.length - 1)) * pw;
  const y = (v: number) => T + ph - ((v - low) / (high - low)) * ph;
  const index =
    selected === null
      ? null
      : Math.max(0, Math.min(times.length - 1, selected));
  const paths = (values: (number | null)[]) => {
    const paths: string[] = [];
    let p = "";
    values.forEach((v, i) => {
      if (v === null || !Number.isFinite(v)) {
        if (p) paths.push(p);
        p = "";
      } else p += `${p ? " L" : "M"}${x(i).toFixed(2)},${y(v).toFixed(2)}`;
    });
    if (p) paths.push(p);
    return paths;
  };
  const ticks = Array.from(
    new Set([
      0,
      Math.floor((times.length - 1) / 3),
      Math.floor((2 * (times.length - 1)) / 3),
      times.length - 1,
    ]),
  ).filter((i) => i >= 0);
  const ref = referenceTime
    ? times.findIndex((t) => Date.parse(t) > Date.parse(referenceTime))
    : -1;
  return (
    <section className="chart-card" aria-labelledby={`chart-${id}`}>
      <div className="chart-heading">
        <div>
          <h3 id={`chart-${id}`}>{title}</h3>
          <p>{description}</p>
        </div>
        <span className="chart-unit">{unit}</span>
      </div>
      <div className="chart-legend">
        {lines.map((l) => (
          <span key={l.name}>
            <i style={{ background: l.color }} />
            {l.name}
            {l.dashed ? " · dashed" : ""}
          </span>
        ))}
      </div>
      {vals.length ? (
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="time-chart"
          role="img"
          aria-label={`${title}. ${vals.length} usable values, range ${num(low, 2)} to ${num(high, 2)} ${unit}. Gaps are missing data. A text table is available below.`}
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setSelected(
              Math.round(
                ((((e.clientX - r.left) / r.width) * W - L) / pw) *
                  (times.length - 1),
              ),
            );
          }}
          onMouseLeave={() => setSelected(null)}
        >
          <defs>
            <clipPath id={`clip-${id}`}>
              <rect x={L} y={T - 2} width={pw} height={ph + 4} />
            </clipPath>
          </defs>
          {[0, 1, 2, 3, 4].map((i) => {
            const v = low + (i * (high - low)) / 4;
            return (
              <g key={i}>
                <line
                  x1={L}
                  x2={W - R}
                  y1={y(v)}
                  y2={y(v)}
                  stroke="#30414b"
                  strokeDasharray="3 5"
                />
                <text
                  x={L - 9}
                  y={y(v) + 4}
                  textAnchor="end"
                  className="chart-tick"
                >
                  {num(v, Math.abs(v) < 10 ? 1 : 0)}
                </text>
              </g>
            );
          })}
          {ticks.map((i) => (
            <text
              key={i}
              x={x(i)}
              y={H - 9}
              textAnchor={
                i === 0 ? "start" : i === times.length - 1 ? "end" : "middle"
              }
              className="chart-tick"
            >
              {timeLabel(times[i])}
            </text>
          ))}
          {ref > 0 && (
            <g>
              <rect
                x={x(ref)}
                y={T}
                width={W - R - x(ref)}
                height={ph}
                fill="#92e7c4"
                opacity=".035"
              />
              <line
                x1={x(ref)}
                x2={x(ref)}
                y1={T}
                y2={H - B}
                stroke="#8cb5aa"
                strokeDasharray="4 4"
              />
              <text x={x(ref) + 7} y={T + 12} className="chart-tick">
                Forecast →
              </text>
            </g>
          )}
          {low < 0 && high > 0 && (
            <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} stroke="#647d8b" />
          )}
          <g clipPath={`url(#clip-${id})`}>
            {lines.map((l) => (
              <g key={l.name}>
                {paths(l.values).map((p, i) => (
                  <path
                    key={i}
                    d={p}
                    stroke={l.color}
                    strokeWidth="2.2"
                    fill="none"
                    strokeDasharray={l.dashed ? "5 4" : undefined}
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
                {l.values.length < 80 &&
                  l.values.map((v, i) =>
                    v !== null && Number.isFinite(v) ? (
                      <circle
                        key={i}
                        cx={x(i)}
                        cy={y(v)}
                        r="1.7"
                        fill={l.color}
                      />
                    ) : null,
                  )}
              </g>
            ))}
          </g>
          {index !== null && (
            <g>
              <line
                x1={x(index)}
                x2={x(index)}
                y1={T}
                y2={H - B}
                stroke="#dbe9e5"
                opacity=".6"
              />
              {lines.map((l) => {
                const v = l.values[index];
                return typeof v === "number" && Number.isFinite(v) ? (
                  <circle
                    key={l.name}
                    cx={x(index)}
                    cy={y(v)}
                    r="4"
                    fill={l.color}
                    stroke="#0c151e"
                    strokeWidth="2"
                  />
                ) : null;
              })}
            </g>
          )}
        </svg>
      ) : (
        <div className="chart-no-data">
          No usable values in this window. No curve has been invented.
        </div>
      )}
      <div className="chart-readout" aria-live="polite">
        {index !== null && times[index] ? (
          <>
            <time>{timeLabel(times[index], true)} UTC</time>
            {lines.map((l) => (
              <span key={l.name} style={{ color: l.color }}>
                {l.name}:{" "}
                <b>
                  {num(l.values[index], 2)} {unit}
                </b>
              </span>
            ))}
          </>
        ) : (
          <span>
            Hover to inspect · keyboard slider below · gaps stay unknown
          </span>
        )}
      </div>
      <div className="chart-access">
        <label>
          Inspect time
          <input
            type="range"
            aria-label={`${title}: inspect time`}
            min={0}
            max={Math.max(0, times.length - 1)}
            value={index ?? 0}
            onChange={(e) => setSelected(Number(e.target.value))}
          />
        </label>
        <button
          className="text-link"
          aria-expanded={showTable}
          onClick={() => setShowTable((v) => !v)}
        >
          {showTable ? "Hide" : "Show"} data table
        </button>
      </div>
      {showTable && (
        <div
          className="data-table-wrap chart-data-table"
          tabIndex={0}
          aria-label={`${title} data table, UTC`}
        >
          <table className="data-table">
            <caption>
              {title} · {unit} · UTC · — means missing
            </caption>
            <thead>
              <tr>
                <th scope="col">Time</th>
                {lines.map((l) => (
                  <th scope="col" key={l.name}>
                    {l.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {times.map((t, i) => (
                <tr key={t}>
                  <th scope="row">{timeLabel(t, true)}</th>
                  {lines.map((l) => (
                    <td key={l.name}>{num(l.values[i], 3)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
export function BarChart({
  title,
  description,
  rows,
  unit = "records",
}: {
  title: string;
  description: string;
  rows: { label: string; value: number; color?: string }[];
  unit?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <section className="chart-card">
      <div className="chart-heading">
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        <span className="chart-unit">{unit}</span>
      </div>
      <div className="bar-chart">
        {rows.map((r) => (
          <div className="bar-row" key={r.label}>
            <span>{r.label}</span>
            <div className="bar-track">
              <i
                style={{
                  width: `${(Math.max(0, r.value) / max) * 100}%`,
                  background: r.color ?? "#89dbbc",
                }}
              />
            </div>
            <strong>{num(r.value, 1)}</strong>
          </div>
        ))}
      </div>
      {!rows.length && (
        <p className="muted">No records in the selected scope.</p>
      )}
    </section>
  );
}
export function WindRose({
  bins,
  calm,
  missing,
}: {
  bins: {
    direction: string;
    degrees: number;
    hours: number;
    mean_kmh: number | null;
  }[];
  calm: number;
  missing: number;
}) {
  const max = Math.max(1, ...bins.map((b) => b.hours));
  const cx = 150,
    cy = 143;
  const point = (deg: number, r: number) => [
    cx + Math.sin((deg * Math.PI) / 180) * r,
    cy - Math.cos((deg * Math.PI) / 180) * r,
  ];
  return (
    <section className="chart-card wind-rose">
      <div className="chart-heading">
        <div>
          <h3>Where the wind comes from</h3>
          <p>Next 24 intervals · meteorological “from” direction</p>
        </div>
        <span className="chart-unit">hours</span>
      </div>
      <div className="wind-rose-body">
        <svg
          viewBox="0 0 300 284"
          role="img"
          aria-label={`Wind rose. ${calm} calm hours, ${missing} missing. Counts available in adjacent table.`}
        >
          {[25, 50, 75, 100].map((r) => (
            <circle
              key={r}
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke="#2d414d"
              strokeDasharray="2 5"
            />
          ))}
          {bins.map((b) => {
            const [x1, y1] = point(b.degrees - 9, 14),
              [x2, y2] = point(b.degrees - 9, 14 + (b.hours / max) * 86),
              [x3, y3] = point(b.degrees + 9, 14 + (b.hours / max) * 86),
              [x4, y4] = point(b.degrees + 9, 14);
            return (
              <path
                key={b.direction}
                d={`M${x1} ${y1}L${x2} ${y2}L${x3} ${y3}L${x4} ${y4}Z`}
                fill="#89dfc0"
                fillOpacity=".78"
              >
                <title>
                  {b.direction}: {b.hours} hours
                </title>
              </path>
            );
          })}
          {["N", "E", "S", "W"].map((d, i) => {
            const [x, y] = point(i * 90, 120);
            return (
              <text
                key={d}
                x={x}
                y={y + 4}
                textAnchor="middle"
                className="chart-tick"
              >
                {d}
              </text>
            );
          })}
          <circle cx={cx} cy={cy} r={14} fill="#142831" />
          <text x={cx} y={cy + 4} textAnchor="middle" className="chart-tick">
            {max}
          </text>
        </svg>
        <div>
          <p className="muted small">
            Ring extent = {max} h. Calm (&lt;3.6 km/h): {calm} h. Unknown:{" "}
            {missing} h.
          </p>
          <div
            className="rose-table"
            tabIndex={0}
            aria-label="Wind direction hourly counts"
          >
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">From</th>
                  <th scope="col">Hours</th>
                  <th scope="col">Mean km/h</th>
                </tr>
              </thead>
              <tbody>
                {bins.map((b) => (
                  <tr key={b.direction}>
                    <th scope="row">{b.direction}</th>
                    <td>{b.hours}</td>
                    <td>{num(b.mean_kmh)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}
export function CorrelationMatrix({
  pairs,
  labels,
}: {
  pairs: { x: string; y: string; rho: number | null; pairs: number }[];
  labels: Record<string, string>;
}) {
  const keys = Object.keys(labels);
  return (
    <section className="chart-card correlation-card">
      <div className="chart-heading">
        <div>
          <h3>Relationships, not causes</h3>
          <p>
            Past modeled hours · pairwise Spearman rank association · ≥48 pairs
          </p>
        </div>
      </div>
      <div
        className="data-table-wrap"
        tabIndex={0}
        aria-label="Correlation matrix"
      >
        <table className="correlation-table">
          <caption>
            ρ from −1 to +1. Cell title includes sample count. Shared model
            inputs and serial dependence prevent a causal interpretation.
          </caption>
          <thead>
            <tr>
              <th scope="col">Variable</th>
              {keys.map((k) => (
                <th scope="col" key={k}>
                  {labels[k]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {keys.map((x) => (
              <tr key={x}>
                <th scope="row">{labels[x]}</th>
                {keys.map((y) => {
                  const p = pairs.find(
                    (p) => (p.x === x && p.y === y) || (p.x === y && p.y === x),
                  );
                  const v = p?.rho;
                  return (
                    <td
                      key={y}
                      title={
                        x === y
                          ? "Same variable"
                          : `${p?.pairs ?? 0} aligned pairs`
                      }
                      style={{
                        background:
                          typeof v === "number"
                            ? `rgba(${v >= 0 ? "93,196,158" : "227,151,119"},${0.07 + Math.abs(v) * 0.36})`
                            : undefined,
                      }}
                    >
                      {x === y ? "—" : num(v, 2)}
                      {x !== y && <small>n={p?.pairs ?? 0}</small>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        Raw series, not causal effects. No p-values or significance claims; “—”
        also covers constant or insufficient series.
      </p>
    </section>
  );
}
