export type Kind =
  | "earthquake"
  | "fire"
  | "storm"
  | "flood"
  | "volcano"
  | "drought"
  | "weather"
  | "aircraft"
  | "camera"
  | "satellite"
  | "space"
  | "news"
  | "cyber"
  | "other";
export type Health =
  | "fresh"
  | "stale"
  | "empty"
  | "unavailable"
  | "disabled"
  | "idle"
  | "refreshing";
export interface Point {
  lat: number;
  lon: number;
}
export interface Place extends Point {
  name: string;
  country: string;
  countryCode: string;
}
export interface AtlasEvent {
  id: string;
  source_id: string;
  source_record_id: string;
  kind: Kind;
  title: string;
  description: string;
  point: Point | null;
  occurred_at: string | null;
  updated_at: string | null;
  expires_at: string | null;
  severity: string;
  nature: string;
  url: string;
  attributes: Record<string, any>;
}
export interface Envelope {
  source_id: string;
  status: Health;
  fetched_at: string | null;
  checked_at: string | null;
  upstream_time: string | null;
  age_seconds: number | null;
  latency_ms: number | null;
  error_code: string | null;
  warnings: string[];
  payload: {
    events: AtlasEvent[];
    data: Record<string, any>;
    record_count: number;
    warnings: string[];
  };
  analysis?: SoilSummary;
}
export interface Source {
  id: string;
  name: string;
  provider: string;
  category: string;
  scope: string;
  nature: string;
  coverage: string;
  ttl_seconds: number;
  max_stale_seconds: number;
  docs_url: string;
  attribution: string;
  license_note: string;
  description: string;
  key_env: string | null;
  enabled_by_default: boolean;
  health: Omit<Envelope, "payload">;
  record_count: number;
}
export interface Snapshot {
  generated_at: string;
  revision: number;
  events: AtlasEvent[];
  sources: Source[];
  summary: {
    record_count: number;
    mapped_count: number;
    by_kind: Record<string, number>;
    fresh_feeds: number;
    loaded_feeds: number;
  };
  context: Record<string, any>;
  limitations: string[];
}
export interface Signal {
  id: string;
  label: string;
  value: number | null;
  unit: string;
  weight: number;
  source_id: string;
  score: number | null;
}
export interface Screening {
  score: number | null;
  label: string;
  coverage: number;
  signals: Signal[];
  missing_data_bounds: number[];
  rainfall_hours_available: number;
  validation: string;
  interpretation: string;
  bounds_interpretation: string;
  limitations: string[];
  version: string;
}
export interface SoilSummary {
  ph: number | null;
  ph_interpretation: string | null;
  texture_description: string | null;
  carbon_stock_0_30cm_t_ha: number | null;
  carbon_method: string;
  crop_ph_screen: {
    crop: string;
    ph_fit: string;
    range: number[];
    distance: number;
  }[];
  caveat: string;
}
export interface LocationData {
  point: Point;
  generated_at: string;
  sources: Record<string, Envelope>;
  screening: Screening;
  soil_summary: SoilSummary;
  nearby_events: { event: AtlasEvent; distance_km: number }[];
  nearby_method: string;
}
export interface GeoPolygon {
  type: "Polygon";
  coordinates: number[][][];
}
export interface AreaReport {
  geometry: GeoPolygon;
  area_km2_spherical: number;
  event_count: number;
  by_kind: Record<string, number>;
  source_ids: string[];
  events: AtlasEvent[];
  unlocated_records_excluded: number;
  generated_at: string;
  scope: string;
}
export interface SavedArea {
  place?: Place;
  name: string;
  geometry: GeoPolygon;
  center: [number, number];
  zoom: number;
}
export interface GeocodingResult {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  country: string;
  country_code: string;
  admin1: string;
}
export interface Fusion {
  groups: {
    anchor_id: string;
    kind: Kind;
    record_count: number;
    source_ids: string[];
    event_ids: string[];
    point: Point;
    title: string;
  }[];
  comparisons: number;
  budget_exhausted: boolean;
  radius_km: number;
  window_seconds: number;
  meaning: string;
}
