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
  const f = vi.fn(
    async () =>
      new Response('{"ok":true}', {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  );
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
it("blocks redirects even when a caller asks to follow them", async () => {
  setup();
  const f = vi.fn(async () => Response.json({ ok: true }));
  vi.stubGlobal("fetch", f);
  await api("/api/v1/health", { redirect: "follow" });
  expect(
    (f.mock.calls[0] as unknown as [string, RequestInit])[1].redirect,
  ).toBe("error");
});
it("rejects HTML masquerading as a successful API response", async () => {
  setup();
  vi.stubGlobal(
    "fetch",
    async () =>
      new Response("<h1>Not API data</h1>", {
        headers: { "Content-Type": "text/html" },
      }),
  );
  await expect(api("/api/v1/health")).rejects.toThrow("JSON");
});
it("rejects malformed JSON rather than casting it to a trusted response", async () => {
  setup();
  vi.stubGlobal(
    "fetch",
    async () =>
      new Response("{not valid}", {
        headers: { "Content-Type": "application/json" },
      }),
  );
  await expect(api("/api/v1/health")).rejects.toThrow("invalid JSON");
});
it("bounds streamed response bytes before parsing", async () => {
  setup();
  vi.stubGlobal(
    "fetch",
    async () =>
      new Response('"' + "x".repeat(8_000_001) + '"', {
        headers: { "Content-Type": "application/json" },
      }),
  );
  await expect(api("/api/v1/health")).rejects.toThrow("data budget");
});
it("bounds validation error details and supports the FastAPI error-list shape", async () => {
  setup();
  vi.stubGlobal("fetch", async () =>
    Response.json(
      { detail: [{ msg: "bad scientific input" }, { msg: "x".repeat(600) }] },
      { status: 422 },
    ),
  );
  const error = (await api("/api/v1/health").catch((e) => e)) as Error;
  expect(error.message).toContain("bad scientific input");
  expect(error.message.length).toBeLessThan(210);
});
it("does not leak raw unauthenticated error pages", async () => {
  setup();
  vi.stubGlobal(
    "fetch",
    async () => new Response("internal-secret-text", { status: 401 }),
  );
  await expect(api("/api/v1/health")).rejects.toThrow("workspace settings");
});
it("rejects credentials embedded in a same-origin URL", async () => {
  setup();
  const f = vi.fn();
  vi.stubGlobal("fetch", f);
  await expect(
    api("https://name:pass@atlas.example/api/v1/health"),
  ).rejects.toThrow("same-origin");
  expect(f).not.toHaveBeenCalled();
});
