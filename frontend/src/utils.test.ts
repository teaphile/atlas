import { describe, it, expect, vi, afterEach } from "vitest";
import {
  parseCoordinates,
  filteredEvents,
  histogram,
  ago,
  num,
  aqiLabel,
  weatherLabel,
  exportEvents,
} from "./utils";
import type { AtlasEvent, Kind } from "./types";
const now = Date.UTC(2026, 9, 10, 6);
const iso = (age: number) => new Date(now - age).toISOString();
const event = (x: Partial<AtlasEvent> = {}): AtlasEvent => ({
  id: "test:1",
  source_id: "usgs",
  source_record_id: "1",
  kind: "earthquake",
  title: "OFFLINE TEST FIXTURE",
  description: "",
  point: { lat: 27, lon: 78 },
  occurred_at: iso(3600000),
  updated_at: null,
  expires_at: null,
  severity: "moderate",
  nature: "observation",
  url: "https://example.org",
  attributes: {},
  ...x,
});
const all = new Set<Kind>([
  "earthquake",
  "camera",
  "aircraft",
  "satellite",
  "weather",
  "cyber",
]);
afterEach(() => vi.unstubAllGlobals());
describe("coordinates", () => {
  it.each(["27.1,78.15", "-90,180", "90,-180"])("accepts %s", (s) =>
    expect(parseCoordinates(s)).not.toBeNull(),
  );
  it.each(["91,0", "0,181", "abc", "0,NaN", "0,Infinity", "1,2,3"])(
    "rejects %s",
    (s) => expect(parseCoordinates(s)).toBeNull(),
  );
});
describe("event time is not fetch time", () => {
  it("expires even without a provider refresh", () =>
    expect(
      filteredEvents([event({ expires_at: iso(1) })], 24, all, 0, now),
    ).toHaveLength(0));
  it("keeps currently active older warnings", () =>
    expect(
      filteredEvents(
        [
          event({
            occurred_at: iso(7 * 86400000),
            expires_at: iso(-3600000),
            nature: "bulletin",
          }),
        ],
        24,
        all,
        0,
        now,
      ),
    ).toHaveLength(1));
  it("keeps catalogs outside incident time windows", () =>
    expect(
      filteredEvents(
        [
          event({
            kind: "cyber",
            nature: "catalog",
            occurred_at: iso(100 * 86400000),
          }),
        ],
        24,
        all,
        0,
        now,
      ),
    ).toHaveLength(1));
  it("never lets stale aircraft masquerade as live positions", () =>
    expect(
      filteredEvents(
        [event({ kind: "aircraft", occurred_at: iso(181000) })],
        24,
        all,
        0,
        now,
      ),
    ).toHaveLength(0));
  it("expires ISS coordinates at 120 seconds", () =>
    expect(
      filteredEvents(
        [event({ kind: "satellite", occurred_at: iso(121000) })],
        24,
        all,
        0,
        now,
      ),
    ).toHaveLength(0));
  it("filters future-dated observations", () =>
    expect(
      filteredEvents([event({ occurred_at: iso(-7200000) })], 24, all, 0, now),
    ).toHaveLength(0));
  it("honors layer and display priority selection", () =>
    expect(
      filteredEvents([event()], 24, new Set<Kind>(["earthquake"]), 4, now),
    ).toHaveLength(0));
  it("timeline narrows event time, does not synthesize history", () =>
    expect(
      filteredEvents([event()], 24, all, 0, now, now - 7200000),
    ).toHaveLength(0));
  it("histogram excludes catalogs and missing event times", () =>
    expect(
      histogram(
        [
          event(),
          event({ kind: "camera", nature: "catalog" }),
          event({ occurred_at: null }),
        ],
        24,
        48,
        now,
      ).reduce((a, b) => a + b, 0),
    ).toBe(1));
});
describe("missing values remain unknown", () => {
  it("never formats missing as zero", () => {
    expect(num(null)).toBe("—");
    expect(num(NaN)).toBe("—");
    expect(num(0)).toBe("0");
  });
  it("does not invent issue times", () => {
    expect(ago(null, now)).toBe("Time unknown");
    expect(ago("garbage", now)).toBe("Time unknown");
    expect(ago(iso(-7200000), now)).toBe("Future-dated");
  });
  it("does not label invalid AQI safe or hazardous", () => {
    expect(aqiLabel(null)).toBe("Unavailable");
    expect(aqiLabel(NaN)).toBe("Unavailable");
    expect(aqiLabel(0)).toBe("Good");
  });
  it("does not label invalid weather sunny", () => {
    expect(weatherLabel(null)).toBe("Model unavailable");
    expect(weatherLabel(NaN)).toBe("Model unavailable");
    expect(weatherLabel(0)).toBe("Clear skies");
  });
});
it("CSV export neutralizes spreadsheet formulas and keeps negative numeric coordinates", async () => {
  let captured: Blob | undefined;
  vi.stubGlobal("window", { setTimeout: () => 0 });
  vi.stubGlobal("URL", {
    createObjectURL: (b: Blob) => {
      captured = b;
      return "blob:test";
    },
    revokeObjectURL: () => {},
  });
  vi.stubGlobal("document", {
    createElement: () => ({
      href: "",
      download: "",
      click: () => {},
      remove: () => {},
    }),
    body: { append: () => {} },
  });
  exportEvents(
    [
      event({
        title: '=HYPERLINK("https://example.org")',
        point: { lat: -27, lon: 78 },
      }),
    ],
    "csv",
    {},
  );
  const text = await captured!.text();
  expect(text).toContain("'=HYPERLINK");
  expect(text).toContain('"-27"');
});
it("Signal Lab CSV export neutralizes formula-prefixed string metadata while preserving negative numbers", async () => {
  const { exportInsights } = await import("./components/SignalLab");
  let captured: Blob | undefined;
  vi.stubGlobal("window", { setTimeout: () => 0 });
  vi.stubGlobal("URL", {
    createObjectURL: (b: Blob) => {
      captured = b;
      return "blob:test";
    },
    revokeObjectURL: () => {},
  });
  vi.stubGlobal("document", {
    createElement: () => ({
      href: "",
      download: "",
      click: () => {},
      remove: () => {},
    }),
    body: { append: () => {} },
  });
  exportInsights(
    {
      version: '=CMD|"/C calc"!A0',
      generated_at: "2026-10-18T00:00:00Z",
      as_of: "2026-10-18T00:00:00Z",
      status: "ok",
      nature: "model_derived",
      point: { lat: -33.8688, lon: 151.2093 },
      forecast_start: "2026-10-18T01:00:00Z",
      forecast_end: "2026-10-21T00:00:00Z",
      current: {
        dewpoint_c: -2.5,
        vpd_kpa: 0.8,
        input_time: "2026-10-18T00:00:00Z",
      },
      thermal_parameters: { base_c: 10, cap_c: 30, method: "endpoint" },
      series: {
        time: ["2026-10-18T00:00:00Z"],
        temperature_c: [-4.2],
      },
      units: { temperature_c: "°C" },
      windows: [],
      wind_rose: {
        bins: [],
        calm_hours: 0,
        missing_hours: 0,
        expected_hours: 24,
        meaning: "",
      },
      correlations: [],
      novelty: {
        status: "insufficient_history",
        method: "",
        training_samples: 0,
        minimum_samples: 72,
        limitations: [],
      },
      trends: {},
      quality: {
        history_hours: 1,
        weather_usable: true,
        air_usable: true,
        forecast_coverage: {},
        normalization: {},
      },
      provenance: {},
      limitations: [],
    },
    "csv",
    { name: "Sydney", country: "Australia", countryCode: "AU", lat: -33.8688, lon: 151.2093 },
  );
  const text = await captured!.text();
  expect(text).toContain("'=CMD");
  expect(text).toContain('"-33.8688"');
  expect(text).toContain('"-4.2"');
});

