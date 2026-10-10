import { it, expect, vi, afterEach } from "vitest";
import { api, setDeploymentKey } from "./api";
function setup() {
  vi.stubGlobal("window", {
    location: { origin: "https://atlas.example" },
    setTimeout: globalThis.setTimeout,
  });
}
afterEach(() => {
  setDeploymentKey("");
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("sends deployment key only in a same-origin header", async () => {
  setup();
  setDeploymentKey("OFFLINE TEST KEY");
  const f = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
  vi.stubGlobal("fetch", f);
  expect(await api("/api/v1/health")).toEqual({ ok: true });
  const [, options] = f.mock.calls[0] as unknown as [string, RequestInit];
  expect((options.headers as Headers).get("X-Atlas-Key")).toBe(
    "OFFLINE TEST KEY",
  );
});
it("never forwards a deployment key to an external URL", async () => {
  setup();
  const f = vi.fn();
  vi.stubGlobal("fetch", f);
  await expect(api("https://other.example/api/stuff")).rejects.toThrow(
    "same-origin",
  );
  expect(f).not.toHaveBeenCalled();
});
it("distinguishes deadline expiry from user cancellation", async () => {
  vi.useFakeTimers();
  setup();
  vi.stubGlobal(
    "fetch",
    (_path: string, opts: RequestInit) =>
      new Promise((_resolve, reject) =>
        opts.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        ),
      ),
  );
  const result = api("/api/v1/location").catch((e) => e);
  await vi.advanceTimersByTimeAsync(42001);
  expect(String(await result)).toContain("timed out");
});
it("shows bounded application error details rather than arbitrary upstream HTML", async () => {
  setup();
  vi.stubGlobal(
    "fetch",
    async () =>
      new Response("<html>upstream private diagnostics</html>", {
        status: 502,
      }),
  );
  await expect(api("/api/v1/sources")).rejects.toThrow("Request returned 502");
});
