// A dedicated test deployment uses this NON-SECRET sentinel. Never use it for production.
import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
await fs.mkdir("../.artifacts/browser", {recursive:true});
const base = process.env.ATLAS_PRIVATE_TEST_URL || "http://127.0.0.1:7861";
const key =
  process.env.ATLAS_PRIVATE_TEST_KEY ||
  "ATLAS_BROWSER_VERIFICATION_ONLY_NOT_A_REAL_SECRET_2026";
const browser = await chromium.launch({
  headless: true,
  args: [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--disable-dev-shm-usage",
  ],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const checks = [],
  requests = [],
  errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("request", (r) =>
  requests.push({ url: r.url(), has_key: r.headers()["x-atlas-key"] === key }),
);
async function check(name, fn) {
  await fn();
  checks.push({ name, status: "passed" });
  console.log("PASS", name);
}
try {
  await check(
    "Private endpoint rejects missing and query-string keys",
    async () => {
      expect((await page.request.get(base + "/api/v1/sources")).status()).toBe(
        401,
      );
      expect(
        (
          await page.request.get(
            base + "/api/v1/sources?api_key=" + encodeURIComponent(key),
          )
        ).status(),
      ).toBe(401);
    },
  );
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page
    .getByRole("button", { name: "Workspace settings", exact: true })
    .click();
  await page.getByPlaceholder("Deployment access key (optional)").fill(key);
  const tile = page.waitForResponse(
    (r) => r.url().includes("/api/v1/map/tiles/") && r.status() === 200,
    { timeout: 45000 },
  );
  await page
    .getByRole("button", { name: "Apply access key", exact: true })
    .click();
  await check("Private map tiles receive the application header", async () => {
    await tile;
    await page.waitForSelector('[data-map-ready="true"]', { timeout: 45000 });
    if (
      !requests.some((r) => r.url.includes("/api/v1/map/tiles/") && r.has_key)
    )
      throw Error("Missing authorized tile");
  });
  await check(
    "Private model report receives the application header",
    async () => {
      await expect(page.locator(".current-weather strong")).not.toHaveText(
        "—°",
        { timeout: 40000 },
      );
      if (
        !requests.some((r) => r.url.includes("/api/v1/location") && r.has_key)
      )
        throw Error("Missing authorized location request");
    },
  );
  await check("Private Signal Lab and comparison endpoints require header authentication",async()=>{
    expect((await page.request.get(base+'/api/v1/insights?lat=27.1&lon=78.15')).status()).toBe(401);
    expect((await page.request.post(base+'/api/v1/compare',{data:{points:[{lat:27.1,lon:78.15},{lat:28.6,lon:77.2}]}})).status()).toBe(401);
    await page.getByRole('button',{name:'Intelligence',exact:true}).click();
    await page.getByRole('button',{name:'Signal Lab',exact:true}).click();
    await page.locator('.derived-metrics').waitFor({timeout:45000});
    expect(requests.some(r=>r.has_key&&r.url.includes('/api/v1/insights?'))).toBe(true);
    await page.getByRole('button',{name:'Overview',exact:true}).click();
    await page.waitForSelector('[data-map-ready="true"]',{timeout:45000});
  });
  await check(
    "Location view restores the report, not just the camera",
    async () => {
      await page
        .getByRole("button", { name: "Save selected location", exact: true })
        .click();
      await page
        .getByRole("textbox", { name: "VIEW NAME" })
        .fill("Verification · Agra");
      await page.getByRole("button", { name: "Save location view" }).click();
      await page
        .getByRole("button", { name: "Search the planet", exact: true })
        .click();
      await page
        .getByRole("textbox", { name: "Search a place or latitude, longitude" })
        .fill("27.1767, 78.0081");
      await page
        .getByRole("textbox", { name: "Search a place or latitude, longitude" })
        .press("Enter");
      await expect(page.locator(".location-card h2")).toContainText("27.177");
      await page.getByRole("button", { name: /Verification · Agra/ }).click();
      await expect(page.locator(".location-card h2")).toHaveText(
        "Verification · Agra",
      );
      if (
        requests.filter(
          (r) =>
            r.has_key && r.url.includes("/api/v1/location?lat=27.1&lon=78.15"),
        ).length < 2
      )
        throw Error("Restored location did not re-fetch its report");
      const saved = await page.evaluate(() =>
        JSON.parse(localStorage.getItem("atlas.views.v1")),
      );
      expect(saved[0].place.countryCode).toBe("IN");
      expect(saved[0].place.lat).toBe(27.1);
    },
  );
  await check(
    "Access key is not written to local storage or normal request URLs",
    async () => {
      const values = await page.evaluate(() =>
        JSON.stringify({ ...localStorage }),
      );
      if (values.includes(key)) throw Error("Key in local storage");
      if (requests.some((r) => r.url.includes(key)))
        throw Error("Key in application URL");
    },
  );
  await check(
    "Private operator snapshot uses authenticated blob fetching",
    async () => {
      const loaded = page.waitForResponse(
        (r) => r.url().includes("/api/v1/sources/tfl") && r.status() === 200,
        { timeout: 30000 },
      );
      await page.getByRole("button", { name: /Greater London/ }).click();
      const response = await loaded;
      const data = await response.json();
      await page.waitForTimeout(3500);
      const box = await page.locator(".maplibregl-canvas").boundingBox();
      const y = (lat) =>
        (1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2;
      const world = 512 * 2 ** 10;
      const candidates = data.payload.events
        .filter((e) => e.point)
        .map((e) => ({
          e,
          dx: ((e.point.lon + 0.13) / 360) * world,
          dy: (y(e.point.lat) - y(51.51)) * world,
        }));
      const p = candidates.find(
        (p) => Math.hypot(p.dx, p.dy) > 30 && Math.hypot(p.dx, p.dy) < 130,
      );
      if (!p || !box)
        throw Error("No clickable catalog camera in central London");
      const image = page.waitForResponse(
        (r) => r.url().includes("/api/v1/cameras/") && r.status() === 200,
        { timeout: 30000 },
      );
      await page.mouse.click(
        box.x + box.width / 2 + p.dx,
        box.y + box.height / 2 + p.dy,
      );
      await image;
      await expect(page.locator("img.camera-snapshot")).toBeVisible({
        timeout: 10000,
      });
      if (
        !(await page
          .locator("img.camera-snapshot")
          .evaluate((i) => i.complete && i.naturalWidth > 0))
      )
        throw Error("Image not decoded");
      if (
        !requests.some((r) => r.url.includes("/api/v1/cameras/") && r.has_key)
      )
        throw Error("Missing image auth header");
    },
  );
  await page.screenshot({ path: "../.artifacts/browser/screenshots/private-camera.png" });
  if (errors.length) throw Error(JSON.stringify(errors));
} catch (e) {
  checks.push({
    name: "Private browser verification stopped",
    status: "failed",
    error: String(e),
  });
  console.error(e);
  process.exitCode = 1;
  await page.screenshot({ path: "../.artifacts/browser/private-failure.png" });
} finally {
  await fs.writeFile(
    "../.artifacts/browser/private-browser-verification.json",
    JSON.stringify(
      {
        checked_at: new Date().toISOString(),
        browser: browser.version(),
        note: "Dedicated test server; synthetic sentinel key is not a production secret. Pre-login 401 responses are expected.",
        checks,
        uncaught_errors: errors,
        authorized_map_requests: requests.filter(
          (r) => r.url.includes("/api/v1/map/") && r.has_key,
        ).length,
        authorized_image_requests: requests.filter(
          (r) => r.url.includes("/api/v1/cameras/") && r.has_key,
        ).length,
      },
      null,
      2,
    ),
  );
  await browser.close();
}
