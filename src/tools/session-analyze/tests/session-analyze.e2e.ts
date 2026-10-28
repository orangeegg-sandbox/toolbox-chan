import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { parseReport } from "../import";
import type { GeneralChatAnalyze, SessionEvent, SessionPreview } from "../types";

function event(order: number, kind: SessionEvent["kind"], name: string, text: string): SessionEvent {
  return { id: `event-${order}`, order, kind, name, text, timestamp: "2026-10-27T00:00:00Z",
    role: kind === "message" ? "user" : null, callId: kind === "tool" || kind === "mcp" ? `call-${order}` : null,
    status: "observed", source: `synthetic-session.jsonl:${order}` };
}

function report(overrides: Partial<SessionPreview> = {}): GeneralChatAnalyze {
  return {
    schemaVersion: 1,
    session: { id: "synthetic-codex", sourcePath: "/synthetic/codex.jsonl", agent: "codex", title: "Review session evidence",
      project: "D:\\Work\\demo-app", modifiedAt: Date.UTC(2026, 9, 27), sizeBytes: 8192, tower: "yes", ...overrides },
    analyzedAt: "2026-10-27T00:00:00Z",
    events: [
      event(1, "context", "Workspace instructions", "Instructions loaded from AGENTS.md."),
      event(2, "message", "User request", "Review the project."),
      event(3, "skill", "review-safety", "Loaded the review-safety skill."),
      event(4, "mcp", "mcp__docs__lookup", "Documentation lookup result."),
      event(5, "tool", "Read source", "Read src/main.ts."),
      event(6, "tool", "Read source again", "Read src/main.ts a second time."),
      event(7, "tool", "Edit tests", "Updated src/main.test.ts through the shell."),
      event(8, "compaction", "Context compaction", "Earlier conversation summarized."),
    ],
    files: [
      { path: "src/main.ts", operation: "read", eventId: "event-5", evidence: "explicit" },
      { path: "src/main.ts", operation: "read", eventId: "event-6", evidence: "explicit" },
      { path: "src/main.test.ts", operation: "write", eventId: "event-7", evidence: "inferred" },
    ],
    usage: { inputTokens: 2_000_000, cachedInputTokens: 500_000, outputTokens: 250_000, reasoningTokens: null, basis: "Synthetic provider totals including cached input." },
    cost: { amount: null, currency: "USD", basis: "unknown", detail: "No price recorded in this synthetic session." },
    warnings: ["Synthetic fixture; recorded evidence does not prove complete context visibility."],
  };
}

async function openTool(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Session analyze", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Session analyze", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Import report", exact: true })).toBeEnabled();
}

