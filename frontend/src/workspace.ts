import type { Place, SavedArea, GeoPolygon, Kind } from "./types";
import { COLORS } from "./utils";
export type UnitSystem = "metric" | "imperial";
export interface Preferences {
  units: UnitSystem;
  motion: "system" | "reduce";
  density: "comfortable" | "compact";
}
export const DEFAULT_PREFS: Preferences = {
  units: "metric",
  motion: "system",
  density: "comfortable",
};
const obj = (v: unknown): v is Record<string, any> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const finite = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
const text = (v: unknown, max: number) =>
  typeof v === "string" && v.trim().length > 0 && v.length <= max;
export function parsePreferences(v: unknown): Preferences {
  if (
    !obj(v) ||
    !["metric", "imperial"].includes(v.units) ||
    !["system", "reduce"].includes(v.motion) ||
    !["comfortable", "compact"].includes(v.density)
  )
    throw new Error("Invalid display preferences");
  return { units: v.units, motion: v.motion, density: v.density };
}
export function parsePlace(v: unknown): Place {
  if (
    !obj(v) ||
    !text(v.name, 120) ||
    !finite(v.lat, -90, 90) ||
    !finite(v.lon, -180, 180) ||
    typeof v.country !== "string" ||
    v.country.length > 120 ||
    typeof v.countryCode !== "string" ||
    !/^([A-Z]{2,3})?$/.test(v.countryCode)
  )
    throw new Error(
      "Invalid location: supply coordinates, a name and a valid country code or blank",
    );
  return {
    lat: v.lat,
    lon: v.lon,
    name: v.name.trim(),
    country: v.country,
    countryCode: v.countryCode,
  };
}
export function parsePolygon(input: unknown): GeoPolygon {
  let v = input;
  if (obj(v) && v.type === "Feature") v = v.geometry;
  if (
    !obj(v) ||
    v.type !== "Polygon" ||
    !Array.isArray(v.coordinates) ||
    v.coordinates.length < 1 ||
    v.coordinates.length > 4
  )
    throw new Error(
      "Import one GeoJSON Polygon (or a Polygon Feature), with at most three holes",
    );
  let vertices = 0;
  const coords: number[][][] = [];
  for (const ring of v.coordinates) {
    if (!Array.isArray(ring) || ring.length < 4)
      throw new Error(
        "Polygon rings must have at least four points and be closed",
      );
    vertices += ring.length;
    if (vertices > 200)
      throw new Error("Polygon is limited to 200 total vertices");
    const clean: number[][] = [];
    for (const p of ring) {
      if (
        !Array.isArray(p) ||
        p.length !== 2 ||
        !finite(p[0], -180, 180) ||
        !finite(p[1], -90, 90)
      )
        throw new Error(
          "Use finite [longitude, latitude] pairs in geographic bounds",
        );
      clean.push([p[0], p[1]]);
    }
    if (clean[0][0] !== clean.at(-1)![0] || clean[0][1] !== clean.at(-1)![1])
      throw new Error("Close each ring by repeating its first point");
    if (new Set(clean.map((p) => p.join(","))).size < 3)
      throw new Error("A polygon needs three distinct vertices");
    const unwrapped = clean.reduce<number[]>(
      (xs, p) => [
        ...xs,
        p[0] + (xs.length ? 360 * Math.round((xs.at(-1)! - p[0]) / 360) : 0),
      ],
      [],
    );
    if (Math.max(...unwrapped) - Math.min(...unwrapped) >= 180)
      throw new Error("Polygon must span less than 180° longitude");
    coords.push(clean);
  }
  return { type: "Polygon", coordinates: coords };
}
export function parseSaved(input: unknown): SavedArea[] {
  if (!Array.isArray(input) || input.length > 6)
    throw new Error("At most six saved places are supported");
  return input.map((v) => {
    if (
      !obj(v) ||
      !text(v.name, 60) ||
      !Array.isArray(v.center) ||
      v.center.length !== 2 ||
      !finite(v.center[0], -180, 180) ||
      !finite(v.center[1], -90, 90) ||
      !finite(v.zoom, 0, 15)
    )
      throw new Error("Invalid saved view");
    const place = v.place
      ? parsePlace(v.place)
      : {
          name: v.name,
          country: "",
          countryCode: "",
          lat: v.center[1],
          lon: v.center[0],
        };
    return {
      name: v.name.trim(),
      center: [v.center[0], v.center[1]] as [number, number],
      zoom: v.zoom,
      place,
      geometry: parsePolygon(v.geometry),
    };
  });
}
export interface Workspace {
  schema: "atlas-workspace";
  version: 2;
  exported_at: string;
  place: Place;
  saved: SavedArea[];
  geometry: GeoPolygon | null;
  filters: { kinds: Kind[]; hours: number; minimum: number };
  preferences: Preferences;
}
export function parseWorkspace(raw: string): Workspace {
  if (new TextEncoder().encode(raw).length > 65536)
    throw new Error("Workspace file exceeds 64 KiB");
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    throw new Error("This is not valid JSON");
  }
  if (!obj(v) || v.schema !== "atlas-workspace" || v.version !== 2)
    throw new Error("Expected an ATLAS version 2 workspace");
  const f = v.filters;
  if (
    !obj(f) ||
    !Array.isArray(f.kinds) ||
    f.kinds.length > 20 ||
    !f.kinds.every(
      (k: unknown) => typeof k === "string" && Object.hasOwn(COLORS, k),
    ) ||
    !finite(f.hours, 1, 720) ||
    !Number.isInteger(f.hours) ||
    !finite(f.minimum, 0, 5) ||
    !Number.isInteger(f.minimum)
  )
    throw new Error("Invalid layer or timeline filters");
  return {
    schema: "atlas-workspace",
    version: 2,
    exported_at:
      typeof v.exported_at === "string" ? v.exported_at.slice(0, 40) : "",
    place: parsePlace(v.place),
    saved: parseSaved(v.saved),
    geometry: v.geometry == null ? null : parsePolygon(v.geometry),
    filters: {
      kinds: [...new Set(f.kinds)] as Kind[],
      hours: f.hours,
      minimum: f.minimum,
    },
    preferences: parsePreferences(v.preferences),
  };
}
export function readSaved(): SavedArea[] {
  try {
    return parseSaved(
      JSON.parse(localStorage.getItem("atlas.views.v1") || "[]"),
    );
  } catch {
    return [];
  }
}
export function readPreferences(): Preferences {
  try {
    return parsePreferences(
      JSON.parse(localStorage.getItem("atlas.preferences.v2") || "null"),
    );
  } catch {
    return DEFAULT_PREFS;
  }
}
export function convert(
  value: number | null | undefined,
  key: string,
  units: UnitSystem,
): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (units === "metric") return value;
  if (
    [
      "temperature_c",
      "dewpoint_c",
      "mean_temperature_c",
      "max_temperature_c",
    ].includes(key)
  )
    return (value * 9) / 5 + 32;
  if (["wind_kmh", "gust_kmh", "max_wind_kmh"].includes(key))
    return value / 1.609344;
  if (
    ["precipitation_mm", "reference_et0_mm", "reference_balance_mm"].includes(
      key,
    )
  )
    return value / 25.4;
  return value;
}
export function unitFor(key: string, units: UnitSystem): string {
  if (
    [
      "temperature_c",
      "dewpoint_c",
      "mean_temperature_c",
      "max_temperature_c",
    ].includes(key)
  )
    return units === "metric" ? "°C" : "°F";
  if (["wind_kmh", "gust_kmh", "max_wind_kmh"].includes(key))
    return units === "metric" ? "km/h" : "mph";
  if (
    ["precipitation_mm", "reference_et0_mm", "reference_balance_mm"].includes(
      key,
    )
  )
    return units === "metric" ? "mm" : "in";
  return (
    (
      {
        humidity_pct: "%",
        pressure_hpa: "hPa",
        vpd_kpa: "kPa",
        max_vpd_kpa: "kPa",
        us_aqi: "US AQI",
        max_us_aqi: "US AQI",
        pm25_ugm3: "µg/m³",
        gdd_c_day: "°C·day",
        novelty_distance: "distance",
        novelty_rank_pct: "baseline %",
      } as Record<string, string>
    )[key] || ""
  );
}

/** Unwrap one local polygon for camera fitting; never alter its geographic data. */
export function polygonCameraBounds(
  polygon: GeoPolygon,
): [[number, number], [number, number]] {
  const xs: number[] = [],
    ys: number[] = [];
  for (const [x, y] of polygon.coordinates[0]) {
    xs.push(x + (xs.length ? 360 * Math.round((xs.at(-1)! - x) / 360) : 0));
    ys.push(Math.max(-85.05, Math.min(85.05, y)));
  }
  return [
    [Math.min(...xs), Math.min(...ys)],
    [Math.max(...xs), Math.max(...ys)],
  ];
}
