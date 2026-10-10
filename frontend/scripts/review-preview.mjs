import { chromium } from "@playwright/test";
const browser = await chromium.launch({
  headless: true,
  args: [
    "--no-sandbox",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const page = await browser.newPage({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 1,
});
const errors = [];
const failed = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text().slice(0, 350));
});
page.on("response", (r) => {
  if (r.status() >= 400) failed.push([r.status(), new URL(r.url()).pathname]);
});
await page.goto("http://127.0.0.1:7860", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".maplibregl-canvas", { timeout: 15000 });
await page.waitForFunction(
  () =>
    document.querySelector(".current-weather strong")?.textContent &&
    !document
      .querySelector(".current-weather strong")
      ?.textContent?.includes("—"),
  { timeout: 40000 },
);
await page.waitForSelector('[data-map-ready="true"]', { timeout: 45000 });
await page.screenshot({ path: "../docs/previews/desktop.png", fullPage: true });
console.log(
  JSON.stringify(
    {
      title: await page.title(),
      errors,
      failed,
      body: await page
        .locator("body")
        .innerText()
        .then((t) => t.slice(0, 1600)),
    },
    null,
    2,
  ),
);
await browser.close();
