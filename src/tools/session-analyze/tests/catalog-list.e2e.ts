import { expect, test, type Page } from "@playwright/test";
import type { GeneralChatAnalyze, SessionCatalog, SessionPreview } from "../types";

const primaryProject = "D:/Synthetic/catalog-main";
const secondaryProject = "D:/Synthetic/catalog-extra";
const lateTitle = "Late unique orchard repair";
const sessions: SessionPreview[] = Array.from({ length: 80 }, (_, index) => ({
  id: `catalog-session-${index + 1}`, sourcePath: `/synthetic/session-${index + 1}.jsonl`,
  agent: index < 64 ? "codex" : index < 72 ? "claude" : "dsh",
  title: index === 73 ? lateTitle : `Session evidence ${index + 1}`,
  project: index < 72 ? primaryProject : secondaryProject,
  modifiedAt: Date.UTC(2026, 9, 27) - index * 1000, sizeBytes: 2048, tower: index % 3 === 0 ? "yes" : "no",
}));

async function installCatalogBridge(page: Page, previews = sessions) {
  const catalog: SessionCatalog = {
    sessions: previews,
    sources: (["codex", "claude", "dsh"] as const).map((agent) => ({ agent, path: `/synthetic/${agent}`, found: true })),
    warnings: [],
  };
  await page.addInitScript(({ catalog }) => {
    let nextCallbackId = 1;
    let nextEventId = 1;
    const callbacks = new Map<number, (event: unknown) => void>();
    const listeners = new Map<number, { event: string; handler: number }>();
    const calls: string[] = [];
    // Use the same callback/event protocol as the real Tauri bridge; the fixture
    // supplies session previews without touching any local agent data.
    Object.assign(window, {
      isTauri: true,
      __catalogListTest: { calls },
      __TAURI_INTERNALS__: {
        transformCallback(callback: (event: unknown) => void, once = false) {
          const id = nextCallbackId++;
          callbacks.set(id, (event) => { if (once) callbacks.delete(id); callback(event); });
          return id;
        },
        unregisterCallback(id: number) { callbacks.delete(id); },
        async invoke(command: string, args: Record<string, unknown> = {}) {
          calls.push(command);
          if (command === "plugin:event|listen") {
            const id = nextEventId++;
            listeners.set(id, { event: args.event as string, handler: args.handler as number });
            return id;
          }
          if (command === "plugin:event|unlisten") { listeners.delete(args.eventId as number); return; }
          if (["set_palette_shortcut", "palette_update_snapshot", "palette_show", "palette_hide", "pet_notify"].includes(command)) return;
          if (command === "agent_todo_state") return { items: [], history: [], enabledAt: null, paused: false, lastScanAt: null, sources: [], error: null };
          if (command === "pet_get_state") return { visible: true, badges: [], door: { url: "", listening: false } };
          if (command === "session_analyze_scan") return catalog;
          throw new Error(`Unexpected native command: ${command}`);
        },
      },
      __TAURI_EVENT_PLUGIN_INTERNALS__: {
        unregisterListener(_event: string, id: number) {
          const listener = listeners.get(id);
          if (listener) callbacks.delete(listener.handler);
          listeners.delete(id);
        },
      },
    });
  }, { catalog });
}

const catalogList = (page: Page) => page.locator('[aria-label="Sessions by project"], [aria-label="Sessions by date"]');
const analyzeButtons = (page: Page) => catalogList(page).getByRole("button", { name: /^Analyze:/ });

async function openTool(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Session analyze", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Session analyze", level: 1 })).toBeVisible();
}