async function importReport(page: Page, value: GeneralChatAnalyze) {
  await page.getByLabel("Import analysis JSON", { exact: true }).setInputFiles({
    name: `${value.session.id}.json`, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(value)),
  });
  await expect(page.locator(".sa-header-summary").getByRole("heading", { name: value.session.title, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Import report", exact: true })).toBeEnabled();
}

const events = (page: Page) => page.getByRole("list", { name: "Session events" }).getByRole("listitem");
const catalog = (page: Page) => page.locator('[aria-label="Sessions by project"]');
const analyzeButtons = (page: Page) => catalog(page).getByRole("button", { name: /^Analyze:/ });
const section = (page: Page, name: string) => page.getByRole("tablist", { name: "Report sections" }).getByRole("tab", { name: new RegExp(`^${name}(?:\\s|$)`) });
const workspace = (page: Page, name: string) => page.getByRole("tablist", { name: "Session analyze views" }).getByRole("tab", { name: new RegExp(`^${name}(?:\\s|$)`) });

function pricedReport(): GeneralChatAnalyze {
  const value = report({ agent: "dsh", id: "priced-session", title: "Mixed models across pricing periods" });
  value.usage.outputTokens = 200_000;
  value.usageSamplesComplete = true;
  value.usageSamples = [
    { id: "peak", model: "deepseek-flash", timestamp: "2026-10-27T02:00:00Z", inputTokens: 1_000_000, cachedInputTokens: 250_000, cacheWriteInputTokens: 0, outputTokens: 100_000, source: "synthetic usage 1" },
    { id: "offpeak", model: "deepseek-v4-pro", timestamp: "2026-10-27T04:00:00Z", inputTokens: 1_000_000, cachedInputTokens: 250_000, cacheWriteInputTokens: 0, outputTokens: 100_000, source: "synthetic usage 2" },
  ];
  return value;
}

test("prices mixed models at their recorded peak and off-peak times and exports the attribution", async ({ page }, testInfo) => {
  await openTool(page);
  await importReport(page, pricedReport());
  await expect(page.locator(".sa-metrics")).toContainText("$1.045");
  await expect(page.locator(".sa-metrics")).toContainText("estimated · USD");
  await section(page, "Cost").click();
  await expect(page.getByText("JSON token estimate: $1.045000 USD", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "JSON model pricing" })).toContainText("2 / 2 usage records priced");
  await page.getByRole("button", { name: "Reload prices", exact: true }).click();
  await expect(page.getByRole("button", { name: "Use JSON estimate in report", exact: true })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("session-pricing.png"), fullPage: true });
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON", exact: true }).click();
  const downloadedPath = await (await downloadEvent).path();
  const exported = parseReport(await readFile(downloadedPath!, "utf8"));
  expect(exported.cost.amount).toBeCloseTo(1.045);
  expect(exported.cost.detail).toContain("deepseek");
  expect(exported.usageSamples).toEqual(pricedReport().usageSamples);
  expect(exported.usageSamplesComplete).toBe(true);
});

