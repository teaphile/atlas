import {
  Activity,
  Flame,
  CloudLightning,
  Plane,
  Video,
  Orbit,
  ChevronDown,
  ChevronRight,
  Layers3,
  MapPin,
  Plus,
  Database,
  Zap,
  ArrowUpRight,
  Globe2,
} from "lucide-react";
import type { Kind, Place, SavedArea, Snapshot } from "../types";
import { COLORS, compact } from "../utils";
const GROUPS = [
  {
    title: "NATURAL SYSTEMS",
    rows: [
      {
        label: "Seismic activity",
        kinds: ["earthquake"],
        icon: Activity,
        note: "USGS + GDACS",
      },
      {
        label: "Fires & hotspots",
        kinds: ["fire"],
        icon: Flame,
        note: "VIIRS + NASA EONET",
      },
      {
        label: "Weather & hazards",
        kinds: ["weather", "storm", "flood", "volcano", "drought", "other"],
        icon: CloudLightning,
        note: "Global + US warnings",
      },
    ],
  },
  {
    title: "MOBILITY & ORBIT",
    rows: [
      {
        label: "Air traffic",
        kinds: ["aircraft"],
        icon: Plane,
        note: "Selected region · on demand",
      },
      {
        label: "Public cameras",
        kinds: ["camera"],
        icon: Video,
        note: "London · official operator",
      },
      {
        label: "Space assets",
        kinds: ["satellite"],
        icon: Orbit,
        note: "ISS position",
      },
    ],
  },
];
export function Sidebar({
  snapshot,
  counts,
  enabled,
  onToggle,
  onRegion,
  place,
  minimum,
  onMinimum,
  saved,
  onSaved,
  onSave,
  onSources,
  onAbout,
  view,
}: {
  snapshot: Snapshot | null;
  counts: Record<string, number>;
  enabled: Set<Kind>;
  onToggle: (kinds: Kind[]) => void;
  onRegion: (name: string) => void;
  place: Place;
  minimum: number;
  onMinimum: (n: number) => void;
  saved: SavedArea[];
  onSaved: (a: SavedArea) => void;
  onSave: () => void;
  onSources: () => void;
  onAbout: () => void;
  view: string;
}) {
  const online =
    snapshot?.sources.filter((s) =>
      ["fresh", "empty"].includes(s.health.status),
    ).length ?? 0;
  return (
    <aside className="sidebar">
      <div className="sidebar-heading">
        <div className="eyebrow">YOUR PLANET, IN CONTEXT</div>
        <h1>
          Global overview <Globe2 size={19} />
        </h1>
        <button className="region-select" onClick={() => onRegion("global")}>
          <Globe2 size={14} />
          <span>All regions</span>
          <ChevronDown size={14} />
        </button>
      </div>
      <div className="network-stats">
        <div>
          <span className="small-label">AVAILABLE RECORDS</span>
          <strong>
            {snapshot ? compact(snapshot.summary.record_count) : "—"}
            <span className="tiny-live">
              <i /> SOURCE FEEDS
            </span>
          </strong>
        </div>
        <div className="network-meta">
          <span>
            <i className="live-dot" />
            {online} sources responding
          </span>
          <button onClick={onSources} title="Inspect source health">
            <ArrowUpRight size={13} />
          </button>
        </div>
        <div className="network-track">
          {Array.from({ length: 23 }, (_, i) => (
            <i key={i} className={i < online ? "lit" : ""} />
          ))}
        </div>
      </div>
      <div className="sidebar-scroll">
        <div className="section-title">
          <span>
            <Layers3 size={13} /> DATA LAYERS
          </span>
          <span className="badge-number">{enabled.size}</span>
        </div>
        {GROUPS.map((g) => (
          <div className="layer-group" key={g.title}>
            <h3>{g.title}</h3>
            {g.rows.map((row) => {
              const kinds = row.kinds as Kind[];
              const on = kinds.some((k) => enabled.has(k));
              const count = kinds.reduce((s, k) => s + (counts[k] ?? 0), 0);
              const Icon = row.icon;
              return (
                <button
                  key={row.label}
                  className={`layer-row ${on ? "enabled" : ""}`}
                  onClick={() => onToggle(kinds)}
                  aria-pressed={on}
                >
                  <span
                    className="layer-icon"
                    style={{ color: COLORS[kinds[0]] }}
                  >
                    <Icon size={16} />
                  </span>
                  <span className="layer-text">
                    <b>{row.label}</b>
                    <small>{row.note}</small>
                  </span>
                  <span className="layer-count">
                    {count
                      ? compact(count)
                      : ["aircraft", "camera"].includes(kinds[0])
                        ? "—"
                        : "0"}
                  </span>
                  <span className={`switch ${on ? "on" : ""}`}>
                    <i />
                  </span>
                </button>
              );
            })}
          </div>
        ))}
        <div className="severity-section">
          <h3>
            PRIORITY FILTER <span>Display, not impact</span>
          </h3>
          <div className="segment">
            <button
              onClick={() => onMinimum(0)}
              className={minimum === 0 ? "selected" : ""}
            >
              All signals
            </button>
            <button
              onClick={() => onMinimum(3)}
              className={minimum === 3 ? "selected" : ""}
            >
              Watch+
            </button>
            <button
              onClick={() => onMinimum(4)}
              className={minimum === 4 ? "selected" : ""}
            >
              High+
            </button>
          </div>
        </div>
        <div className="section-title saved-title">
          <span>
            <MapPin size={13} /> SAVED VIEWS
          </span>
          <button title="Save selected location as a view" onClick={onSave}>
            <Plus size={14} />
          </button>
        </div>
        <button
          className={`saved-region ${place.countryCode === "IN" ? "selected" : ""}`}
          onClick={() => onRegion("india")}
        >
          <span className="region-square">IN</span>
          <span>
            India & South Asia<small>Regional observation view</small>
          </span>
          <ChevronRight size={14} />
        </button>
        <button className="saved-region" onClick={() => onRegion("pacific")}>
          <span className="region-square">PA</span>
          <span>
            Pacific Ring of Fire<small>Seismic monitoring</small>
          </span>
          <ChevronRight size={14} />
        </button>
        <button className="saved-region" onClick={() => onRegion("london")}>
          <span className="region-square">UK</span>
          <span>
            Greater London<small>Public mobility network</small>
          </span>
          <ChevronRight size={14} />
        </button>
        {saved.map((s, i) => (
          <button
            key={i}
            className="saved-region custom"
            onClick={() => onSaved(s)}
          >
            <span className="region-square">
              <MapPin size={13} />
            </span>
            <span>
              {s.name}
              <small>Saved in this browser</small>
            </span>
            <ChevronRight size={14} />
          </button>
        ))}
      </div>
      <div className="sidebar-bottom">
        <div
          className="provenance-card"
          onClick={onAbout}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") onAbout();
          }}
        >
          <span className="provenance-icon">
            <Zap size={15} />
          </span>
          <div>
            <b>Built on evidence.</b>
            <p>Every signal has a source.</p>
          </div>
          <ArrowUpRight size={15} />
        </div>
        <button
          className={`source-link ${view === "sources" ? "active" : ""}`}
          onClick={onSources}
        >
          <Database size={13} />
          Source transparency
          <ChevronRight size={13} />
        </button>
      </div>
    </aside>
  );
}
