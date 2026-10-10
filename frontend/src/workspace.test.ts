import { describe, it, expect } from "vitest";
import {
  DEFAULT_PREFS,
  parseWorkspace,
  polygonCameraBounds,
  parsePolygon,
  parsePlace,
  parseSaved,
  parsePreferences,
  convert,
  unitFor,
} from "./workspace";
import { utcMillis } from "./utils";
const geometry = {
  type: "Polygon",
  coordinates: [
    [
      [77, 27],
      [79, 27],
      [79, 28],
      [77, 28],
      [77, 27],
    ],
  ],
};
const place = {
  lat: 27.1,
  lon: 78.15,
  name: "Offline test place",
  country: "India",
  countryCode: "IN",
};
const saved = {
  place,
  name: "Saved test",
  center: [78.15, 27.1],
  zoom: 7,
  geometry,
};
const workspace = () => ({
  schema: "atlas-workspace",
  version: 2,
  exported_at: "2026-10-10T00:00:00Z",
  place,
  saved: [saved],
  geometry: null,
  filters: { kinds: ["earthquake", "fire"], hours: 24, minimum: 0 },
  preferences: DEFAULT_PREFS,
});
describe("portable workspace boundary", () => {
  it("round trips canonical fields and strips unrecognized fields including credentials", () => {
    const w = workspace();
    const result = parseWorkspace(
      JSON.stringify({
        ...w,
        api_key: "DO NOT PERSIST",
        accessKey: "SECRET",
        __proto__: { polluted: true },
      }),
    );
    expect(result).toEqual(w);
    expect(JSON.stringify(result)).not.toContain("SECRET");
    expect(({} as any).polluted).toBeUndefined();
  });
  it("preserves an empty selected-kind set instead of enabling everything", () => {
    const w = workspace();
    w.filters.kinds = [];
    expect(parseWorkspace(JSON.stringify(w)).filters.kinds).toEqual([]);
  });
  it.each(["bad", "null", "[]", '{"version":1}', " ".repeat(65537)])(
    "rejects invalid, oversized or wrong-version documents",
    (s) => {
      expect(() => parseWorkspace(s)).toThrow();
    },
  );
  it.each([null, {}, true, NaN, Infinity, "27", 91])(
    "rejects invalid latitude",
    (lat) => expect(() => parsePlace({ ...place, lat })).toThrow(),
  );
  it("rejects malformed metadata and country labels", () => {
    expect(() => parsePlace({ ...place, countryCode: "../../IN" })).toThrow();
    expect(() => parsePlace({ ...place, name: "x".repeat(121) })).toThrow();
    expect(() => parsePlace({ ...place, country: null })).toThrow();
  });
  it("validates all places, even when the viewport center appears valid", () =>
    expect(() =>
      parseSaved([{ ...saved, place: { ...place, lon: 999 } }]),
    ).toThrow());
  it("bounds the number of views and validates their geometry", () => {
    expect(() => parseSaved(Array(7).fill(saved))).toThrow();
    expect(() => parseSaved([{ ...saved, geometry: null }])).toThrow();
  });
  it("rejects unknown layer ids and noninteger or coerced numeric filters", () => {
    for (const filters of [
      { kinds: ["toString"], hours: 24, minimum: 0 },
      { kinds: ["earthquake"], hours: true, minimum: 0 },
      { kinds: [], hours: 1.5, minimum: 0 },
      { kinds: [], hours: 24, minimum: 6 },
    ])
      expect(() =>
        parseWorkspace(JSON.stringify({ ...workspace(), filters })),
      ).toThrow();
  });
  it("deduplicates supported layer selections", () => {
    const w = workspace();
    w.filters.kinds = ["fire", "fire"];
    expect(parseWorkspace(JSON.stringify(w)).filters.kinds).toEqual(["fire"]);
  });
  it("preference validation rejects unknown enumerations", () =>
    expect(() =>
      parsePreferences({ ...DEFAULT_PREFS, units: "Kelvin" }),
    ).toThrow());
});
describe("GeoJSON import", () => {
  it("accepts a polygon and its Feature form", () => {
    expect(parsePolygon(geometry)).toEqual(geometry);
    expect(
      parsePolygon({
        type: "Feature",
        geometry,
        properties: { secret: "ignored" },
      }),
    ).toEqual(geometry);
  });
  it("supports a bounded date-line crossing", () =>
    expect(
      parsePolygon({
        type: "Polygon",
        coordinates: [
          [
            [179, 1],
            [-179, 1],
            [-179, 3],
            [179, 3],
            [179, 1],
          ],
        ],
      }),
    ).toBeTruthy());
  it.each([
    { type: "Point", coordinates: [0, 0] },
    { type: "Polygon", coordinates: [] },
    {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [1, 1],
          [2, 2],
          [3, 3],
        ],
      ],
    },
    {
      type: "Polygon",
      coordinates: [
        [
          [true, 0],
          [1, 1],
          [2, 2],
          [true, 0],
        ],
      ],
    },
    {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [0, 0],
          [0, 0],
          [0, 0],
        ],
      ],
    },
    {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [180, 0],
          [180, 2],
          [0, 2],
          [0, 0],
        ],
      ],
    },
  ])("rejects invalid shape/range/closure", (g) =>
    expect(() => parsePolygon(g)).toThrow(),
  );
  it("enforces total vertex budget across rings", () => {
    const ring = [
      ...Array.from({ length: 200 }, (_, i) => [i / 100, 0]),
      [0, 0],
    ];
    expect(() =>
      parsePolygon({ type: "Polygon", coordinates: [ring] }),
    ).toThrow("200");
  });
});
describe("canonical units and UTC clocks", () => {
  it("converts display values without changing canonical data", () => {
    expect(convert(0, "temperature_c", "imperial")).toBe(32);
    expect(convert(25.4, "precipitation_mm", "imperial")).toBe(1);
    expect(convert(1.609344, "wind_kmh", "imperial")).toBe(1);
    expect(convert(20, "gdd_c_day", "imperial")).toBe(20);
    expect(convert(0, "temperature_c", "metric")).toBe(0);
  });
  it("never converts unknown values into zero", () => {
    expect(convert(null, "temperature_c", "imperial")).toBeNull();
    expect(convert(NaN, "precipitation_mm", "metric")).toBeNull();
    expect(convert(undefined, "wind_kmh", "imperial")).toBeNull();
  });
  it("always labels converted values and leaves degree-day units explicit", () => {
    expect(unitFor("temperature_c", "imperial")).toBe("°F");
    expect(unitFor("reference_et0_mm", "imperial")).toBe("in");
    expect(unitFor("gdd_c_day", "imperial")).toBe("°C·day");
  });
  it("handles UTC-naive, Z and offsets without double suffixes", () => {
    const t = Date.parse("2026-10-10T10:00:00Z");
    for (const s of [
      "2026-10-10T10:00",
      "2026-10-10T10:00:00Z",
      "2026-10-10T10:00:00+00:00",
      "2026-10-10T15:30:00+05:30",
    ])
      expect(utcMillis(s)).toBe(t);
    expect(utcMillis(null)).toBeNaN();
    expect(utcMillis("bad")).toBeNaN();
  });
});

it("keeps the active polygon in a portable workspace without extra fields", () => {
  const w = { ...workspace(), geometry: { ...geometry, api_key: "never" } };
  expect(parseWorkspace(JSON.stringify(w)).geometry).toEqual(geometry);
});
it("unwraps a date-line polygon into a small camera box", () => {
  const p = parsePolygon({
    type: "Polygon",
    coordinates: [
      [
        [179, -5],
        [-179, -5],
        [-179, 5],
        [179, 5],
        [179, -5],
      ],
    ],
  });
  expect(polygonCameraBounds(p)).toEqual([
    [179, -5],
    [181, 5],
  ]);
});
it("clamps only the camera latitude, not the source polygon", () => {
  const p = parsePolygon({
    type: "Polygon",
    coordinates: [
      [
        [0, 89],
        [1, 89],
        [1, 90],
        [0, 90],
        [0, 89],
      ],
    ],
  });
  expect(polygonCameraBounds(p)[1][1]).toBe(85.05);
  expect(p.coordinates[0][2][1]).toBe(90);
});
