import { useCallback, useEffect, useState } from "react";
import type { Envelope, LocationData, Place } from "../types";
import { api, isAbort } from "../api";
/** One coordinate/auth generation, independently settled soil, abort-safe refresh. */
export function useLocation(place: Place, authVersion: number) {
  const [location, setLocation] = useState<LocationData | null>(null),
    [locationLoading, setLoading] = useState(true),
    [locationError, setError] = useState(""),
    [revision, setRevision] = useState(0);
  const retryLocation = useCallback(() => setRevision((v) => v + 1), []);
  useEffect(() => {
    const ac = new AbortController();
    let busy = false;
    let settledSoil: Envelope | null | undefined = undefined;
    setLocation(null);
    setError("");
    setLoading(true);
    function mergeSoil(d: LocationData): LocationData {
      if (settledSoil)
        return {
          ...d,
          sources: { ...d.sources, soil: settledSoil },
          soil_summary: settledSoil.analysis ?? d.soil_summary,
        };
      return {
        ...d,
        sources: {
          ...d.sources,
          soil: {
            ...d.sources.soil,
            status: settledSoil === undefined ? "refreshing" : "unavailable",
            ...(settledSoil === null
              ? {
                  error_code: "request_failed",
                  warnings: [
                    "Soil query unavailable. No substitute estimates were created.",
                  ],
                }
              : {}),
          },
        },
      };
    }
    void api<Envelope>(
      `/api/v1/sources/soil?lat=${place.lat}&lon=${place.lon}`,
      { signal: ac.signal },
    )
      .then((d) => {
        settledSoil = d;
      })
      .catch(() => {
        settledSoil = null;
      })
      .finally(() => {
        if (!ac.signal.aborted)
          setLocation((old) => (old ? mergeSoil(old) : old));
      });
    async function run() {
      if (busy || ac.signal.aborted) return;
      busy = true;
      try {
        const d = await api<LocationData>(
          `/api/v1/location?lat=${place.lat}&lon=${place.lon}`,
          { signal: ac.signal },
        );
        if (!ac.signal.aborted) {
          setLocation(mergeSoil(d));
          setError("");
        }
      } catch (e) {
        if (!ac.signal.aborted && !isAbort(e))
          setError(
            e instanceof Error
              ? e.message
              : "Environmental sources could not be reached. Retry or inspect source health.",
          );
      } finally {
        busy = false;
        if (!ac.signal.aborted) setLoading(false);
      }
    }
    void run();
    const timer = window.setInterval(() => {
      if (!document.hidden) void run();
    }, 600000);
    return () => {
      ac.abort();
      clearInterval(timer);
    };
  }, [place.lat, place.lon, authVersion, revision]);
  return { location, locationLoading, locationError, retryLocation };
}
