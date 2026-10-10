import type { AtlasEvent, Kind } from "./types";
export const COLORS: Record<Kind, string> = {
  earthquake: "#ffbd72",
  fire: "#f77e65",
  storm: "#aa9ff5",
  flood: "#71bde6",
  volcano: "#ed9379",
  drought: "#d7b685",
  weather: "#aaa5f5",
  aircraft: "#7acbe2",
  camera: "#96b4ca",
  satellite: "#cf9cef",
  space: "#cf9cef",
  news: "#95bbb8",
  cyber: "#86b4bf",
  other: "#99b7c3",
};
export const LABELS: Record<Kind, string> = {
  earthquake: "Earthquake",
  fire: "Thermal anomaly",
  storm: "Severe storm",
  flood: "Flood report",
  volcano: "Volcanic event",
  drought: "Drought",
  weather: "Weather warning",
  aircraft: "Aircraft",
  camera: "Public camera",
  satellite: "Space asset",
  space: "Space weather",
  news: "Headline",
  cyber: "Cyber advisory",
  other: "Natural event",
};
export const severityRank: Record<string, number> = {
  critical: 5,
  high: 4,
  moderate: 3,
  low: 2,
  info: 1,
  unknown: 0,
};
export const num = (v: unknown, d = 1) =>
  typeof v === "number" && Number.isFinite(v)
    ? v.toLocaleString("en-US", { maximumFractionDigits: d })
    : "—";
export const compact = (v: number) =>
  new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(v);
export function ago(iso: string | null, now = Date.now()) {
  if (!iso) return "Time unknown";
  const seconds = (now - new Date(iso).getTime()) / 1000;
  if (!Number.isFinite(seconds)) return "Time unknown";
  if (seconds < -60) return "Future-dated";
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
export const dateLabel = (s: string | null) =>
  s
    ? new Date(s).toLocaleString("en-GB", {
        timeZone: "UTC",
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }) + " UTC"
    : "Not supplied";
export function parseCoordinates(
  q: string,
): { lat: number; lon: number } | null {
  const match = q.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const lat = Number(match[1]),
    lon = Number(match[2]);
  return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180
    ? { lat, lon }
    : null;
}
export function filteredEvents(
  events: AtlasEvent[],
  hours: number,
  enabled: Set<Kind>,
  minimum = 0,
  now = Date.now(),
  end: number | null = null,
) {
  const cutoff = now - hours * 3600000;
  return events.filter((e) => {
    if (!enabled.has(e.kind) || (severityRank[e.severity] ?? 0) < minimum)
      return false;
    const expiry = e.expires_at ? Date.parse(e.expires_at) : null;
    if (expiry && expiry <= now) return false;
    const t = e.occurred_at ? Date.parse(e.occurred_at) : null;
    if (e.nature !== "catalog" && t && t < cutoff && !(expiry && expiry > now))
      return false;
    if (t && t > now + 3600000 && e.nature !== "forecast") return false;
    if (end && t && t > end) return false;
    // Position snapshots expire faster than archived incident catalogs.
    if (e.kind === "aircraft" && (!t || now - t > 180000)) return false;
    if (e.kind === "satellite" && (!t || now - t > 120000)) return false;
    return true;
  });
}
export function histogram(
  events: AtlasEvent[],
  hours: number,
  bins = 48,
  now = Date.now(),
) {
  const counts = new Array<number>(bins).fill(0);
  const start = now - hours * 3600000;
  for (const e of events) {
    if (
      !e.occurred_at ||
      ["camera", "news", "cyber", "aircraft", "satellite", "space"].includes(
        e.kind,
      )
    )
      continue;
    const t = Date.parse(e.occurred_at);
    const i = Math.floor(((t - start) / (hours * 3600000)) * bins);
    if (i >= 0 && i < bins) counts[i]++;
  }
  return counts;
}
export function download(
  name: string,
  content: string,
  type = "application/json",
) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export function exportEvents(
  events: AtlasEvent[],
  format: "json" | "csv" | "geojson",
  metadata: Record<string, unknown>,
) {
  if (format === "csv") {
    const safe = (value: unknown) => {
      let s = String(value ?? "");
      if (typeof value === "string" && /^[\s]*[=+@\-\t\r]/.test(s)) s = "'" + s;
      return '"' + s.replaceAll('"', '""') + '"';
    };
    const fields = [
      "id",
      "kind",
      "source_id",
      "title",
      "latitude",
      "longitude",
      "occurred_at",
      "nature",
      "severity",
      "url",
    ];
    const rows = events.map((e) =>
      [
        e.id,
        e.kind,
        e.source_id,
        e.title,
        e.point?.lat,
        e.point?.lon,
        e.occurred_at,
        e.nature,
        e.severity,
        e.url,
      ]
        .map(safe)
        .join(","),
    );
    download(
      "atlas-observations.csv",
      [fields.join(","), ...rows].join("\r\n"),
      "text/csv",
    );
    return;
  }
  const data =
    format === "geojson"
      ? {
          type: "FeatureCollection",
          features: events.map((e) => ({
            type: "Feature",
            id: e.id,
            geometry: e.point
              ? { type: "Point", coordinates: [e.point.lon, e.point.lat] }
              : null,
            properties: { ...e, point: undefined },
          })),
          metadata,
        }
      : { metadata, events };
  download(`atlas-observations.${format}`, JSON.stringify(data, null, 2));
}
export function aqiLabel(v: unknown) {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0)
    return "Unavailable";
  return v <= 50
    ? "Good"
    : v <= 100
      ? "Moderate"
      : v <= 150
        ? "Sensitive groups"
        : v <= 200
          ? "Unhealthy"
          : v <= 300
            ? "Very unhealthy"
            : "Hazardous";
}
export function weatherLabel(code: unknown) {
  if (code === 0) return "Clear skies";
  if (
    typeof code !== "number" ||
    !Number.isInteger(code) ||
    code < 0 ||
    code > 99
  )
    return "Model unavailable";
  if (code <= 3) return "Partly cloudy";
  if (code <= 48) return "Foggy";
  if (code <= 57) return "Drizzle";
  if (code <= 67) return "Rain";
  if (code <= 77) return "Snow";
  if (code <= 86) return "Showers";
  return "Thunderstorms";
}
