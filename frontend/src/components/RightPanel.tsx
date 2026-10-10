import { utcMillis } from "../utils";
import { useEffect, useState } from "react";
import { imageBlob } from "../api";
import {
  Activity,
  Flame,
  CloudLightning,
  MapPin,
  ArrowUpRight,
  Wind,
  Thermometer,
  Droplets,
  ChevronRight,
  ArrowLeft,
  Radio,
  Orbit,
  TriangleAlert,
  Video,
} from "lucide-react";
import type { AtlasEvent, LocationData, Place, Snapshot } from "../types";
import {
  num,
  ago,
  COLORS,
  LABELS,
  aqiLabel,
  weatherLabel,
  dateLabel,
} from "../utils";
import { ExternalLink, Note, Sparkline, Spinner, WeatherGlyph } from "./UI";
function EventIcon({ kind, size = 16 }: { kind: string; size?: number }) {
  return kind === "earthquake" ? (
    <Activity size={size} />
  ) : kind === "fire" ? (
    <Flame size={size} />
  ) : kind === "satellite" ? (
    <Orbit size={size} />
  ) : kind === "camera" ? (
    <Video size={size} />
  ) : (
    <CloudLightning size={size} />
  );
}
export function EventCard({
  event,
  onClick,
  selected = false,
}: {
  event: AtlasEvent;
  onClick: () => void;
  selected?: boolean;
}) {
  return (
    <button
      className={`event-card ${selected ? "selected" : ""}`}
      onClick={onClick}
    >
      <span
        className="event-kind-icon"
        style={{
          color: COLORS[event.kind],
          background: COLORS[event.kind] + "10",
        }}
      >
        <EventIcon kind={event.kind} />
      </span>
      <div className="event-content">
        <div className="event-meta">
          <span style={{ color: COLORS[event.kind] }}>
            {LABELS[event.kind]}
          </span>
          <small>{ago(event.occurred_at)}</small>
        </div>
        <b>{event.title}</b>
        <div className="event-footer">
          <span>
            {event.source_id === "firms"
              ? "NASA FIRMS"
              : event.source_id.toUpperCase()}
          </span>
          {typeof event.attributes.magnitude === "number" ? (
            <strong>M {event.attributes.magnitude.toFixed(1)}</strong>
          ) : ["critical", "high"].includes(event.severity) ? (
            <strong className="high-tag">{event.severity}</strong>
          ) : (
            <span className="event-nature">{event.nature}</span>
          )}
          <ArrowUpRight size={12} />
        </div>
      </div>
    </button>
  );
}
function CameraImage({ path, title }: { path: string; title: string }) {
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const ac = new AbortController();
    let blobUrl = "";
    const timeout = window.setTimeout(() => {
      setFailed(true);
      ac.abort();
    }, 15000);
    setUrl("");
    setFailed(false);
    imageBlob(path, ac.signal)
      .then((blob) => {
        if (ac.signal.aborted) return;
        blobUrl = URL.createObjectURL(blob);
        setUrl(blobUrl);
      })
      .catch(() => {
        if (!ac.signal.aborted) setFailed(true);
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      ac.abort();
      clearTimeout(timeout);
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [path]);
  return failed ? (
    <Note>Operator snapshot unavailable. Use the official source below.</Note>
  ) : url ? (
    <img
      className="camera-snapshot"
      src={url}
      alt={`Public operator snapshot of ${title}`}
    />
  ) : (
    <Spinner label="Loading operator snapshot…" />
  );
}
export function EventInspector({
  event,
  onBack,
  onAnalyze,
}: {
  event: AtlasEvent;
  onBack: () => void;
  onAnalyze: () => void;
}) {
  const relevant = [
    "magnitude",
    "depth_km",
    "provider_alert",
    "frp_mw",
    "detection_confidence",
    "satellite",
    "aircraft_type",
    "altitude_ft",
    "speed_knots",
    "altitude_km",
    "velocity_kmh",
    "country",
    "area",
  ];
  return (
    <div className="event-inspector">
      <button className="back-button" onClick={onBack}>
        <ArrowLeft size={14} />
        Intelligence feed
      </button>
      <div className="inspector-kind" style={{ color: COLORS[event.kind] }}>
        <EventIcon kind={event.kind} size={23} />
        <span>{LABELS[event.kind]}</span>
      </div>
      <h2>{event.title}</h2>
      <div className="pill-row">
        <span className="subtle-pill">{event.source_id.toUpperCase()}</span>
        <span className="subtle-pill">{event.nature}</span>
      </div>
      {event.kind === "camera" && event.attributes.snapshot_url && (
        <>
          <CameraImage
            path={event.attributes.snapshot_url}
            title={event.title}
          />
          <span className="muted small">
            Operator snapshot · capture time unknown
          </span>
        </>
      )}
      {event.description && (
        <p className="inspector-description">{event.description}</p>
      )}
      <dl className="evidence-list">
        <div>
          <dt>Event / issue time</dt>
          <dd>{dateLabel(event.occurred_at)}</dd>
        </div>
        {event.updated_at && (
          <div>
            <dt>Provider revision</dt>
            <dd>{dateLabel(event.updated_at)}</dd>
          </div>
        )}
        {event.expires_at && (
          <div>
            <dt>Expiry</dt>
            <dd>{dateLabel(event.expires_at)}</dd>
          </div>
        )}
        {event.point && (
          <div>
            <dt>Coordinates</dt>
            <dd>
              {num(event.point.lat, 4)}, {num(event.point.lon, 4)}
            </dd>
          </div>
        )}
        {relevant
          .filter((k) => event.attributes[k] != null)
          .map((k) => (
            <div key={k}>
              <dt>{k.replaceAll("_", " ")}</dt>
              <dd>{String(event.attributes[k])}</dd>
            </div>
          ))}
      </dl>
      {event.attributes.location_semantics && (
        <Note>{event.attributes.location_semantics}</Note>
      )}
      {event.attributes.caveat && (
        <Note tone="warning">{event.attributes.caveat}</Note>
      )}
      {event.attributes.severity_basis && (
        <p className="muted small">{event.attributes.severity_basis}</p>
      )}
      <ExternalLink
        url={event.url}
        className="button button-primary full-width"
      >
        Read original source
      </ExternalLink>
      {event.point && (
        <button className="button full-width" onClick={onAnalyze}>
          <MapPin size={14} />
          Analyze this location
        </button>
      )}
      <p className="muted small">
        Keep the provider’s context. A point on the map is not an impact
        boundary.
      </p>
    </div>
  );
}
export function RightPanel({
  place,
  location,
  loading,
  error,
  events,
  focus,
  onEvent,
  onBack,
  onAnalyzeEvent,
  onReport,
  onRetry,
  snapshot,
}: {
  place: Place;
  location: LocationData | null;
  loading: boolean;
  error: string;
  events: AtlasEvent[];
  focus: AtlasEvent | null;
  onEvent: (e: AtlasEvent) => void;
  onBack: () => void;
  onAnalyzeEvent: () => void;
  onReport: () => void;
  onRetry: () => void;
  snapshot: Snapshot | null;
}) {
  const w = location?.sources.weather?.payload.data;
  const current = w?.current;
  const aq = location?.sources.air_quality?.payload.data?.current;
  const hourly = w?.hourly;
  const now = Date.now();
  const currentHour =
    (hourly?.time as string[] | undefined)?.reduce(
      (best, t, i) => (utcMillis(t) <= now ? i : best),
      -1,
    ) ?? -1;
  const moisture =
    currentHour >= 0 ? hourly?.soil_moisture_0_to_1cm?.[currentHour] : null;
  const temps =
    (hourly?.temperature_2m as (number | null)[] | undefined)?.slice(
      Math.max(0, currentHour),
      Math.max(0, currentHour) + 25,
    ) ?? [];
  const score = location?.screening.score;
  const kp = snapshot?.context.space_kp?.current;
  return (
    <aside className={`right-panel ${focus ? "has-focus" : ""}`}>
      {focus ? (
        <EventInspector
          event={focus}
          onBack={onBack}
          onAnalyze={onAnalyzeEvent}
        />
      ) : (
        <>
          <section className="location-card">
            <div className="section-title">
              <span>
                <MapPin size={12} /> LOCATION INTELLIGENCE
              </span>
              <span className="small-live-dot" />
            </div>
            <div className="location-heading">
              <div>
                <h2>{place.name}</h2>
                <p>
                  {place.country} <span>·</span> {num(place.lat, 3)}°,{" "}
                  {num(place.lon, 3)}°
                </p>
              </div>
              <button title="Open detailed location report" onClick={onReport}>
                <ArrowUpRight size={19} />
              </button>
            </div>
            {loading && !location ? (
              <div className="location-loading">
                <Spinner label="Reading environmental models…" />
                <div className="skeleton-row" />
                <div className="skeleton-row" />
              </div>
            ) : error && !location ? (
              <Note tone="warning">
                {error}{" "}
                <button className="text-link" onClick={onRetry}>
                  Retry environmental data
                </button>
              </Note>
            ) : (
              <>
                {error && (
                  <Note tone="warning">
                    {error}{" "}
                    <button className="text-link" onClick={onRetry}>
                      Retry environmental data
                    </button>
                  </Note>
                )}
                {location &&
                  ["weather", "air_quality"].some(
                    (id) =>
                      !["fresh", "empty"].includes(
                        location.sources[id]?.status,
                      ),
                  ) && (
                    <Note tone="warning">
                      Some environmental inputs are stale or unavailable.
                      Inspect source timestamps before use.
                    </Note>
                  )}
                <div className="current-weather">
                  <WeatherGlyph code={current?.weather_code} size={27} />
                  <strong>
                    {num(current?.temperature_2m, 1)}
                    <span>°</span>
                  </strong>
                  <div>
                    {weatherLabel(current?.weather_code)}
                    <small>
                      Weather model ·{" "}
                      {ago(
                        Number.isFinite(utcMillis(w?.current?.time))
                          ? new Date(utcMillis(w?.current?.time)).toISOString()
                          : null,
                      )}
                    </small>
                  </div>
                </div>
                <div className="location-metrics">
                  <div>
                    <span>
                      <Wind size={12} />
                      WIND
                    </span>
                    <strong>
                      {num(current?.wind_speed_10m)}
                      <small>km/h</small>
                    </strong>
                  </div>
                  <div>
                    <span>
                      <Droplets size={12} />
                      HUMIDITY
                    </span>
                    <strong>
                      {num(current?.relative_humidity_2m, 0)}
                      <small>%</small>
                    </strong>
                  </div>
                  <div>
                    <span>
                      <CloudLightning size={12} />
                      US AQI
                    </span>
                    <strong className={aq?.us_aqi > 100 ? "amber-text" : ""}>
                      {num(aq?.us_aqi, 0)}
                      <small>{aqiLabel(aq?.us_aqi)}</small>
                    </strong>
                  </div>
                  <div>
                    <span>
                      <Droplets size={12} />
                      SOIL MOISTURE
                    </span>
                    <strong>
                      {num(
                        typeof moisture === "number" ? moisture * 100 : null,
                      )}
                      <small>% v/v</small>
                    </strong>
                  </div>
                </div>
                <div className="temperature-trend">
                  <div>
                    <span>Next 24h · temperature</span>
                    <small>
                      <Thermometer size={10} />
                      °C
                    </small>
                  </div>
                  <Sparkline values={temps} height={40} />
                </div>
                <div className="screening-mini">
                  <div>
                    <span>Environmental attention</span>
                    <b>
                      {score != null ? Math.round(score) : "—"}
                      <small>/ 100</small>
                    </b>
                  </div>
                  <div className="score-track">
                    <i style={{ width: `${score ?? 0}%` }} />
                  </div>
                  <p>
                    Screening, not a disaster probability{" "}
                    <button
                      onClick={onReport}
                      title="Read screening methodology"
                    >
                      <TriangleAlert size={11} />
                    </button>
                  </p>
                </div>
                {location && (
                  <p
                    className="screen-time"
                    title={dateLabel(location.generated_at)}
                  >
                    Summary calculated {ago(location.generated_at)}. Not
                    continuous monitoring.
                  </p>
                )}
                <button className="location-report-button" onClick={onReport}>
                  Explore location report
                  <ArrowUpRight size={14} />
                </button>
              </>
            )}
          </section>
          <section className="intel-feed">
            <div className="feed-heading">
              <div>
                <span className="eyebrow">THE LATEST SIGNALS</span>
                <h2>
                  Intelligence feed <Radio size={14} />
                </h2>
              </div>
              <span className="badge-number">{events.length}</span>
            </div>
            <div className="feed-filter">
              <span className="active">
                <i />
                Global · priority first
              </span>
              <span>Source-linked</span>
            </div>
            <div className="feed-list">
              {events.length ? (
                events
                  .slice(0, 35)
                  .map((e) => (
                    <EventCard
                      key={e.id}
                      event={e}
                      onClick={() => onEvent(e)}
                    />
                  ))
              ) : (
                <div className="empty-state">
                  <Activity size={25} />
                  <p>No records match these layers and filters.</p>
                  <small>Absence of a report is not an all-clear.</small>
                </div>
              )}
            </div>
          </section>
          <div className="space-weather-mini">
            <Orbit size={16} />
            <div>
              <b>
                Space weather{" "}
                <span>
                  {typeof kp?.kp === "number"
                    ? kp.kp >= 5
                      ? "ELEVATED"
                      : "QUIET"
                    : "PENDING"}
                </span>
              </b>
              <small>NOAA planetary Kp · {ago(kp?.time ?? null)}</small>
            </div>
            <strong>{num(kp?.kp, 1)}</strong>
            <ChevronRight size={13} />
          </div>
        </>
      )}
    </aside>
  );
}
