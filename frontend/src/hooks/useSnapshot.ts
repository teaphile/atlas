import { useCallback, useEffect, useRef, useState } from "react";
import type { Snapshot } from "../types";
import { api, hasDeploymentKey, isAbort } from "../api";
/** A new auth/camera generation owns its requests; old responses cannot publish. */
export function useSnapshot(wantCameras: boolean, authVersion: number) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [snapshotError, setError] = useState("");
  const runRef = useRef<() => Promise<void>>(async () => {});
  const refresh = useCallback(() => runRef.current(), []);
  useEffect(() => {
    let alive = true,
      busy = false,
      pending = false;
    const ac = new AbortController();
    setSnapshot(null);
    setError("");
    async function run() {
      if (!alive) return;
      if (busy) {
        pending = true;
        return;
      }
      busy = true;
      try {
        const d = await api<Snapshot>(
          `/api/v1/snapshot?include_cameras=${wantCameras}`,
          { signal: ac.signal },
        );
        if (alive && !ac.signal.aborted) {
          setSnapshot(d);
          setError("");
        }
      } catch (e) {
        if (alive && !ac.signal.aborted && !isAbort(e))
          setError(e instanceof Error ? e.message : "Connection unavailable");
      } finally {
        busy = false;
        if (alive && pending) {
          pending = false;
          void run();
        }
      }
    }
    runRef.current = run;
    void run();
    const timer = window.setInterval(() => {
      if (!document.hidden) void run();
    }, 30000);
    let stream: EventSource | undefined, debounce: number | undefined;
    if (!hasDeploymentKey()) {
      stream = new EventSource("/api/v1/stream");
      stream.addEventListener("sync", () => {
        if (debounce) clearTimeout(debounce);
        debounce = window.setTimeout(run, 500);
      });
    }
    const wake = () => {
      if (!document.hidden) void run();
    };
    document.addEventListener("visibilitychange", wake);
    return () => {
      alive = false;
      ac.abort();
      clearInterval(timer);
      if (debounce) clearTimeout(debounce);
      stream?.close();
      document.removeEventListener("visibilitychange", wake);
    };
  }, [wantCameras, authVersion]);
  return { snapshot, snapshotError, refresh };
}
