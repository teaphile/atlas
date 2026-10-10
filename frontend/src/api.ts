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
  const u = new URL(path, window.location.origin);
  if (
    u.origin !== window.location.origin ||
    !u.pathname.startsWith("/api/") ||
    u.username ||
    u.password
  )
    throw new Error("Only same-origin API requests are allowed");
}
async function boundedJSON(res: Response, limit = 8_000_000): Promise<unknown> {
  if (
    !/application\/(?:[\w.+-]+\+)?json\b/i.test(
      res.headers.get("content-type") ?? "",
    )
  )
    throw new Error("The server did not return JSON data");
  const reader = res.body?.getReader();
  if (!reader) throw new Error("The server returned an empty response");
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        throw new Error("Response exceeded the browser data budget");
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    body.set(part, offset);
    offset += part.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(body));
  } catch {
    throw new Error("The server returned invalid JSON data");
  }
}
export async function imageBlob(path: string, signal: AbortSignal) {
  checkLocal(path);
  const res = await fetch(path, {
    headers: deploymentHeaders(),
    signal,
    redirect: "error",
    credentials: "same-origin",
  });
  if (!res.ok) throw new Error("Operator image unavailable");
  const blob = await res.blob();
  if (!/^image\/(jpeg|png|webp)$/i.test(blob.type) || blob.size > 1_000_000)
    throw new Error("Operator image has an unsupported format or size");
  return blob;
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
      redirect: "error",
      credentials: "same-origin",
    });
    if (!res.ok) {
      let detail =
        res.status === 401
          ? "Deployment access is required. Open workspace settings."
          : `Request returned ${res.status}`;
      try {
        const d = (await boundedJSON(res, 65536)) as { detail?: unknown };
        if (typeof d.detail === "string") detail = d.detail.slice(0, 500);
        else if (Array.isArray(d.detail)) {
          const messages = d.detail
            .slice(0, 3)
            .map((e) =>
              e && typeof e.msg === "string"
                ? e.msg.slice(0, 160)
                : "Invalid input",
            );
          detail = messages.join("; ");
        }
      } catch {
        /* do not expose raw error pages */
      }
      throw new Error(detail);
    }
    return (await boundedJSON(res)) as T;
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