test("preserves recorded costs and refuses to save an incomplete JSON subtotal", async ({ page }) => {
  await openTool(page);
  const recorded = pricedReport();
  recorded.cost = { amount: 2.5, currency: "USD", basis: "reported", detail: "Provider recorded this cost." };
  await importReport(page, recorded);
  await expect(page.locator(".sa-metrics")).toContainText("$2.5");
  await section(page, "Cost").click();
  await expect(page.getByText("JSON token estimate: $1.045000 USD", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Use JSON estimate in report", exact: true })).toBeDisabled();

  const partial = pricedReport();
  partial.usageSamples![1].model = "unknown-model";
  await importReport(page, partial);
  await section(page, "Cost").click();
  await expect(page.locator(".sa-metrics")).toContainText("unknown · USD");
  await expect(page.getByText("Partial token subtotal: $0.346500 USD", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Use JSON estimate in report", exact: true })).toBeDisabled();
});

test("imports a portable report and separates flow, skills, MCP, tools, files, and context evidence", async ({ page }, testInfo) => {
  await openTool(page);
  await expect(page.getByText(/Local session discovery and project coverage need the desktop app/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh sessions" })).toBeDisabled();
  await importReport(page, report());
  await section(page, "Flow").click();
  await expect(events(page)).toHaveCount(8);
  await page.screenshot({ path: testInfo.outputPath("session-analyze.png"), fullPage: true });
  expect(await events(page).locator("strong").allTextContents()).toEqual(report().events.map((entry) => entry.name));
  await page.getByLabel("Search flow", { exact: true }).fill("synthetic-session.jsonl:4");
  await expect(events(page)).toHaveCount(1);
  await events(page).locator("summary").click();
  await expect(events(page)).toContainText("Evidence: synthetic-session.jsonl:4");

  for (const [name, expectedNames] of [
    ["Skills", ["review-safety"]], ["MCP", ["mcp__docs__lookup"]],
    ["Tools", ["Read source", "Read source again", "Edit tests"]],
  ] as const) {
    await section(page, name).click();
    await expect(events(page)).toHaveCount(expectedNames.length);
    expect(await events(page).locator("strong").allTextContents()).toEqual(expectedNames);
  }

  await section(page, "Files").click();
  const fileOperations = page.getByRole("table", { name: "File operations", exact: true });
  await expect(fileOperations.getByRole("row")).toHaveCount(4);
  await page.getByLabel("File operation", { exact: true }).selectOption("write");
  await expect(fileOperations.getByRole("row")).toHaveCount(2);
  await expect(fileOperations).toContainText("src/main.test.ts");
  await expect(fileOperations).toContainText("inferred");
  await expect(page.getByRole("button", { name: "Scan project structure" })).toBeDisabled();
  await fileOperations.getByRole("button", { name: "#7", exact: true }).click();
  await expect(section(page, "Flow")).toHaveAttribute("aria-selected", "true");
  await expect(events(page)).toHaveCount(1);
  await expect(events(page)).toContainText("Edit tests");

  await section(page, "Context").click();
  await expect(events(page)).toHaveCount(3);
  expect(await events(page).locator("strong").allTextContents()).toEqual(["Workspace instructions", "review-safety", "Context compaction"]);
  await expect(page.getByText("Skill catalogs do not prove that skills were loaded. Text size below measures logged characters, not tokens or exact context-window occupancy.", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Repeated file reads\s+1$/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "src/main.ts 2×", exact: true })).toBeVisible();
});

test("groups multiple imports by project and combines search, platform and Tower filters before reopening a report", async ({ page }) => {
  await openTool(page);
  const first = report();
  const second = report({ id: "synthetic-claude", sourcePath: "/synthetic/claude.jsonl", agent: "claude", title: "Claude documentation", tower: "no" });
  const third = report({ id: "synthetic-dsh", sourcePath: "/synthetic/dsh.jsonl", agent: "dsh", title: "DSH API checks", project: "/srv/demo-api", tower: "unknown" });
  for (const value of [first, second, third]) await importReport(page, value);
  await workspace(page, "Sessions").click();
  await expect(analyzeButtons(page)).toHaveCount(3);
  await expect(catalog(page).locator("summary strong")).toHaveText(["demo-api", "demo-app"]);
  await expect(catalog(page).locator("summary .small-tag")).toHaveText(["1", "2"]);
  await page.getByLabel("Project", { exact: true }).selectOption("D:\\Work\\demo-app");
  await expect(analyzeButtons(page)).toHaveCount(2);
  await page.getByLabel("Agent platform", { exact: true }).selectOption("codex");
  await page.getByLabel("Tower task", { exact: true }).selectOption("yes");
  await expect(analyzeButtons(page)).toHaveCount(1);
  await expect(analyzeButtons(page)).toHaveAccessibleName("Analyze: Imported · Review session evidence");
  await page.getByLabel("Search sessions", { exact: true }).fill("DOCUMENTATION");
  await expect(page.getByRole("heading", { name: "No sessions match these filters", exact: true })).toBeVisible();
  await page.getByLabel("Agent platform", { exact: true }).selectOption("claude");
  await page.getByLabel("Tower task", { exact: true }).selectOption("no");
  await expect(analyzeButtons(page)).toHaveCount(1);
  await analyzeButtons(page).click();
  await expect(page.locator(".sa-header-summary").getByRole("heading", { name: second.session.title, exact: true })).toBeVisible();

  await workspace(page, "Sessions").click();
  await page.getByLabel("Project", { exact: true }).selectOption("");
  await page.getByLabel("Agent platform", { exact: true }).selectOption("");
  await page.getByLabel("Tower task", { exact: true }).selectOption("unknown");
  await page.getByLabel("Search sessions", { exact: true }).fill("SYNTHETIC-DSH");
  await expect(analyzeButtons(page)).toHaveCount(1);
  await expect(analyzeButtons(page)).toHaveAccessibleName("Analyze: Imported · DSH API checks");
  await page.getByLabel("Tower task", { exact: true }).selectOption("");
  await page.getByLabel("Search sessions", { exact: true }).fill("");
  await catalog(page).getByRole("button", { name: "Analyze: Imported · Review session evidence", exact: true }).click();
  await expect(page.locator(".sa-header-summary").getByRole("heading", { name: first.session.title, exact: true })).toBeVisible();
  await section(page, "Flow").click();
  await expect(events(page)).toHaveCount(8);
});

test("keeps a valid report after invalid import and exports a re-importable cost estimate", async ({ page }) => {
  await openTool(page);
  const original = report();
  await importReport(page, original);
  await page.getByLabel("Import analysis JSON", { exact: true }).setInputFiles({
    name: "invalid.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ ...original, schemaVersion: 999 })),
  });
  await expect(page.getByRole("alert")).toContainText("schemaVersion");
  await expect(page.locator(".sa-header-summary").getByRole("heading", { name: original.session.title, exact: true })).toBeVisible();
  await workspace(page, "Sessions").click();
  await expect(analyzeButtons(page)).toHaveCount(1);
  await workspace(page, "Analysis").click();
  await section(page, "Flow").click();
  await expect(events(page)).toHaveCount(8);

  await section(page, "Cost").click();
  await page.locator("summary").filter({ hasText: "Manual whole-session estimate" }).click();
  await expect(page.getByRole("button", { name: "Use estimate in report" })).toBeDisabled();
  await page.getByLabel("Uncached input price per million tokens", { exact: true }).fill("2");
  await page.getByLabel("Cached input price per million tokens", { exact: true }).fill("0.5");
  await page.getByLabel("Output price per million tokens", { exact: true }).fill("8");
  await section(page, "Flow").click();
  await section(page, "Cost").click();
  await page.locator("summary").filter({ hasText: "Manual whole-session estimate" }).click();
  await expect(page.getByText("Estimated API cost: $5.250000 USD", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Use estimate in report" }).click();
  await expect(page.locator(".sa-metrics")).toContainText("$5.25");
  await expect(page.locator(".sa-metrics")).toContainText("estimated · USD");

  await importReport(page, report({ id: "second-session", sourcePath: "/synthetic/second.jsonl", title: "Another report" }));
  await workspace(page, "Sessions").click();
  await catalog(page).getByRole("button", { name: "Analyze: Imported · Review session evidence", exact: true }).click();
  await expect(page.locator(".sa-metrics")).toContainText("$5.25");

  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON", exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe("synthetic-codex.analysis.json");
  const downloadedPath = await download.path();
  expect(downloadedPath).not.toBeNull();
  const exported = parseReport(await readFile(downloadedPath!, "utf8"));
  expect(exported.session).toEqual(original.session);
  expect(exported.events).toEqual(original.events);
  expect(exported.files).toEqual(original.files);
  expect(exported.usage).toEqual(original.usage);
  expect(exported.cost).toMatchObject({ amount: 5.25, currency: "USD", basis: "estimated" });
  expect(exported.cost.detail).toContain("User-supplied USD rates");
  await importReport(page, exported);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.locator(".sa-metrics")).toContainText("$5.25");
  await workspace(page, "Sessions").click();
  await expect(analyzeButtons(page)).toHaveCount(2);
});

test("retains evidence in light and dark themes at 175% text size without page overflow", async ({ page }) => {
  await openTool(page);
  const value = report({ project: `D:\\Work\\${"long-project-folder-".repeat(12)}` });
  value.events[4].text = "UnbrokenText".repeat(80);
  value.files[0].path = `src/${"long-folder-name/".repeat(12)}main.ts`;
  await importReport(page, value);
  for (const theme of ["dark", "light"] as const) {
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByLabel("Color theme", { exact: true }).selectOption(theme);
    await page.getByLabel("Font size", { exact: true }).selectOption("175");
    await page.getByRole("button", { name: "Session analyze", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(page.locator("html")).toHaveAttribute("data-ui-font-size", "175");
    await expect(page.locator(".sa-header-summary").getByRole("heading", { name: value.session.title, exact: true })).toBeVisible();
    for (const width of [1280, 900, 780]) {
      await page.setViewportSize({ width, height: 900 });
      for (const view of ["Flow", "Files", "Context"]) {
        await section(page, view).click();
        if (view === "Flow") await events(page).nth(4).locator("summary").click();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
        expect(await page.locator(".sa-report").evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      }
    }
  }
});
