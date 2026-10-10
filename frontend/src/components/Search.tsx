import { useEffect, useState } from "react";
import {
  Search,
  MapPin,
  ArrowUpRight,
  CornerDownLeft,
  Globe2,
} from "lucide-react";
import { Modal, Spinner } from "./UI";
import { api, isAbort } from "../api";
import { parseCoordinates } from "../utils";
import type { Place, GeocodingResult } from "../types";
const PRESETS: Place[] = [
  {
    name: "Agra district · rural east",
    lat: 27.1,
    lon: 78.15,
    country: "India",
    countryCode: "IN",
  },
  {
    name: "Reykjavík",
    lat: 64.1466,
    lon: -21.9426,
    country: "Iceland",
    countryCode: "IS",
  },
  {
    name: "Los Angeles",
    lat: 34.0522,
    lon: -118.2437,
    country: "United States",
    countryCode: "US",
  },
  {
    name: "London",
    lat: 51.5074,
    lon: -0.1278,
    country: "United Kingdom",
    countryCode: "GB",
  },
];
export function SearchModal({
  onClose,
  onSelect,
}: {
  onClose: () => void;
  onSelect: (p: Place) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<GeocodingResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const parsed = parseCoordinates(q);
  useEffect(() => {
    setError("");
    setResults([]);
    if (q.trim().length < 2 || parseCoordinates(q)) {
      setResults([]);
      setLoading(false);
      return;
    }
    const ac = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError("");
      api<{
        results: GeocodingResult[];
        status: string;
        error_code: string | null;
      }>(`/api/v1/geocode?q=${encodeURIComponent(q.trim())}`, {
        signal: ac.signal,
      })
        .then((d) => {
          if (ac.signal.aborted) return;
          setResults(d.results);
          if (d.status === "unavailable")
            setError(
              d.error_code ??
                "Search provider is unavailable. Coordinates still work.",
            );
        })
        .catch((e) => {
          if (!isAbort(e))
            setError(
              "Place search is temporarily unavailable. Try latitude, longitude.",
            );
        })
        .finally(() => {
          if (!ac.signal.aborted) setLoading(false);
        });
    }, 450);
    return () => {
      clearTimeout(timer);
      ac.abort();
    };
  }, [q]);
  function select(p: Place) {
    onSelect(p);
    onClose();
  }
  function first() {
    if (parsed)
      select({
        ...parsed,
        name: `${parsed.lat.toFixed(3)}, ${parsed.lon.toFixed(3)}`,
        country: "Selected coordinates",
        countryCode: "",
      });
    else if (results[0]) {
      const r = results[0];
      select({
        name: r.name,
        lat: r.latitude,
        lon: r.longitude,
        country: r.country,
        countryCode: r.country_code,
      });
    }
  }
  return (
    <Modal title="Find your perspective" onClose={onClose}>
      <div className="search-field">
        <Search size={20} />
        <input
          autoFocus
          aria-label="Search a place or latitude, longitude"
          placeholder="Search a place, or enter lat, lon…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") first();
          }}
        />
        <kbd>↵</kbd>
      </div>
      <div className="search-results">
        {loading ? (
          <Spinner label="Searching the global gazetteer…" />
        ) : error ? (
          <p className="error-text">{error}</p>
        ) : parsed ? (
          <button className="search-result" onClick={first}>
            <MapPin />
            <span>
              <b>
                {parsed.lat}°, {parsed.lon}°
              </b>
              <small>Analyze these exact coordinates</small>
            </span>
            <CornerDownLeft size={16} />
          </button>
        ) : q.length > 1 ? (
          results.length ? (
            results.map((r) => (
              <button
                className="search-result"
                key={r.id}
                onClick={() =>
                  select({
                    name: r.name,
                    lat: r.latitude,
                    lon: r.longitude,
                    country: r.country,
                    countryCode: r.country_code,
                  })
                }
              >
                <MapPin size={18} />
                <span>
                  <b>{r.name}</b>
                  <small>
                    {[r.admin1, r.country].filter(Boolean).join(", ")}
                  </small>
                </span>
                <ArrowUpRight size={16} />
              </button>
            ))
          ) : (
            <p className="empty-state">
              No matching places. Try “27.1, 78.15”.
            </p>
          )
        ) : (
          <>
            <span className="eyebrow">EXPLORE A LOCATION</span>
            {PRESETS.map((p) => (
              <button
                className="search-result"
                key={p.name}
                onClick={() => select(p)}
              >
                <Globe2 size={18} />
                <span>
                  <b>{p.name}</b>
                  <small>
                    {p.country} · {p.lat.toFixed(2)}°, {p.lon.toFixed(2)}°
                  </small>
                </span>
                <ArrowUpRight size={16} />
              </button>
            ))}
          </>
        )}
      </div>
      <div className="modal-footnote">
        Open-Meteo / GeoNames · Searching sends the place query to the provider.
        No device location is requested.
      </div>
    </Modal>
  );
}
