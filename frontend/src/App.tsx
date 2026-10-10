import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Globe2,
  Search,
  Command,
  Activity,
  Database,
  Bookmark,
  Settings2,
  Info,
  Layers3,
  ChevronDown,
  ArrowUpRight,
  Radio,
  Download,
  Check,
  ChevronRight,
  RefreshCw,
  X,
  ShieldCheck,
  KeyRound,
  SlidersHorizontal,
  FileText,
} from "lucide-react";
import type {
  AreaReport,
  AtlasEvent,
  Envelope,
  GeoPolygon,
  Kind,
  LocationData,
  Place,
  SavedArea,
  Snapshot,
} from "./types";
import { api, hasDeploymentKey, isAbort, setDeploymentKey } from "./api";
import {
  COLORS,
  filteredEvents,
  severityRank,
  compact,
  download,
  exportEvents,
  num,
} from "./utils";
import { Sidebar } from "./components/Sidebar";
import { RightPanel } from "./components/RightPanel";
import { MapView } from "./components/MapView";
import type { MapPreset } from "./components/MapView";
import { Timeline } from "./components/Timeline";
import { SearchModal } from "./components/Search";
import { Intelligence } from "./components/Intelligence";
import type { IntelligenceTab } from "./components/Intelligence";
import { Sources, SourceModal } from "./components/Sources";
import {
  ExternalLink,
  IconButton,
  Modal,
  Note,
  Spinner,
} from "./components/UI";
const NATURAL: Kind[] = [
  "earthquake",
  "fire",
  "storm",
  "weather",
  "flood",
  "volcano",
  "drought",
  "other",
  "satellite",
];
const ALL = new Set<Kind>(Object.keys(COLORS) as Kind[]);
const DEFAULT_PLACE: Place = {
  name: "Agra district · rural east",
  lat: 27.1,
  lon: 78.15,
  country: "India",
  countryCode: "IN",
};
function loadSaved(): SavedArea[] {
  try {
    const rows = JSON.parse(localStorage.getItem("atlas.views.v1") || "[]");
    return Array.isArray(rows)
      ? rows
          .filter(
            (x) =>
              typeof x.name === "string" &&
              Array.isArray(x.center) &&
              x.center.length === 2 &&
              x.center.every(
                (n: unknown) => typeof n === "number" && Number.isFinite(n),
              ) &&
              Math.abs(x.center[0]) <= 180 &&
              Math.abs(x.center[1]) <= 90 &&
              typeof x.zoom === "number" &&
              x.zoom >= 0 &&
              x.zoom <= 15,
          )
          .slice(0, 6)
      : [];
  } catch {
    return [];
  }
}
function Logo() {
  return (
    <svg viewBox="0 0 40 40" width="35" height="35" aria-hidden="true">
      <path d="M4 32 20 3l16 29h-9L20 19l-7 13Z" fill="currentColor" />
      <path d="m20 29 3.5 6h-7Z" fill="currentColor" />
    </svg>
  );
}
export default function App() {
  const [view, setView] = useState<"overview" | "intelligence" | "sources">(
    "overview",
  );
  const [tab, setTab] = useState<IntelligenceTab>("brief");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [snapshotError, setSnapshotError] = useState("");
  const [place, setPlace] = useState<Place>(DEFAULT_PLACE);
  const [location, setLocation] = useState<LocationData | null>(null);
  const [locationLoading, setLocationLoading] = useState(true);
  const [locationError, setLocationError] = useState("");
  const [enabled, setEnabled] = useState(new Set<Kind>(NATURAL));
  const [minimum, setMinimum] = useState(0);
  const [hours, setHours] = useState(24);
  const [end, setEnd] = useState<number | null>(null);
  const [focus, setFocus] = useState<AtlasEvent | null>(null);
  const [aviation, setAviation] = useState<Envelope | null>(null);
  const [preset, setPreset] = useState<MapPreset | null>(null);
  const [quick, setQuick] = useState("all");
  const [search, setSearch] = useState(false);
  const [about, setAbout] = useState(false);
  const [settings, setSettings] = useState(false);
  const [accessKey, setAccessKey] = useState("");
  const [authVersion, setAuthVersion] = useState(0);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedArea[]>(loadSaved);
  const [saveModal, setSaveModal] = useState(false);
  const [viewName, setViewName] = useState("");
  const [area, setArea] = useState<AreaReport | null>(null);
  const [areaModal, setAreaModal] = useState(false);
  const [areaLoading, setAreaLoading] = useState(false);
  const [areaError, setAreaError] = useState("");
  const [exportMenu, setExportMenu] = useState(false);
  const [toast, setToast] = useState("");
  const [now, setNow] = useState(Date.now());
  const [mobileLayers, setMobileLayers] = useState(false);
  const inRefresh = useRef(false);
  const toastTimer = useRef<number | null>(null);
  const wantCameras = enabled.has("camera");
  const wantAircraft = enabled.has("aircraft");
  const message = useCallback((s: string) => {
    setToast(s);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 6500);
  }, []);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("atlas.views.v1", JSON.stringify(saved));
    } catch {
      /* Private mode remains usable. */
    }
  }, [saved]);
  const refresh = useCallback(async () => {
    if (inRefresh.current) return;
    inRefresh.current = true;
    try {
      const d = await api<Snapshot>(
        `/api/v1/snapshot?include_cameras=${wantCameras}`,
      );
      setSnapshot(d);
      setSnapshotError("");
    } catch (e) {
      if (!isAbort(e))
        setSnapshotError(
          e instanceof Error ? e.message : "Connection unavailable",
        );
    } finally {
      inRefresh.current = false;
    }
  }, [wantCameras]);
  useEffect(() => {
    void refresh();
    const t = window.setInterval(refresh, 30000);
    let debounce: number | undefined;
    let stream: EventSource | undefined;
    if (!hasDeploymentKey()) {
      stream = new EventSource("/api/v1/stream");
      stream.addEventListener("sync", () => {
        if (debounce) clearTimeout(debounce);
        debounce = window.setTimeout(refresh, 500);
      });
    }
    return () => {
      clearInterval(t);
      if (debounce) clearTimeout(debounce);
      stream?.close();
    };
  }, [refresh, authVersion]);
  useEffect(() => {
    const ac = new AbortController();
    setLocation(null);
    setLocationError("");
    setLocationLoading(true);
    setAviation(null);
    const soilTask = api<Envelope>(
      `/api/v1/sources/soil?lat=${place.lat}&lon=${place.lon}`,
      { signal: ac.signal },
    );
    // Absorb failure immediately; it must not become an unhandled rejection while current conditions load.
    const settledSoil = soilTask
      .then((value) => ({ value }))
      .catch(() => ({ value: null }));
    void api<LocationData>(
      `/api/v1/location?lat=${place.lat}&lon=${place.lon}`,
      { signal: ac.signal },
    )
      .then(async (d) => {
        if (ac.signal.aborted) return;
        d.sources.soil = { ...d.sources.soil, status: "refreshing" };
        setLocation(d);
        setLocationLoading(false);
        const { value: soil } = await settledSoil;
        if (ac.signal.aborted) return;
        if (soil) {
          setLocation((v) =>
            v
              ? {
                  ...v,
                  sources: { ...v.sources, soil },
                  soil_summary: soil.analysis ?? v.soil_summary,
                }
              : v,
          );
        } else
          setLocation((v) =>
            v
              ? {
                  ...v,
                  sources: {
                    ...v.sources,
                    soil: {
                      ...v.sources.soil,
                      status: "unavailable",
                      error_code: "request_failed",
                      warnings: [
                        "Soil query unavailable. No estimated values were substituted.",
                      ],
                    },
                  },
                }
              : v,
          );
      })
      .catch((e) => {
        if (!isAbort(e))
          setLocationError(
            "Environmental sources could not be reached. Try again or inspect source health.",
          );
      })
      .finally(() => {
        if (!ac.signal.aborted) setLocationLoading(false);
      });
    let refreshing = false;
    const timer = window.setInterval(async () => {
      if (refreshing || document.hidden) return;
      refreshing = true;
      try {
        const d = await api<LocationData>(
          `/api/v1/location?lat=${place.lat}&lon=${place.lon}`,
          { signal: ac.signal },
        );
        if (!ac.signal.aborted)
          setLocation((old) => ({
            ...d,
            sources: {
              ...d.sources,
              soil: old?.sources.soil ?? d.sources.soil,
            },
            soil_summary: old?.soil_summary ?? d.soil_summary,
          }));
      } catch (e) {
        if (!isAbort(e))
          setLocationError(
            "Environmental refresh failed. Check the source timestamps.",
          );
      } finally {
        refreshing = false;
      }
    }, 600000);
    return () => {
      ac.abort();
      clearInterval(timer);
    };
  }, [place.lat, place.lon, authVersion]);
  useEffect(() => {
    if (!wantAircraft) return;
    const ac = new AbortController();
    let busy = false;
    async function fetchFlights() {
      if (busy) return;
      busy = true;
      try {
        const d = await api<Envelope>(
          `/api/v1/sources/aviation?lat=${place.lat}&lon=${place.lon}`,
          { signal: ac.signal },
        );
        if (!ac.signal.aborted) {
          setAviation(d);
          if (d.status === "unavailable")
            message(
              "Regional aviation is unavailable. No aircraft are simulated.",
            );
        }
      } catch (e) {
        if (!isAbort(e)) message("Regional aviation request failed.");
      } finally {
        busy = false;
      }
    }
    void fetchFlights();
    const t = window.setInterval(fetchFlights, 60000);
    return () => {
      ac.abort();
      clearInterval(t);
    };
  }, [wantAircraft, place.lat, place.lon, authVersion, message]);
  useEffect(() => {
    if (!wantCameras) return;
    const ac = new AbortController();
    void api<Envelope>("/api/v1/sources/tfl", { signal: ac.signal })
      .then((d) => {
        if (!ac.signal.aborted) {
          void refresh();
          if (d.status === "unavailable")
            message("TfL camera catalog is unavailable.");
          else
            message(
              "Public cameras cover London. Select the London saved view to explore them.",
            );
        }
      })
      .catch((e) => {
        if (!isAbort(e)) message("Camera catalog could not be loaded.");
      });
    return () => ac.abort();
  }, [wantCameras, refresh, message]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input,textarea,select,dialog")) return;
      if (
        e.key === "/" ||
        (e.metaKey && e.key === "k") ||
        (e.ctrlKey && e.key === "k")
      ) {
        e.preventDefault();
        setSearch(true);
      }
      if (e.key === "Escape") {
        setFocus(null);
        setExportMenu(false);
        setMobileLayers(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  const allEvents = useMemo(
    () => [...(snapshot?.events ?? []), ...(aviation?.payload.events ?? [])],
    [snapshot, aviation],
  );
  const filtered = useMemo(
    () => filteredEvents(allEvents, hours, enabled, minimum, now, end),
    [allEvents, hours, enabled, minimum, Math.floor(now / 10000), end],
  );
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of filteredEvents(allEvents, hours, ALL, 0, now))
      c[e.kind] = (c[e.kind] ?? 0) + 1;
    return c;
  }, [allEvents, hours, Math.floor(now / 30000)]);
  const feed = useMemo(
    () =>
      filtered
        .filter(
          (e) =>
            ![
              "camera",
              "aircraft",
              "satellite",
              "space",
              "news",
              "cyber",
            ].includes(e.kind),
        )
        .sort(
          (a, b) =>
            (severityRank[b.severity] ?? 0) - (severityRank[a.severity] ?? 0) ||
            Date.parse(b.occurred_at ?? "1970-01-01") -
              Date.parse(a.occurred_at ?? "1970-01-01"),
        ),
    [filtered],
  );
  function selectPlace(p: Place, fly = true) {
    setPlace(p);
    setFocus(null);
    setMobileLayers(false);
    if (fly) setPreset({ center: [p.lon, p.lat], zoom: 6, id: Date.now() });
  }
  function onMapPoint(lat: number, lon: number) {
    selectPlace(
      {
        lat,
        lon,
        name: `${lat.toFixed(3)}°, ${lon.toFixed(3)}°`,
        country: "Map-selected location",
        countryCode: "",
      },
      false,
    );
  }
  function toggle(kinds: Kind[]) {
    setEnabled((old) => {
      const next = new Set(old);
      const all = kinds.some((k) => next.has(k));
      for (const k of kinds) all ? next.delete(k) : next.add(k);
      return next;
    });
    setQuick("custom");
  }
  function region(id: string) {
    setView("overview");
    setMobileLayers(false);
    setFocus(null);
    if (id === "global") {
      setPreset({ center: [28, 20], zoom: 1.7, id: Date.now() });
      return;
    }
    if (id === "india") {
      selectPlace(DEFAULT_PLACE, false);
      setPreset({ center: [79, 23], zoom: 4, id: Date.now() });
    }
    if (id === "pacific") {
      selectPlace(
        {
          name: "Tokyo region",
          lat: 35.68,
          lon: 139.69,
          country: "Japan",
          countryCode: "JP",
        },
        false,
      );
      setPreset({ center: [154, 17], zoom: 2.25, id: Date.now() });
    }
    if (id === "london") {
      selectPlace(
        {
          name: "London",
          lat: 51.5074,
          lon: -0.1278,
          country: "United Kingdom",
          countryCode: "GB",
        },
        false,
      );
      setPreset({ center: [-0.13, 51.51], zoom: 10, id: Date.now() });
      setEnabled((old) => new Set([...old, "camera"]));
    }
  }
  function quickFilter(q: string) {
    setQuick(q);
    setEnabled(
      new Set<Kind>(
        q === "all"
          ? NATURAL
          : q === "seismic"
            ? ["earthquake"]
            : q === "thermal"
              ? ["fire"]
              : ["weather", "storm", "flood", "drought", "volcano", "other"],
      ),
    );
  }
  function inspect(id: string) {
    if (!snapshot?.sources.some((s) => s.id === id)) {
      message("The source registry is loading. Try again shortly.");
      return;
    }
    setSourceId(id);
  }
  function showReport() {
    setView("intelligence");
    setTab("soil");
    setMobileLayers(false);
  }
  async function analyzeArea(geometry: GeoPolygon) {
    setAreaModal(true);
    setAreaLoading(true);
    setAreaError("");
    setArea(null);
    try {
      const result = await api<AreaReport>("/api/v1/aoi", {
        method: "POST",
        body: JSON.stringify({ geometry, hours, kinds: [...enabled] }),
      });
      setArea(result);
    } catch (e) {
      setAreaError(e instanceof Error ? e.message : "Area analysis failed");
    } finally {
      setAreaLoading(false);
    }
  }
  function saveView() {
    if (!viewName.trim()) return;
    const wrap = (n: number) => ((((n + 180) % 360) + 360) % 360) - 180;
    const w = wrap(place.lon - 1),
      e = wrap(place.lon + 1),
      s = Math.max(-90, place.lat - 1),
      n = Math.min(90, place.lat + 1);
    setSaved((old) => [
      ...old.slice(-5),
      {
        place: { ...place },
        name: viewName.trim().slice(0, 60),
        center: [place.lon, place.lat],
        zoom: 7,
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [w, s],
              [e, s],
              [e, n],
              [w, n],
              [w, s],
            ],
          ],
        },
      },
    ]);
    setSaveModal(false);
    message("Selected location saved in this browser.");
  }
  function doExport(format: "json" | "csv" | "geojson") {
    exportEvents(filtered, format, {
      generated_at: new Date().toISOString(),
      snapshot_at: snapshot?.generated_at,
      hours,
      selected_layers: [...enabled],
      minimum_priority: minimum,
      source_catalog: snapshot?.sources,
      notice:
        "Filtered public observations, not unique incidents or complete coverage. Timeline is event-time filtering, not archived snapshots.",
    });
    setExportMenu(false);
    message(
      `Exported ${filtered.length} filtered observations as ${format.toUpperCase()}.`,
    );
  }
  const source = snapshot?.sources.find((s) => s.id === sourceId);
  const healthy =
    snapshot?.sources.filter((s) =>
      ["fresh", "empty"].includes(s.health.status),
    ).length ?? 0;
  return (
    <div className="app-shell">
      <header className="topbar">
        <button
          className="brand"
          onClick={() => setView("overview")}
          aria-label="ATLAS overview"
        >
          <Logo />
          <span>
            <b>ATLAS</b>
            <small>EARTH INTELLIGENCE</small>
          </span>
        </button>
        <nav className="main-nav" aria-label="Main navigation">
          {[
            ["overview", "Overview"],
            ["intelligence", "Intelligence"],
            ["sources", "Data sources"],
          ].map(([id, label]) => (
            <button
              key={id}
              className={view === id ? "active" : ""}
              onClick={() => setView(id as typeof view)}
            >
              {label}
              {id === "sources" && (
                <span>{snapshot?.sources.length ?? 23}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="topbar-right">
          <button
            className="global-search"
            aria-label="Search the planet"
            onClick={() => setSearch(true)}
          >
            <Search size={14} />
            <span>Search the planet…</span>
            <kbd>
              <Command size={10} /> K
            </kbd>
          </button>
          <div className={`system-live ${snapshotError ? "disconnected" : ""}`}>
            <i />
            {snapshotError ? "RECONNECTING" : "SYSTEM ONLINE"}
          </div>
          <div className="utc-clock">
            <span>UTC</span>
            {new Date(now).toLocaleTimeString("en-GB", { timeZone: "UTC" })}
          </div>
          <button
            className="avatar"
            title="Workspace settings"
            onClick={() => setSettings(true)}
          >
            A
          </button>
        </div>
      </header>
      <div className="app-body">
        <nav className="rail" aria-label="Workspace tools">
          <div>
            <IconButton
              label="Global map"
              active={view === "overview"}
              onClick={() => setView("overview")}
            >
              <Globe2 size={20} />
            </IconButton>
            <IconButton
              label="Layers and regions"
              active={mobileLayers}
              onClick={() => {
                setView("overview");
                setMobileLayers((v) => !v);
              }}
            >
              <Layers3 size={19} />
            </IconButton>
            <IconButton
              label="Evidence and analytics"
              active={view === "intelligence"}
              onClick={() => {
                setView("intelligence");
                setTab("brief");
              }}
            >
              <Activity size={19} />
            </IconButton>
            <IconButton
              label="Save selected location"
              onClick={() => {
                setViewName(place.name);
                setSaveModal(true);
              }}
            >
              <Bookmark size={18} />
            </IconButton>
            <IconButton
              label="Data source registry"
              active={view === "sources"}
              onClick={() => setView("sources")}
            >
              <Database size={19} />
            </IconButton>
          </div>
          <div>
            <IconButton
              label="About this workspace"
              onClick={() => setAbout(true)}
            >
              <Info size={18} />
            </IconButton>
            <IconButton
              label="Workspace settings"
              onClick={() => setSettings(true)}
            >
              <Settings2 size={19} />
            </IconButton>
            <span className="rail-version">v1.0</span>
          </div>
        </nav>
        <div className={`sidebar-wrapper ${mobileLayers ? "mobile-open" : ""}`}>
          <Sidebar
            snapshot={snapshot}
            counts={counts}
            enabled={enabled}
            onToggle={toggle}
            onRegion={region}
            place={place}
            minimum={minimum}
            onMinimum={setMinimum}
            saved={saved}
            onSaved={(s) => {
              setView("overview");
              selectPlace(
                {
                  name: s.name,
                  lat: s.center[1],
                  lon: s.center[0],
                  country: s.place?.country ?? "Saved location",
                  countryCode: s.place?.countryCode ?? "",
                },
                false,
              );
              setPreset({ center: s.center, zoom: s.zoom, id: Date.now() });
            }}
            onSave={() => {
              setViewName(place.name);
              setSaveModal(true);
            }}
            onSources={() => setView("sources")}
            onAbout={() => setAbout(true)}
            view={view}
          />
        </div>
        <div className="workspace-main">
          {snapshotError && (
            <div className="connection-banner">
              <Radio size={13} />
              {snapshotError}. Last received data may be outdated.
              <button
                onClick={() => {
                  void refresh();
                }}
              >
                Retry
              </button>
              <button onClick={() => setSettings(true)}>Access settings</button>
            </div>
          )}
          {view === "overview" ? (
            <>
              <div className="overview-toolbar">
                <div className="breadcrumbs">
                  <Globe2 size={13} />
                  <span>Earth systems</span>
                  <ChevronRight size={12} />
                  <b>Live overview</b>
                </div>
                <div className="overview-actions">
                  <button
                    className="mobile-layer-button"
                    onClick={() => setMobileLayers((v) => !v)}
                  >
                    <SlidersHorizontal size={14} />
                    Layers
                  </button>
                  <span className="observation-count">
                    <i />
                    {compact(filtered.filter((e) => e.point).length)} mapped
                  </span>
                  <div className="export-dropdown">
                    <button
                      className="toolbar-button"
                      onClick={() => setExportMenu((v) => !v)}
                    >
                      <Download size={13} />
                      Export
                      <ChevronDown size={12} />
                    </button>
                    {exportMenu && (
                      <div className="export-menu">
                        <span className="eyebrow">CURRENT FILTERED VIEW</span>
                        {(["geojson", "json", "csv"] as const).map((f) => (
                          <button onClick={() => doExport(f)} key={f}>
                            <FileText size={14} />
                            {f === "geojson"
                              ? "GeoJSON for GIS"
                              : f === "json"
                                ? "JSON with provenance"
                                : "CSV spreadsheet"}
                            <ArrowUpRight size={12} />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <IconButton
                    label="Refresh current snapshot (provider cache rules still apply)"
                    onClick={() => {
                      void refresh();
                      message(
                        "Snapshot refreshed. Provider cache and rate limits remain in effect.",
                      );
                    }}
                  >
                    <RefreshCw size={14} />
                  </IconButton>
                </div>
              </div>
              <div className="overview-content">
                <div className="map-column">
                  <div className="map-filter-bar">
                    <div className="map-filter-tabs">
                      {[
                        ["all", "All systems"],
                        ["seismic", "Seismic"],
                        ["thermal", "Thermal"],
                        ["weather", "Atmosphere"],
                      ].map(([id, label]) => (
                        <button
                          className={quick === id ? "active" : ""}
                          key={id}
                          onClick={() => quickFilter(id)}
                        >
                          {id === "all" ? (
                            <Layers3 size={12} />
                          ) : (
                            <i
                              style={{
                                background:
                                  id === "seismic"
                                    ? COLORS.earthquake
                                    : id === "thermal"
                                      ? COLORS.fire
                                      : COLORS.weather,
                              }}
                            />
                          )}
                          {label}
                        </button>
                      ))}
                    </div>
                    <span className="map-projection-label">
                      <span />
                      PUBLIC DATA
                    </span>
                  </div>
                  <MapView
                    key={authVersion}
                    events={filtered}
                    place={place}
                    focus={focus}
                    preset={preset}
                    onPoint={onMapPoint}
                    onEvent={setFocus}
                    onArea={analyzeArea}
                    onMessage={message}
                  />
                  <Timeline
                    events={allEvents}
                    hours={hours}
                    onHours={setHours}
                    end={end}
                    onEnd={setEnd}
                  />
                </div>
                <RightPanel
                  place={place}
                  location={location}
                  loading={locationLoading}
                  error={locationError}
                  events={feed}
                  focus={focus}
                  onEvent={setFocus}
                  onBack={() => setFocus(null)}
                  onAnalyzeEvent={() => {
                    if (focus?.point)
                      onMapPoint(focus.point.lat, focus.point.lon);
                  }}
                  onReport={showReport}
                  snapshot={snapshot}
                />
              </div>
            </>
          ) : view === "sources" ? (
            <Sources sources={snapshot?.sources ?? []} onInspect={inspect} />
          ) : (
            <Intelligence
              key={`${place.lat},${place.lon}`}
              tab={tab}
              onTab={setTab}
              snapshot={snapshot}
              location={location}
              place={place}
              onLocation={() => setSearch(true)}
              onSource={inspect}
              onMessage={message}
            />
          )}
          <footer className="statusbar">
            <span>
              <i
                className={snapshotError ? "status-dot amber" : "status-dot"}
              />
              {healthy} sources responding
              <span className="status-separator">/</span>Bounded live ingestion
            </span>
            <span className="status-middle">
              OBSERVATION ≠ PREDICTION<span>·</span>Always verify official
              warnings.
            </span>
            <button onClick={() => setAbout(true)}>
              TerraWatch × OSIRIS
              <ArrowUpRight size={11} />
            </button>
          </footer>
        </div>
      </div>
      {search && (
        <SearchModal
          onClose={() => setSearch(false)}
          onSelect={(p) => {
            selectPlace(p);
            setView("overview");
          }}
        />
      )}
      {about && (
        <Modal
          title="A clearer view of a complex planet."
          onClose={() => setAbout(false)}
          wide
        >
          <div className="about-brand">
            <Logo />
            <span>
              ATLAS <small>Earth Intelligence</small>
            </span>
          </div>
          <p className="modal-description">
            A provenance-first integration of TerraWatch’s environmental
            analysis and OSIRIS’s multi-source geospatial workspace. Rebuilt
            with a shared data model, bounded ingestion and explicit
            uncertainty—not a blind copy-and-paste merge.
          </p>
          <div className="about-grid">
            <div>
              <ShieldCheck />
              <h3>Evidence before confidence</h3>
              <p>
                Observed, modeled, forecast, catalog and publisher data remain
                distinct. No fake coordinates or invented live fallback values.
              </p>
            </div>
            <div>
              <Database />
              <h3>One provider contract</h3>
              <p>
                Fetch time, upstream time, source URL, licensing, stale state
                and geographic scope travel with the data.
              </p>
            </div>
            <div>
              <Layers3 />
              <h3>Useful, not omniscient</h3>
              <p>
                Satellite detections are not confirmed fires. River discharge is
                not a flood prediction. Missing data is not an all-clear.
              </p>
            </div>
          </div>
          <Note tone="warning">
            This research and situational-awareness workspace is not an
            emergency warning, flight navigation, engineering, medical or
            agronomic decision system. Follow relevant authorities and qualified
            local professionals.
          </Note>
          <div className="button-row">
            <ExternalLink
              className="button"
              url="https://huggingface.co/spaces/teaphile/terrawatch"
            >
              TerraWatch source
            </ExternalLink>
            <ExternalLink
              className="button"
              url="https://github.com/simplifaisoul/osiris"
            >
              OSIRIS source
            </ExternalLink>
            <a
              className="button"
              href="/docs"
              target="_blank"
              rel="noopener noreferrer"
            >
              API reference
              <ArrowUpRight size={14} />
            </a>
          </div>
          <p className="modal-footnote">
            Natural Earth public-domain fallback map · OpenFreeMap /
            OpenMapTiles / OpenStreetMap basemap · NASA GIBS imagery. No visitor
            analytics or personal identification.
          </p>
        </Modal>
      )}
      {settings && (
        <Modal
          title="Your workspace. Your boundaries."
          onClose={() => setSettings(false)}
        >
          <div className="settings-section">
            <h3>
              <KeyRound size={17} />
              Private deployment access
            </h3>
            <p className="muted">
              Only needed if your server requires <code>X-Atlas-Key</code>. This
              access key stays in memory for the current page, not local
              storage.
            </p>
            <input
              className="text-input"
              type="password"
              autoComplete="off"
              placeholder="Deployment access key (optional)"
              value={accessKey}
              onChange={(e) => setAccessKey(e.target.value)}
            />
            <button
              className="button"
              onClick={() => {
                setDeploymentKey(accessKey);
                setAuthVersion((v) => v + 1);
                message("Deployment access updated for this page session.");
                setSettings(false);
              }}
            >
              Apply access key
              <Check size={14} />
            </button>
          </div>
          <div className="settings-section">
            <h3>
              <Database size={17} />
              Optional NASA FIRMS Area API
            </h3>
            <p className="muted">
              Public NOAA-20 South Asia detections already work without an
              account. For arbitrary-area queries, request a free MAP_KEY and
              set it on the server:
            </p>
            <pre className="config-code">
              ATLAS_FIRMS_MAP_KEY=your_server_side_key
            </pre>
            <ExternalLink
              className="text-link"
              url="https://firms.modaps.eosdis.nasa.gov/api/map_key/"
            >
              Get a free NASA FIRMS key
            </ExternalLink>
          </div>
          <div className="settings-section">
            <h3>
              <Bookmark size={17} />
              Saved views
            </h3>
            <p className="muted">
              {saved.length} view(s) stored only in this browser. No account or
              remote synchronization.
            </p>
            <button
              className="button"
              onClick={() => {
                setSaved([]);
                message("Local saved views cleared.");
              }}
            >
              Clear local saved views
            </button>
          </div>
          <Note>
            Free does not automatically mean commercial or unrestricted. Review
            each source’s licensing and quotas before deployment.
          </Note>
        </Modal>
      )}
      {source && (
        <SourceModal
          key={source.id}
          source={source}
          place={place}
          onClose={() => setSourceId(null)}
          onMessage={message}
        />
      )}
      {saveModal && (
        <Modal
          title="Save this perspective"
          onClose={() => setSaveModal(false)}
        >
          <p className="modal-description">
            Save the selected location, {num(place.lat, 4)}, {num(place.lon, 4)}
            , as a navigation view. No new data is collected.
          </p>
          <label className="form-label">
            VIEW NAME
            <input
              autoFocus
              className="text-input"
              maxLength={60}
              value={viewName}
              onChange={(e) => setViewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveView();
              }}
            />
          </label>
          <button
            className="button button-primary full-width"
            onClick={saveView}
            disabled={!viewName.trim()}
          >
            <Bookmark size={15} />
            Save location view
          </button>
          <p className="modal-footnote">
            Up to six views are retained locally. Oldest is replaced when full.
          </p>
        </Modal>
      )}
      {areaModal && (
        <Modal
          title="Your area, in evidence."
          onClose={() => setAreaModal(false)}
          wide
        >
          {areaLoading ? (
            <Spinner label="Validating polygon and testing observation membership…" />
          ) : areaError ? (
            <Note tone="warning">{areaError}</Note>
          ) : (
            area && (
              <>
                <div className="area-stats">
                  <div>
                    <span>Approximate spherical area</span>
                    <strong>
                      {num(area.area_km2_spherical, 0)}
                      <small>km²</small>
                    </strong>
                  </div>
                  <div>
                    <span>Mapped records inside</span>
                    <strong>{num(area.event_count, 0)}</strong>
                  </div>
                  <div>
                    <span>Contributing source IDs</span>
                    <strong>{area.source_ids.length}</strong>
                  </div>
                </div>
                <div className="area-breakdown">
                  {Object.entries(area.by_kind).map(([k, v]) => (
                    <div key={k}>
                      <i style={{ background: COLORS[k as Kind] }} />
                      <span>{k.replaceAll("_", " ")}</span>
                      <strong>{num(v, 0)}</strong>
                    </div>
                  ))}
                </div>
                <Note>
                  {area.scope} Regional aircraft are client-scoped and excluded
                  from this server-side report.
                </Note>
                <Note>
                  {area.unlocated_records_excluded} unlocated records were
                  excluded. Empty results do not prove absence of hazards.
                </Note>
                <div className="button-row">
                  <button
                    className="button button-primary"
                    onClick={() =>
                      download(
                        "atlas-area-report.json",
                        JSON.stringify(area, null, 2),
                      )
                    }
                  >
                    <Download size={14} />
                    Export area report
                  </button>
                  <button
                    className="button"
                    onClick={() =>
                      download(
                        "atlas-area.geojson",
                        JSON.stringify(
                          {
                            type: "Feature",
                            geometry: area.geometry,
                            properties: {
                              area_km2: area.area_km2_spherical,
                              event_count: area.event_count,
                              source_ids: area.source_ids,
                            },
                          },
                          null,
                          2,
                        ),
                      )
                    }
                  >
                    <Layers3 size={14} />
                    Export area geometry
                  </button>
                </div>
                <div className="modal-footnote">
                  Boundary points count as inside. Polygon holes and date-line
                  crossing are supported. This is point membership, not raster
                  zonal statistics or exposure modeling.
                </div>
              </>
            )
          )}
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <Info size={15} />
          <span>{toast}</span>
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
