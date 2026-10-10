let deploymentKey = "";
export function setDeploymentKey(value: string) {
  deploymentKey = value;
}
export function hasDeploymentKey() {
  return !!deploymentKey;
}
export function deploymentHeaders(): Record<string, string> {
  return deploymentKey ? { "X-Atlas-Key": deploymentKey } : {};
}
function checkLocal(path: string) {
  const url = new URL(path, window.location.origin);
  if (
    url.origin !== window.location.origin ||
    !url.pathname.startsWith("/api/")
  ) {
    throw new Error("Only same-origin API requests are allowed");
  }
}
export async function imageBlob(path: string, signal: AbortSignal) {
  checkLocal(path);
  const res = await fetch(path, { headers: deploymentHeaders(), signal });
  if (!res.ok) throw new Error("Operator image unavailable");
  return await res.blob();
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  checkLocal(path);
  const controller = new AbortController();
  let timedOut = false;
  const timeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 42000);
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  try {
    const headers = new Headers(options.headers);
    headers.set("Accept", "application/json");
    if (options.body) headers.set("Content-Type", "application/json");
    if (deploymentKey) headers.set("X-Atlas-Key", deploymentKey);
    const res = await fetch(path, {
      ...options,
      signal: controller.signal,
      headers,
    });
    if (!res.ok) {
      let detail = `Request returned ${res.status}`;
      try {
        const d = await res.json();
        detail = typeof d.detail === "string" ? d.detail : detail;
      } catch {
        /* no upstream body is shown */
      }
      throw new Error(detail);
    }
    return (await res.json()) as T;
  } catch (e) {
    if (timedOut)
      throw new Error("Request timed out. Last received data may be outdated.");
    throw e;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
  }
}
export function isAbort(e: unknown) {
  return e instanceof DOMException && e.name === "AbortError";
}
