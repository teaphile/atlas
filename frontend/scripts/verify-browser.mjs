// Real browser / real local API checks. No fixture records enter the dashboard.
import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
const base = process.env.ATLAS_PREVIEW_URL || "http://127.0.0.1:7860";
const directory = path.resolve("../docs/v2/legacy-regression");
await fs.mkdir(directory, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--disable-dev-shm-usage",
  ],
});
const page = await browser.newPage({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 1,
});
const errors = [],
  failed = [],
  checks = [];
const started = Date.now();
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("response", (r) => {
  if (r.status() >= 400) failed.push({ url: r.url(), status: r.status() });
});
async function check(name, fn) {
  await fn();
  checks.push({ name, status: "passed" });
  console.log("PASS", name);
}
try {
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await check("Actual MapLibre worker and style load", async () => {
    await page.waitForSelector('[data-map-ready="true"]', { timeout: 60000 });
    await expect(page.locator(".map-fallback")).toHaveCount(0);
  });
  await check(
    "Environmental panel receives real modeled conditions",
    async () => {
      await expect(page.locator(".current-weather strong")).not.toHaveText(
        "—°",
        { timeout: 40000 },
      );
    },
  );
  await page.screenshot({ path: directory + "/desktop.png" });
  await check("Accessible search and place gazetteer", async () => {
    await page
      .getByRole("button", { name: "Search the planet", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Search a place or latitude, longitude" })
      .fill("Agra");
    await expect(page.locator(".search-result").first()).toBeVisible({
      timeout: 30000,
    });
    await page.getByRole("button", { name: "Close dialog" }).click();
  });
  await check("Source catalog, search and provenance inspector", async () => {
    await page.getByRole("button", { name: /Data sources/ }).click();
    await expect(page.locator(".source-table-row")).toHaveCount(23);
    await page
      .getByRole("textbox", { name: "Filter data sources" })
      .fill("SoilGrids");
    await expect(page.locator(".source-table-row")).toHaveCount(1);
    await page.locator(".source-table-row").click();
    await expect(page.getByRole("dialog")).toContainText("ISRIC");
    await page.getByRole("button", { name: "Close dialog" }).click();
    await page.getByRole("textbox", { name: "Filter data sources" }).fill("");
  });
  await page.screenshot({ path: directory + "/sources.png" });
  await check("Soil profile renders prediction semantics", async () => {
    await page
      .getByRole("button", { name: "Intelligence", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Soil profile", exact: true })
      .click();
    await expect(page.locator(".workspace-page")).toContainText("SoilGrids");
    await expect(page.locator(".workspace-page")).toContainText("pH");
  });
  await page.screenshot({ path: directory + "/soil.png" });
  await check(
    "Explicit RUSLE calculation and changed-input warning",
    async () => {
      await page
        .getByRole("button", { name: "Scenario lab", exact: true })
        .click();
      await page.getByRole("button", { name: "Compare scenarios" }).click();
      await expect(page.locator(".scenario-change")).toBeVisible();
      await page.locator(".scenario-input input").first().fill("2000");
      await expect(page.locator(".scenario-output")).toContainText(
        "Inputs changed",
      );
    },
  );
  await page.screenshot({ path: directory + "/scenario.png" });
  await check(
    "Static CISA catalog is not truncated by incident-time window",
    async () => {
      await page
        .getByRole("button", { name: "Cyber advisories", exact: true })
        .click();
      await expect(page.locator(".workspace-page tbody tr")).toHaveCount(60);
    },
  );
  await check(
    "Global-to-regional map, temporal filtering and polygon membership",
    async () => {
      await page.getByRole("button", { name: "Overview", exact: true }).click();
      await page.waitForSelector('[data-map-ready="true"]', { timeout: 30000 });
      await page.getByRole("button", { name: /India & South Asia/ }).click();
      await page.waitForTimeout(1800);
      await page.getByRole("button", { name: "72H", exact: true }).click();
      await page
        .getByRole("button", { name: "Analyze visible area", exact: true })
        .click();
      await expect(page.getByRole("dialog")).toContainText(
        "Mapped records inside",
        { timeout: 20000 },
      );
      await page.getByRole("button", { name: "Close dialog" }).click();
    },
  );
  await check("Current-filter CSV export", async () => {
    await page.getByRole("button", { name: "Export", exact: true }).click();
    const promise = page.waitForEvent("download");
    await page.getByRole("button", { name: "CSV spreadsheet" }).click();
    const download = await promise;
    const text = await fs.readFile(await download.path(), "utf8");
    if (!text.startsWith("id,kind,source_id,title"))
      throw Error("CSV header missing");
    if (text.split("\n").length < 2) throw Error("No exported records");
    await download.delete();
  });
  await check("3D projection switches without worker errors", async () => {
    await page.getByRole("button", { name: "Toggle 3D globe" }).click();
    await page.waitForTimeout(1300);
    await page.getByRole("button", { name: "Toggle 3D globe" }).click();
  });
  await check("NASA imagery fetches actual JPEG tiles", async () => {
    const response = page.waitForResponse(
      (r) => r.url().includes("/api/v1/tiles/satellite/") && r.status() === 200,
      { timeout: 45000 },
    );
    await page
      .getByRole("button", { name: "Vector dark", exact: true })
      .click();
    const r = await response;
    const b = await r.body();
    if (b[0] !== 255 || b[1] !== 216) throw Error("Not JPEG");
    await page.waitForTimeout(2500);
    await page.screenshot({ path: directory + "/satellite.png" });
    await page
      .getByRole("button", { name: "NASA imagery", exact: true })
      .click();
  });
  await check("Mobile layout, search and layer access at 390px", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Global extent" }).click();
    await page.waitForTimeout(1700);
    const dims = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    if (dims.scroll > dims.width + 1)
      throw Error("Horizontal page overflow " + JSON.stringify(dims));
    await page.getByRole("button", { name: "Layers", exact: true }).click();
    await expect(page.locator(".sidebar-wrapper")).toHaveClass(/mobile-open/);
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "Search the planet", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "Close dialog" }).click();
  });
  await page.screenshot({ path: directory + "/mobile.png" });
  await check("No uncaught browser errors or HTTP failures", async () => {
    if (errors.length || failed.length)
      throw Error(JSON.stringify({ errors, failed }));
  });
} catch (e) {
  checks.push({
    name: "Browser verification stopped",
    status: "failed",
    error: String(e),
  });
  await page.screenshot({ path: directory + "/last-failure.png" });
  console.error(e);
  process.exitCode = 1;
} finally {
  await fs.writeFile(
    "../docs/v2/legacy-browser-verification.json",
    JSON.stringify(
      {
        checked_at: new Date().toISOString(),
        base_url: "same-origin local preview",
        duration_ms: Date.now() - started,
        checks,
        errors,
        failed,
      },
      null,
      2,
    ),
  );
  await browser.close();
}