test("renders every catalog match beyond fifty through search, combined filters, and clearing", async ({ page }) => {
  await installCatalogBridge(page);
  await openTool(page);
  await expect(analyzeButtons(page)).toHaveCount(80);
  await expect(catalogList(page).locator("summary .small-tag")).toHaveText(["72", "8"]);
  await expect(page.getByRole("button", { name: /^Show 50 more/ })).toHaveCount(0);
  const lateSession = catalogList(page).getByRole("button", { name: `Analyze: ${lateTitle}`, exact: true });
  await lateSession.scrollIntoViewIfNeeded();
  await expect(lateSession).toBeVisible();

  const search = page.getByRole("searchbox", { name: "Search sessions", exact: true });
  await search.fill("ORCHARD");
  await expect(analyzeButtons(page)).toHaveCount(1);
  await expect(analyzeButtons(page)).toHaveAccessibleName(`Analyze: ${lateTitle}`);
  await search.fill("Session evidence");
  await expect(analyzeButtons(page)).toHaveCount(79);
  await expect(catalogList(page).getByRole("button", { name: "Analyze: Session evidence 80", exact: true })).toBeAttached();
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await expect(analyzeButtons(page)).toHaveCount(80);

  await page.getByLabel("Project", { exact: true }).selectOption(primaryProject);
  await expect(analyzeButtons(page)).toHaveCount(72);
  await page.getByLabel("Agent platform", { exact: true }).selectOption("codex");
  await expect(analyzeButtons(page)).toHaveCount(64);
  await page.getByLabel("Tower task", { exact: true }).selectOption("no");
  const combined = sessions.filter((session) => session.project === primaryProject && session.agent === "codex" && session.tower === "no");
  await expect(analyzeButtons(page)).toHaveCount(combined.length);
  expect(await analyzeButtons(page).evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label"))))
    .toEqual(combined.map((session) => `Analyze: ${session.title}`));
  await search.fill("no matching session title");
  await expect(analyzeButtons(page)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "No sessions match these filters", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await expect(search).toHaveValue("");
  for (const label of ["Project", "Agent platform", "Tower task"]) await expect(page.getByLabel(label, { exact: true })).toHaveValue("");
  await expect(analyzeButtons(page)).toHaveCount(80);

  await page.getByLabel("Project", { exact: true }).selectOption(secondaryProject);
  await page.getByLabel("Agent platform", { exact: true }).selectOption("dsh");
  await page.getByLabel("Tower task", { exact: true }).selectOption("yes");
  await expect(analyzeButtons(page)).toHaveCount(3);
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await expect(analyzeButtons(page)).toHaveCount(80);
  expect(await page.evaluate(() => (window as typeof window & { __catalogListTest: { calls: string[] } }).__catalogListTest.calls
    .filter((command) => command === "session_analyze_run"))).toEqual([]);
});

test.describe("catalog date display", () => {
  test.use({ timezoneId: "Asia/Hong_Kong" });

  test("groups local dates and rows newest first while preserving filters and every matching preview", async ({ page }, testInfo) => {
    // The first/fourth timestamps are on the same UTC day but different local
    // days; the first/third are different UTC days but one local calendar day.
    const timestamps = [
      "2026-10-26T16:30:00Z", "2026-10-25T20:00:00Z", "2026-10-27T03:00:00Z",
      "2026-10-26T15:30:00Z", "2026-10-24T23:00:00Z",
    ];
    const unsorted = sessions.map((session, index) => ({ ...session,
      modifiedAt: index === sessions.length - 1 ? 0
        : Date.parse(timestamps[index % timestamps.length]) + Math.floor(index / timestamps.length) * 60_000,
    }));
    const byNewest = [...unsorted].sort((left, right) => right.modifiedAt - left.modifiedAt);
    const localDay = (session: SessionPreview) => new Date(session.modifiedAt + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const expectedGroups = ["2026-10-27", "2026-10-26", "2026-10-25"].map((day) => byNewest.filter((session) => localDay(session) === day));
    expectedGroups.push(byNewest.filter((session) => session.modifiedAt === 0));
    await installCatalogBridge(page, unsorted);
    await openTool(page);
    const display = page.getByLabel("Display mode", { exact: true });
    await expect(display).toHaveValue("project");
    await expect(analyzeButtons(page)).toHaveCount(80);
    await display.selectOption("date");
    await expect(catalogList(page)).toHaveAttribute("aria-label", "Sessions by date");
    await expect(analyzeButtons(page)).toHaveCount(80);
    const dateGroups = catalogList(page).locator(".sa-session-group");
    await expect(dateGroups).toHaveCount(4);
    await expect(dateGroups.last().locator("summary")).toContainText("Date unavailable");
    for (let index = 0; index < expectedGroups.length; index++) {
      await expect(dateGroups.nth(index).locator("summary .small-tag")).toHaveText(String(expectedGroups[index].length));
      expect(await dateGroups.nth(index).getByRole("button", { name: /^Analyze:/ }).evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label"))))
        .toEqual(expectedGroups[index].map((session) => `Analyze: ${session.title}`));
    }
    const lateRow = catalogList(page).getByRole("listitem").filter({ has: page.getByRole("button", { name: `Analyze: ${lateTitle}`, exact: true }) });
    await expect(lateRow).toContainText(secondaryProject);
    await expect(page.getByRole("button", { name: /^Show 50 more/ })).toHaveCount(0);
    await display.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("catalog-date-display.png"), fullPage: false });

    const search = page.getByRole("searchbox", { name: "Search sessions", exact: true });
    await search.fill("Session evidence");
    await expect(analyzeButtons(page)).toHaveCount(79);
    await display.selectOption("project");
    await expect(analyzeButtons(page)).toHaveCount(79);
    await expect(search).toHaveValue("Session evidence");
    await page.getByLabel("Project", { exact: true }).selectOption(primaryProject);
    await page.getByLabel("Agent platform", { exact: true }).selectOption("codex");
    await expect(analyzeButtons(page)).toHaveCount(64);
    await display.selectOption("date");
    await expect(analyzeButtons(page)).toHaveCount(64);
    await expect(search).toHaveValue("Session evidence");
    await expect(page.getByLabel("Project", { exact: true })).toHaveValue(primaryProject);
    await expect(page.getByLabel("Agent platform", { exact: true })).toHaveValue("codex");
    expect(await analyzeButtons(page).evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label"))))
      .toEqual(byNewest.filter((session) => session.agent === "codex").map((session) => `Analyze: ${session.title}`));

    await page.getByLabel("Tower task", { exact: true }).selectOption("no");
    const combined = byNewest.filter((session) => session.agent === "codex" && session.tower === "no");
    await expect(analyzeButtons(page)).toHaveCount(combined.length);
    await display.selectOption("project");
    await expect(analyzeButtons(page)).toHaveCount(combined.length);
    await expect(page.getByLabel("Tower task", { exact: true })).toHaveValue("no");
    await expect(search).toHaveValue("Session evidence");
    await display.selectOption("date");
    expect(await analyzeButtons(page).evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label"))))
      .toEqual(combined.map((session) => `Analyze: ${session.title}`));
    await page.getByRole("button", { name: "Clear filters", exact: true }).click();
    await expect(display).toHaveValue("date");
    await expect(analyzeButtons(page)).toHaveCount(80);
    expect(await page.evaluate(() => (window as typeof window & { __catalogListTest: { calls: string[] } }).__catalogListTest.calls
      .filter((command) => command === "session_analyze_run"))).toEqual([]);
  });
});

function longReport(): GeneralChatAnalyze {
  return {
    schemaVersion: 1,
    session: { ...sessions[0], id: "full-lists", title: "Complete file and usage evidence" },
    analyzedAt: "2026-10-27T00:00:00Z",
    events: Array.from({ length: 125 }, (_, index) => ({ id: `event-${index + 1}`, order: index + 1,
      timestamp: "2026-10-27T00:00:00Z", kind: "tool", name: index < 120 ? "Read source" : "Write source",
      role: null, text: `Synthetic operation ${index + 1}`, callId: `call-${index + 1}`, status: "observed", source: `synthetic:${index + 1}` })),
    files: Array.from({ length: 125 }, (_, index) => ({ path: `src/file-${index + 1}.ts`, operation: index < 120 ? "read" : "write",
      eventId: `event-${index + 1}`, evidence: "explicit" })),
    usage: { inputTokens: 125000, outputTokens: 12500, cachedInputTokens: 0, reasoningTokens: null, basis: "125 synthetic usage samples" },
    usageSamplesComplete: true,
    usageSamples: Array.from({ length: 125 }, (_, index) => ({ id: `usage-${index + 1}`, model: "deepseek-flash", timestamp: "2026-10-27T00:00:00Z",
      inputTokens: 1000, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 100, source: `synthetic-usage:${index + 1}` })),
    cost: { amount: 0.02, currency: "USD", basis: "reported", detail: "Synthetic recorded cost" }, warnings: [],
  };
}

test("shows all file operations and priced usage records beyond one hundred without another gate", async ({ page }) => {
  await openTool(page);
  const report = longReport();
  await page.getByLabel("Import analysis JSON", { exact: true }).setInputFiles({
    name: "full-lists.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(report)),
  });
  await expect(page.locator(".sa-header-summary").getByRole("heading", { name: report.session.title, exact: true })).toBeVisible();
  const reportTabs = page.getByRole("tablist", { name: "Report sections" });
  await reportTabs.getByRole("tab", { name: /^Files(?:\s|$)/ }).click();
  const operations = page.getByRole("table", { name: "File operations", exact: true });
  await expect(operations.getByRole("row")).toHaveCount(126);
  await expect(page.getByRole("button", { name: "Show 100 more file operations", exact: true })).toHaveCount(0);
  const lastFile = operations.getByRole("row").filter({ hasText: "src/file-125.ts" });
  await lastFile.scrollIntoViewIfNeeded();
  await expect(lastFile).toBeVisible();
  await page.getByLabel("File operation", { exact: true }).selectOption("read");
  await expect(operations.getByRole("row")).toHaveCount(121);
  await page.getByRole("searchbox", { name: "Search files", exact: true }).fill("src/file-");
  await expect(operations.getByRole("row")).toHaveCount(121);
  await page.getByRole("searchbox", { name: "Search files", exact: true }).fill("src/file-119.ts");
  await expect(operations.getByRole("row")).toHaveCount(2);
  await expect(operations).toContainText("src/file-119.ts");
  await page.getByRole("searchbox", { name: "Search files", exact: true }).fill("");
  await page.getByLabel("File operation", { exact: true }).selectOption("");
  await expect(operations.getByRole("row")).toHaveCount(126);

  await reportTabs.getByRole("tab", { name: "Cost", exact: true }).click();
  const prices = page.getByRole("region", { name: "JSON model pricing", exact: true });
  await expect(prices).toContainText("125 / 125 usage records priced");
  await expect(prices.getByRole("heading", { name: "Usage pricing breakdown (125)", exact: true })).toBeVisible();
  const usage = prices.getByRole("table", { name: "Usage pricing breakdown", exact: true });
  await expect(usage.getByRole("row")).toHaveCount(126);
  await expect(page.getByRole("button", { name: "Show 100 more priced calls", exact: true })).toHaveCount(0);
  const lastUsage = usage.getByRole("row").filter({ hasText: "usage-125" });
  await lastUsage.scrollIntoViewIfNeeded();
  await expect(lastUsage).toBeVisible();
});
