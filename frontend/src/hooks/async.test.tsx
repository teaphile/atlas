// @vitest-environment jsdom
import { afterEach, beforeEach, it, expect, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useSnapshot } from "./useSnapshot";
import { useLocation } from "./useLocation";
import type { Place } from "../types";
const mocked = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("../api", () => ({
  api: mocked.api,
  hasDeploymentKey: () => true,
  isAbort: (e: unknown) => e instanceof DOMException && e.name === "AbortError",
}));
interface Request {
  path: string;
  signal: AbortSignal;
  resolve: (v: any) => void;
  reject: (e: any) => void;
}
let requests: Request[] = [];
const A: Place = {
    name: "Offline A",
    lat: 27,
    lon: 78,
    country: "India",
    countryCode: "IN",
  },
  B: Place = { ...A, name: "Offline B", lat: 28, lon: 79 };
function condition(name: string) {
  return {
    point: { lat: 27, lon: 78 },
    generated_at: name,
    sources: {
      soil: {
        source_id: "soil",
        status: "idle",
        payload: { data: {}, warnings: [] },
        warnings: [],
      },
    },
    soil_summary: { ph: null },
  };
}
function soil(name: string) {
  return {
    source_id: "soil",
    status: "fresh",
    payload: { data: { name }, warnings: [] },
    warnings: [],
    analysis: { ph: 7 },
  };
}
beforeEach(() => {
  requests = [];
  mocked.api.mockReset();
  mocked.api.mockImplementation(
    (path, options) =>
      new Promise((resolve, reject) =>
        requests.push({ path, signal: options.signal, resolve, reject }),
      ),
  );
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: false,
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it("old camera/auth snapshot generations cannot overwrite new state even if transport ignores abort", async () => {
  const { result, rerender } = renderHook(
    ({ camera, auth }) => useSnapshot(camera, auth),
    { initialProps: { camera: false, auth: 0 } },
  );
  const first = requests[0];
  rerender({ camera: true, auth: 1 });
  const second = requests[1];
  expect(first.signal.aborted).toBe(true);
  expect(second.path).toContain("true");
  await act(async () => second.resolve({ revision: 2, events: [] }));
  await act(async () => first.resolve({ revision: 1, events: [] }));
  expect(result.current.snapshot?.revision).toBe(2);
});
it("snapshot refresh is single-flight and schedules one follow-up invalidation", async () => {
  const { result } = renderHook(() => useSnapshot(false, 0));
  await act(async () => {
    void result.current.refresh();
    void result.current.refresh();
  });
  expect(requests).toHaveLength(1);
  await act(async () => requests[0].resolve({ revision: 1 }));
  expect(requests).toHaveLength(2);
  await act(async () => requests[1].resolve({ revision: 2 }));
  expect(result.current.snapshot?.revision).toBe(2);
});
it("unmount aborts snapshot work and prevents post-unmount publishing", () => {
  const { unmount } = renderHook(() => useSnapshot(false, 0));
  const request = requests[0];
  unmount();
  expect(request.signal.aborted).toBe(true);
});
it("location change cancels both old model and soil requests", async () => {
  const { result, rerender } = renderHook(
    ({ place }) => useLocation(place, 0),
    { initialProps: { place: A } },
  );
  const old = requests.slice();
  rerender({ place: B });
  expect(old.every((r) => r.signal.aborted)).toBe(true);
  const current = requests.slice(2);
  await act(async () => {
    current.find((r) => r.path.includes("/location"))!.resolve(condition("B"));
    current.find((r) => r.path.includes("/soil"))!.resolve(soil("B"));
  });
  await act(async () => {
    old.find((r) => r.path.includes("/location"))!.resolve(condition("A"));
    old.find((r) => r.path.includes("/soil"))!.resolve(soil("A"));
  });
  expect(result.current.location?.generated_at).toBe("B");
  expect(result.current.location?.sources.soil.payload.data.name).toBe("B");
});
it("soil can finish before or after the fast model response without being lost", async () => {
  const { result } = renderHook(() => useLocation(A, 0));
  await act(async () =>
    requests.find((r) => r.path.includes("/soil"))!.resolve(soil("early")),
  );
  await act(async () =>
    requests
      .find((r) => r.path.includes("/location"))!
      .resolve(condition("fast")),
  );
  expect(result.current.location?.sources.soil.payload.data.name).toBe("early");
  expect(result.current.location?.soil_summary.ph).toBe(7);
});
it("failed soil remains explicitly unavailable without replacing fast conditions", async () => {
  const { result } = renderHook(() => useLocation(A, 0));
  await act(async () => {
    requests
      .find((r) => r.path.includes("/soil"))!
      .reject(new Error("offline"));
    requests
      .find((r) => r.path.includes("/location"))!
      .resolve(condition("fast"));
  });
  await waitFor(() =>
    expect(result.current.location?.sources.soil.status).toBe("unavailable"),
  );
  expect(result.current.location?.generated_at).toBe("fast");
});
it("a successful periodic refresh clears an older error and keeps the settled soil profile", async () => {
  vi.useFakeTimers();
  const { result } = renderHook(() => useLocation(A, 0));
  await act(async () => {
    requests.find((r) => r.path.includes("/soil"))!.resolve(soil("kept"));
    requests
      .find((r) => r.path.includes("/location"))!
      .reject(new Error("offline"));
  });
  expect(result.current.locationError).toBe("offline");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600001);
  });
  await act(async () => requests.at(-1)!.resolve(condition("recovered")));
  expect(result.current.locationError).toBe("");
  expect(result.current.location?.sources.soil.payload.data.name).toBe("kept");
  expect(result.current.locationLoading).toBe(false);
});
it("retry starts a new bounded generation rather than overwriting it with an obsolete request", async () => {
  const { result } = renderHook(() => useLocation(A, 0));
  const old = requests.slice();
  act(() => result.current.retryLocation());
  expect(old.every((r) => r.signal.aborted)).toBe(true);
  expect(requests).toHaveLength(4);
  await act(async () => requests.at(-1)!.resolve(condition("retry")));
  expect(result.current.location?.generated_at).toBe("retry");
});
