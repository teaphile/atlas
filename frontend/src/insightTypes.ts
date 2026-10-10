export interface WindowSummary {
  hours: number;
  start: string;
  end: string;
  expected_hours: number;
  mean_temperature_c: number | null;
  max_temperature_c: number | null;
  precipitation_mm: number | null;
  reference_et0_mm: number | null;
  reference_balance_mm: number | null;
  gdd_c_day: number | null;
  max_vpd_kpa: number | null;
  max_wind_kmh: number | null;
  max_us_aqi: number | null;
  coverage: Record<string, number>;
}
export interface InsightReport {
  version: string;
  generated_at: string;
  as_of: string;
  status: string;
  nature: string;
  point: { lat: number; lon: number };
  forecast_start: string;
  forecast_end: string;
  current: {
    dewpoint_c: number | null;
    vpd_kpa: number | null;
    input_time: string | null;
  };
  thermal_parameters: { base_c: number; cap_c: number; method: string };
  series: { time: string[] } & Record<string, any>;
  units: Record<string, string>;
  windows: WindowSummary[];
  wind_rose: {
    bins: {
      direction: string;
      degrees: number;
      hours: number;
      mean_kmh: number | null;
    }[];
    calm_hours: number;
    missing_hours: number;
    expected_hours: number;
    meaning: string;
  };
  correlations: {
    x: string;
    y: string;
    rho: number | null;
    pairs: number;
    reason: string | null;
  }[];
  novelty: {
    status: string;
    method: string;
    training_samples: number;
    minimum_samples: number;
    training_start?: string;
    training_end?: string;
    features?: string[];
    shrinkage?: number;
    parameter_count?: number;
    serialized_parameter_bytes?: number;
    limitations: string[];
  };
  trends: Record<
    string,
    {
      slope_per_day: number | null;
      samples: number;
      direction: string;
      method?: string;
    }
  >;
  quality: {
    history_hours: number;
    weather_usable: boolean;
    air_usable: boolean;
    forecast_coverage: Record<string, number>;
    normalization: Record<string, unknown>;
  };
  provenance: Record<
    string,
    {
      provider: string;
      docs_url: string;
      attribution: string;
      license_note: string;
      grid: {
        latitude: number | null;
        longitude: number | null;
        elevation: number | null;
      };
      status: string;
      fetched_at: string | null;
      model_time: string | null;
    }
  >;
  limitations: string[];
}
