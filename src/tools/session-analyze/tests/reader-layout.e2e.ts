import { expect, test, type Page } from "@playwright/test";
import type { GeneralChatAnalyze } from "../types";

const fixture: GeneralChatAnalyze = {
  schemaVersion: 1,
  session: { id: "reader-layout", sourcePath: "/fixtures/reader.jsonl", agent: "claude", title: "Long session reading fixture", project: "D:/Synthetic/reader", modifiedAt: 1_798_502_400_000, sizeBytes: 10000, tower: "unknown" },
  analyzedAt: "2026-10-27T00:00:00Z",
  events: Array.from({ length: 180 }, (_, index) => ({
    id: `reading-${index + 1}`, order: index + 1, timestamp: "2026-10-27T00:00:00Z",
    kind: index % 3 === 0 ? "message" : "tool", name: index % 3 === 0 ? "User message" : index % 2 ? "Read" : "Bash",
    text: `Recorded event ${index + 1}.`, role: index % 3 === 0 ? "user" : "assistant",
    callId: index % 3 === 0 ? null : `call-${index + 1}`, status: "success", source: `fixture:${index + 1}`,
  })),
  files: [],
  usage: { inputTokens: 10000, cachedInputTokens: 8000, outputTokens: 1500, reasoningTokens: null, basis: "Synthetic usage." },
  cost: { amount: 0.2, currency: "USD", basis: "reported", detail: "Synthetic cost." }, warnings: [],
};

async function openReport(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Session analyze", exact: true }).click();
  await page.getByLabel("Import analysis JSON", { exact: true }).setInputFiles({ name: "reader.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(fixture)) });
  await expect(page.getByRole("heading", { name: fixture.session.title })).toBeVisible();
}
const section = (page: Page, name: string) => page.getByRole("tablist", { name: "Report sections" }).getByRole("tab", { name: new RegExp(`^${name}(?:\\s|$)`) });

test("puts the summary beside the heading and keeps source order and search fixed while events scroll", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openReport(page);
  const heading = await page.locator(".page-heading").boundingBox();
  const summary = await page.locator(".sa-header-summary").boundingBox();
  expect(summary!.x).toBeGreaterThan(heading!.x + heading!.width);
  expect(Math.abs(summary!.y - heading!.y)).toBeLessThan(2);
  await expect(page.locator(".sa-report .sa-metrics")).toHaveCount(0);
  await section(page, "Flow").click();
  const charts = page.getByRole("complementary", { name: "Activity charts" });
  const pane = page.getByRole("region", { name: "Event reading pane" });
  expect((await pane.boundingBox())!.x).toBeGreaterThan((await charts.boundingBox())!.x);
  const ruler = pane.getByRole("region", { name: "Source order activity" });
  const search = page.getByRole("searchbox", { name: "Search flow", exact: true });
  const initial = await ruler.boundingBox();
  const scroll = page.getByRole("region", { name: "Scrollable session events" });
  await expect(page.getByRole("list", { name: "Session events" }).getByRole("listitem")).toHaveCount(180);
  await expect(page.getByRole("button", { name: "Show 100 more events", exact: true })).toHaveCount(0);
  await expect(ruler).toContainText("Reading #1");
  const range = ruler.locator(".sa-reading-range");
  await expect(range).toHaveAttribute("data-first-order", "1");
  const initialRange = (await range.boundingBox())!;
  const strip = (await ruler.locator(".sa-activity-strip").boundingBox())!;
  expect(initialRange.y).toBeGreaterThanOrEqual(strip.y + strip.height);
  await scroll.evaluate((element) => { element.scrollTop = 3000; });
  await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(1000);
  await expect(search).toBeVisible();
  await expect(ruler).toBeVisible();
  await expect(range).not.toHaveAttribute("data-first-order", "1");
  expect((await range.boundingBox())!.x).toBeGreaterThan(initialRange.x);
  expect(Math.abs((await ruler.boundingBox())!.y - initial!.y)).toBeLessThan(2);
  await page.screenshot({ path: testInfo.outputPath("reader-scrolled.png"), fullPage: true });
  await scroll.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect(range).toHaveAttribute("data-last-order", "180");
  const lastEvent = page.locator("#sa-event-reading-180");
  await lastEvent.scrollIntoViewIfNeeded();
  await expect(lastEvent).toBeInViewport();
  await lastEvent.locator("summary").click();
  await expect(lastEvent.locator("pre")).toHaveText("Recorded event 180.");
  await search.fill("Recorded event 179.");
  await expect(page.getByRole("list", { name: "Session events" }).getByRole("listitem")).toHaveCount(1);
  await expect(page.getByRole("list", { name: "Session events" })).toContainText("179");
  await expect(ruler).toContainText("Reading #179");
  await expect(range).toHaveAttribute("data-first-order", "179");
  await expect(range).toHaveAttribute("data-last-order", "179");
  expect((await range.boundingBox())!.x + (await range.boundingBox())!.width).toBeLessThanOrEqual(strip.x + strip.width);
  await search.fill("No event matches this query");
  await expect(page.getByRole("list", { name: "Session events" }).getByRole("listitem")).toHaveCount(0);
  await expect(ruler.locator(".sa-timeline-position")).not.toContainText("Reading #");
  await expect(range).toHaveCount(0);
  expect(Math.abs((await ruler.boundingBox())!.height - initial!.height)).toBeLessThan(2);
});

test("retains independently scrollable reading controls at large text sizes and narrow widths", async ({ page }, testInfo) => {
  await openReport(page);
  for (const theme of ["dark", "light"]) {
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByLabel("Color theme", { exact: true }).selectOption(theme);
    await page.getByLabel("Font size", { exact: true }).selectOption("175");
    await page.getByRole("button", { name: "Session analyze", exact: true }).click();
    await section(page, "Tools").click();
    await expect(page.getByRole("list", { name: "Session events" }).getByRole("listitem")).toHaveCount(120);
    for (const width of [1280, 780]) {
      await page.setViewportSize({ width, height: 960 });
      const scroll = page.getByRole("region", { name: "Scrollable session events" });
      await scroll.evaluate((element) => { element.scrollTop = 1000; });
      const search = page.getByRole("searchbox", { name: "Search tools", exact: true });
      await expect(search).toBeVisible();
      expect((await search.boundingBox())!.width).toBeGreaterThan(150);
      const eventBox = (await scroll.boundingBox())!;
      const paneBox = (await page.getByRole("region", { name: "Event reading pane" }).boundingBox())!;
      expect(eventBox.y + eventBox.height).toBeLessThanOrEqual(paneBox.y + paneBox.height);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      expect(await page.locator(".sa-report").evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      if (width < 1100) {
        const path = (await page.locator(".sa-header-summary .sa-path").boundingBox())!;
        const metadata = (await page.locator(".sa-header-summary .sa-report-meta").boundingBox())!;
        expect(metadata.y - path.y - path.height).toBeLessThan(24);
      }
      await page.screenshot({ path: testInfo.outputPath(`reader-${theme}-${width}.png`), fullPage: true });
    }
  }
});
