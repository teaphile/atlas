import { useState } from "react";
import {
  Search,
  ArrowUpRight,
  Database,
  ShieldCheck,
  KeyRound,
  RefreshCw,
  Download,
  Clock,
  Layers3,
  Radio,
} from "lucide-react";
import type { Envelope, Place, Source } from "../types";
import { ago, num, dateLabel, download } from "../utils";
import { Modal, ExternalLink, Note, Spinner, Status } from "./UI";
import { api } from "../api";
export function Sources({
  sources,
  onInspect,
}: {
  sources: Source[];
  onInspect: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("All domains");
  const cats = [
    "All domains",
    "Hazards",
    "Atmosphere",
    "Soil",
    "Water",
    "Mobility",
    "Space",
    "Environment",
    "News",
    "Cyber",
    "Context",
    "Service",
  ];
  const visible = sources.filter(
    (s) =>
      (filter === "All domains" || s.category === filter) &&
      `${s.name} ${s.provider} ${s.description}`
        .toLowerCase()
        .includes(q.toLowerCase()),
  );
  const available = sources.filter((s) =>
    ["fresh", "empty"].includes(s.health.status),
  ).length;
  const demand = sources.filter((s) => s.health.status === "idle").length;
  return (
    <main className="workspace-page sources-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            <Database size={12} />
            THE OPEN DATA NETWORK
          </div>
          <h1>Trust starts at the source.</h1>
          <p>Real endpoints. Visible freshness. No invented fallback data.</p>
        </div>
        <span className="source-total">
          <b>{sources.length || 23}</b>registered adapters
        </span>
      </div>
      <div className="source-summary">
        <div>
          <Radio size={19} />
          <strong>{available}</strong>
          <span>Responding / no records</span>
        </div>
        <div>
          <Clock size={19} />
          <strong>{demand}</strong>
          <span>Available on demand</span>
        </div>
        <div>
          <KeyRound size={19} />
          <strong>{sources.filter((s) => s.key_env).length}</strong>
          <span>Optional key integration</span>
        </div>
        <div>
          <ShieldCheck size={19} />
          <span>
            Observed ≠ modeled.
            <br />
            <b>Provenance is never optional.</b>
          </span>
        </div>
      </div>
      <div className="source-search">
        <Search size={17} />
        <input
          aria-label="Filter data sources"
          placeholder="Find a source, provider or capability…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <kbd>{visible.length} sources</kbd>
      </div>
      <div className="source-filters">
        {cats.map((c) => (
          <button
            onClick={() => setFilter(c)}
            key={c}
            className={filter === c ? "active" : ""}
          >
            {c}
          </button>
        ))}
      </div>
      <div className="source-table">
        <div className="source-table-head">
          <span>PROVIDER & DATASET</span>
          <span>STATUS</span>
          <span>RECORDS</span>
          <span>FETCH CADENCE</span>
          <span>PROVENANCE</span>
        </div>
        {visible.map((s) => (
          <button
            className="source-table-row"
            key={s.id}
            onClick={() => onInspect(s.id)}
          >
            <div className="source-name">
              <span
                className={`source-symbol domain-${s.category.toLowerCase()}`}
              >
                <Layers3 size={17} />
              </span>
              <span>
                <b>{s.name}</b>
                <small>
                  {s.provider} · {s.coverage}
                </small>
              </span>
            </div>
            <div>
              <Status status={s.health.status} />
              <small>
                {s.health.fetched_at
                  ? ago(s.health.fetched_at)
                  : (s.health.error_code?.replaceAll("_", " ") ??
                    "Not fetched yet")}
              </small>
            </div>
            <span className="mono muted">
              {s.health.status === "idle" || s.health.status === "disabled"
                ? "—"
                : num(s.record_count, 0)}
            </span>
            <span className="mono muted">
              {s.ttl_seconds < 60
                ? s.ttl_seconds + " sec"
                : s.ttl_seconds < 3600
                  ? s.ttl_seconds / 60 + " min"
                  : s.ttl_seconds / 3600 + " hr"}
            </span>
            <span className="source-inspect">
              Inspect
              <ArrowUpRight size={14} />
            </span>
          </button>
        ))}
        {!visible.length && (
          <div className="empty-state">No sources match this filter.</div>
        )}
      </div>
      <Note>
        “Responding” refers to the fetch cache, not the age of every record.
        Model, reference and historical datasets retain their own temporal
        meaning. The free Open-Meteo hosted service is non-commercial;
        commercial use needs a suitable plan or self-hosted alternative.
      </Note>
      <div className="source-policy">
        <div>
          <ShieldCheck size={20} />
          <b>No arbitrary URL fetching</b>
          <p>Fixed provider allowlist, response budgets and timeout limits.</p>
        </div>
        <div>
          <Clock size={20} />
          <b>Bounded stale-on-error</b>
          <p>Last-good data keeps its original timestamp and expires.</p>
        </div>
        <div>
          <Database size={20} />
          <b>No bulk data cloning</b>
          <p>
            Small normalized snapshots; explicit on-demand contextual queries.
          </p>
        </div>
      </div>
    </main>
  );
}
export function SourceModal({
  source,
  place,
  onClose,
  onMessage,
}: {
  source: Source;
  place: Place;
  onClose: () => void;
  onMessage: (s: string) => void;
}) {
  const [env, setEnv] = useState<Envelope | null>(null);
  const [loading, setLoading] = useState(false);
  async function fetchData() {
    if (source.id === "worldbank" && !place.countryCode) {
      onMessage("Search a named place first; the country must be explicit.");
      return;
    }
    setLoading(true);
    try {
      setEnv(
        await api<Envelope>(
          `/api/v1/sources/${source.id}?lat=${place.lat}&lon=${place.lon}&country=${place.countryCode || "IN"}${source.id === "geocoding" ? "&q=" + encodeURIComponent(place.name.split(" ·")[0]) : ""}`,
        ),
      );
    } catch {
      onMessage(
        "Request failed. Existing data has not been replaced with estimates.",
      );
    } finally {
      setLoading(false);
    }
  }
  return (
    <Modal title={source.name} onClose={onClose} wide>
      <div className="source-modal-info">
        <Status status={env?.status ?? source.health.status} />
        <span className="subtle-pill">{source.category}</span>
        <span className="subtle-pill">{source.nature}</span>
      </div>
      <p className="modal-description">{source.description}</p>
      <dl className="source-definition">
        <div>
          <dt>Provider</dt>
          <dd>{source.provider}</dd>
        </div>
        <div>
          <dt>Geographic coverage</dt>
          <dd>{source.coverage}</dd>
        </div>
        <div>
          <dt>Cache / maximum age</dt>
          <dd>
            {source.ttl_seconds}s / {source.max_stale_seconds}s
          </dd>
        </div>
        <div>
          <dt>Last successful fetch</dt>
          <dd>{dateLabel(env?.fetched_at ?? source.health.fetched_at)}</dd>
        </div>
        <div>
          <dt>Provider observation / issue time</dt>
          <dd>
            {dateLabel(env?.upstream_time ?? source.health.upstream_time)}
          </dd>
        </div>
        <div>
          <dt>Attribution</dt>
          <dd>{source.attribution}</dd>
        </div>
        <div>
          <dt>License / access</dt>
          <dd>{source.license_note}</dd>
        </div>
      </dl>
      {source.key_env ? (
        <Note tone="warning">
          This optional adapter requires <code>{source.key_env}</code> in the
          server environment. Get a free MAP_KEY from the official provider. Do
          not paste credentials into this dashboard or chat.
        </Note>
      ) : null}
      <div className="button-row">
        <button
          className="button button-primary"
          onClick={fetchData}
          disabled={loading || source.health.status === "disabled"}
        >
          {loading ? (
            <Spinner label="Reading provider…" />
          ) : (
            <>
              <RefreshCw size={14} />
              Fetch / inspect cached data
            </>
          )}
        </button>
        <ExternalLink className="button" url={source.docs_url}>
          Official documentation
        </ExternalLink>
        {env && (
          <button
            className="button"
            onClick={() =>
              download(
                `atlas-${source.id}.json`,
                JSON.stringify({ source, response: env }, null, 2),
              )
            }
          >
            <Download size={14} />
            JSON
          </button>
        )}
      </div>
      {(env?.warnings ?? source.health.warnings).map((w, i) => (
        <Note key={i}>{w}</Note>
      ))}
      {env?.error_code && (
        <p className="error-text">
          Provider state: {env.error_code.replaceAll("_", " ")}
        </p>
      )}
      {env && (
        <div className="source-preview">
          <div className="content-heading">
            <h3>Normalized response</h3>
            <span className="subtle-pill">
              {env.payload.record_count} records
            </span>
          </div>
          <pre>
            {JSON.stringify(env.payload, null, 2).slice(0, 12000)}
            {JSON.stringify(env.payload).length > 12000
              ? "\n… preview truncated; export JSON for the full bounded response."
              : ""}
          </pre>
        </div>
      )}
      <div className="modal-footnote">
        The same provider may power multiple adapters. Adapter count is not a
        count of statistically independent sources.
      </div>
    </Modal>
  );
}
