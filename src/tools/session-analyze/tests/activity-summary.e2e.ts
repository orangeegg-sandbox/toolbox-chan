import { expect, test, type Page } from "@playwright/test";
import type { GeneralChatAnalyze, SessionEvent } from "../types";

function event(order: number, overrides: Partial<SessionEvent> = {}): SessionEvent {
  return { id: `activity-${order}`, order, timestamp: "2026-10-27T00:00:00Z", kind: "tool", name: "exec_command",
    role: "assistant", text: "{}", callId: `call-${order}`, status: "success", source: `fixture record ${order}`, ...overrides };
}

function report(): GeneralChatAnalyze {
  return {
    schemaVersion: 1,
    session: { id: "activity-fixture", sourcePath: "/fixtures/activity.jsonl", agent: "codex", title: "Activity drilldown fixture",
      project: "/fixtures/project", modifiedAt: Date.UTC(2026, 9, 27), sizeBytes: 4096, tower: "unknown" },
    analyzedAt: "2026-10-27T00:00:00Z",
    events: [
      event(1, { kind: "context", name: "Workspace instructions", text: "Follow project instructions.", role: "developer", callId: null, status: "observed" }),
      event(2, { kind: "message", name: "User request", text: "Inspect activity.", role: "user", callId: null, status: "observed" }),
      event(3, { text: '{"cmd":"rg alpha ./src"}' }),
      event(4, { callId: "call-3", text: '{"cmd":"rg alpha ./src"}' }),
      event(5, { callId: "call-3", role: "tool", text: 'Result: {"cmd":"rg should-not-be-a-command"}' }),
      event(6, { name: "functions.exec_command", text: '{"cmd":"rg beta ./docs"}' }),
      event(7, { callId: null, status: "unknown", text: "{cmd:'git status',workdir:'/fixtures/project'}\n\nResult (parsed record 8):\nOutput mentions rg alpha but adds no command call." }),
      event(8, { kind: "mcp", name: "mcp__docs__search", text: '{"query":"alpha"}' }),
      event(9, { kind: "mcp", name: "mcp__docs_extra__search", text: '{"query":"beta"}' }),
      event(10, { kind: "mcp", name: "mcp.docs.read", text: '{"path":"alpha"}', status: "error" }),
      event(11, { kind: "skill", name: "Skill: review", text: '{"skill":"review"}', status: "observed" }),
      event(12, { kind: "compaction", name: "Context compaction", text: "Earlier records summarized.", callId: null, status: "observed" }),
    ],
    files: [],
    usage: { inputTokens: null, outputTokens: null, cachedInputTokens: null, reasoningTokens: null, basis: "No usage in fixture." },
    cost: { amount: null, currency: "USD", basis: "unknown", detail: "No price in fixture." },
    warnings: [],
  };
}

const tab = (page: Page, name: string) => page.getByRole("tablist", { name: "Report sections" })
  .getByRole("tab", { name: new RegExp(`^${name}(?:\\s|$)`) });
const entries = (page: Page) => page.getByRole("list", { name: "Session events" }).getByRole("listitem");
async function expectIds(page: Page, ids: number[]) {
  await expect(entries(page)).toHaveCount(ids.length);
  expect(await entries(page).evaluateAll((elements) => elements.map((element) => element.id)))
    .toEqual(ids.map((id) => `sa-event-activity-${id}`));
}

test("activity charts preserve call accounting and drill into exact evidence across names and command arguments", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Session analyze", exact: true }).click();
  await page.getByLabel("Import analysis JSON", { exact: true }).setInputFiles({
    name: "activity-fixture.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(report())),
  });
  await expect(page.getByRole("heading", { name: "Activity drilldown fixture", exact: true })).toBeVisible();
  await expect(tab(page, "Overview")).toHaveAttribute("aria-selected", "true");
  await expect(tab(page, "Tools").locator(".sa-tab-count")).toHaveText("3");
  await expect(tab(page, "MCP").locator(".sa-tab-count")).toHaveText("3");
  await expect(tab(page, "Skills").locator(".sa-tab-count")).toHaveText("1");
  await expect(tab(page, "Context").locator(".sa-tab-count")).toHaveText("3");
  await expect(tab(page, "Flow").locator(".sa-tab-count")).toHaveText("12");
  const summary = page.getByRole("region", { name: "Activity summary", exact: true });
  await expect(summary).toContainText("10 evidence events");
  await expect(summary).toContainText("6 recorded calls");
  await expect(summary).toContainText("1 uncertain calls");

  await tab(page, "Overview").focus();
  await page.keyboard.press("ArrowRight");
  await expect(tab(page, "Flow")).toBeFocused();
  await expect(tab(page, "Flow")).toHaveAttribute("aria-selected", "true");
  await expect(entries(page)).toHaveCount(12);
  await page.keyboard.press("End");
  await expect(tab(page, "Cost")).toBeFocused();
  await expect(tab(page, "Cost")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Home");
  await expect(tab(page, "Overview")).toBeFocused();
  await expect(tab(page, "Overview")).toHaveAttribute("aria-selected", "true");

  await page.getByRole("region", { name: "Events by kind", exact: true }).getByRole("button", { name: /^Tools: 3 events/ }).click();
  await expect(tab(page, "Tools")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".sa-selection")).toHaveText("Showing: Tools");
  await expectIds(page, [3, 6, 7]);

  await page.getByRole("region", { name: "Tool calls", exact: true }).getByRole("button", { name: /^exec_command: 2 events/ }).click();
  await expectIds(page, [3, 7]);
  await page.getByRole("region", { name: "Command frequency", exact: true }).getByRole("button", { name: /^rg: 2 events/ }).click();
  await expectIds(page, [3, 6]);
  await expect(page.locator(".sa-selection")).toHaveText("Showing: rg");
  await expect(tab(page, "Tools").locator(".sa-tab-count")).toHaveText("3");
  await page.getByLabel("Search tools", { exact: true }).fill("ALPHA");
  await expectIds(page, [3]);
  await entries(page).locator("summary").click();
  await expect(entries(page).locator("pre mark")).toHaveText("alpha");
  await page.getByLabel("Search tools", { exact: true }).fill("");
  await page.getByRole("button", { name: "Clear selection", exact: true }).click();
  await page.getByLabel("Outcome", { exact: true }).selectOption("unknown");
  await expectIds(page, [7]);

  await tab(page, "MCP").click();
  await expectIds(page, [8, 9, 10]);
  await page.getByRole("region", { name: "MCP servers", exact: true }).getByRole("button", { name: /^docs: 2 events/ }).click();
  await expectIds(page, [8, 10]);
  await expect(page.locator(".sa-selection")).toContainText("mcp__docs__");
  await page.getByRole("region", { name: "MCP servers", exact: true }).getByRole("button", { name: /^docs_extra: 1 events/ }).click();
  await expectIds(page, [9]);
  await page.getByRole("button", { name: "Clear selection", exact: true }).click();
  await page.getByLabel("Search mcp", { exact: true }).fill("docs");
  await expectIds(page, [8, 9, 10]);
  await expect(entries(page).locator("summary mark")).toHaveCount(3);
  await page.screenshot({ path: testInfo.outputPath("activity-chart-drilldown.png"), fullPage: true });
});

test("named timelines preserve session gaps and link exact hover and keyboard focus across colors and evidence", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Session analyze", exact: true }).click();
  await page.getByLabel("Import analysis JSON", { exact: true }).setInputFiles({
    name: "activity-timeline.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(report())),
  });
  await expect(page.getByRole("heading", { name: "Activity drilldown fixture", exact: true })).toBeVisible();
  await tab(page, "Tools").click();
  const timeline = page.getByRole("region", { name: "Source order activity", exact: true });
  const buckets = timeline.locator(".sa-activity-bucket");
  await expect(buckets).toHaveCount(12);
  await expect(buckets.first()).toHaveAttribute("data-first-order", "1");
  await expect(buckets.last()).toHaveAttribute("data-last-order", "12");
  expect(await buckets.evaluateAll((elements) => elements.map((element) => Number(element.getAttribute("data-selected-count")))))
    .toEqual([0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0]);
  await expect(timeline.locator(".sa-activity-bucket.is-gap")).toHaveCount(9);

  const firstSegment = timeline.locator('[data-first-order="3"] .sa-activity-segment');
  const secondSegment = timeline.locator('[data-first-order="6"] .sa-activity-segment');
  const firstColor = await firstSegment.getAttribute("data-color");
  const secondColor = await secondSegment.getAttribute("data-color");
  expect(firstColor).not.toBe(secondColor);
  const firstFill = await firstSegment.evaluate((element) => getComputedStyle(element).backgroundColor);
  const secondFill = await secondSegment.evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(firstFill).not.toBe(secondFill);
  const tools = page.getByRole("region", { name: "Tool calls", exact: true });
  const firstTool = tools.getByRole("button", { name: /^exec_command: 2 events/ });
  await expect(firstTool.locator(".sa-frequency-fill")).toHaveAttribute("data-color", firstColor!);
  expect(await firstTool.locator(".sa-frequency-fill").evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(firstFill);
  const legend = timeline.getByRole("list", { name: "Source order legend", exact: true });
  await expect(legend.getByRole("button", { name: /^exec_command: 2 events/ }).locator(".sa-activity-swatch"))
    .toHaveAttribute("data-color", firstColor!);

  const highlightedOrders = async () => timeline.locator('.sa-activity-bucket:has([data-highlighted="true"])')
    .evaluateAll((elements) => elements.map((element) => Number(element.getAttribute("data-first-order"))));
  await firstTool.hover();
  await expect(timeline.getByRole("status")).toHaveText("2 matching events highlighted");
  expect(await highlightedOrders()).toEqual([3, 7]);
  await expect(secondSegment).toHaveClass(/is-dimmed/);
  await tab(page, "Tools").hover();
  await expect(timeline.locator('[data-highlighted="true"]')).toHaveCount(0);
  await firstTool.focus();
  await expect(timeline.getByRole("status")).toHaveText("2 matching events highlighted");
  expect(await highlightedOrders()).toEqual([3, 7]);
  await page.getByLabel("Search tools", { exact: true }).focus();
  await expect(timeline.locator('[data-highlighted="true"]')).toHaveCount(0);

  const secondLegend = legend.getByRole("button", { name: /^functions\.exec_command: 1 events/ });
  await secondLegend.focus();
  await expect(timeline.getByRole("status")).toHaveText("1 matching event highlighted");
  expect(await highlightedOrders()).toEqual([6]);
  await secondLegend.click();
  await expectIds(page, [6]);
  await expect(buckets).toHaveCount(12);
  await expect(firstSegment).toHaveAttribute("data-color", firstColor!);
  await expect(secondSegment).toHaveAttribute("data-color", secondColor!);
  await expect(firstSegment).toHaveClass(/is-dimmed/);
  await expect(timeline.locator(".sa-timeline-position")).toContainText("1 match evidence filters");
  await expect(timeline.locator(".sa-timeline-position")).toContainText("Reading #6");

  await tab(page, "MCP").click();
  const mcpColors = await timeline.locator(".sa-activity-segment").evaluateAll((elements) => elements.map((element) => element.getAttribute("data-color")));
  expect(new Set(mcpColors).size).toBe(3);
  const docs = page.getByRole("region", { name: "MCP servers", exact: true }).getByRole("button", { name: /^docs: 2 events/ });
  await docs.hover();
  await expect(timeline.getByRole("status")).toHaveText("2 matching events highlighted");
  expect(await highlightedOrders()).toEqual([8, 10]);
  await expect(timeline.locator('[data-first-order="9"] .sa-activity-segment')).toHaveClass(/is-dimmed/);

  await tab(page, "Context").click();
  expect(new Set(await timeline.locator(".sa-activity-segment").evaluateAll((elements) => elements.map((element) => element.getAttribute("data-color")))).size).toBe(3);
  await expect(buckets).toHaveCount(12);
});

test("all activity frequencies and command groups remain scrollable without a More gate", async ({ page }) => {
  const value = report();
  value.events = [
    ...Array.from({ length: 55 }, (_, index) => event(index + 1, {
      kind: "mcp", name: `mcp__fixture__tool_${String(index + 1).padStart(2, "0")}`,
    })),
    ...Array.from({ length: 8 }, (_, index) => event(index + 56, {
      text: JSON.stringify({ cmd: `command-${String(index + 1).padStart(2, "0")} --help` }),
    })),
  ];
  await page.goto("/");
  await page.getByRole("button", { name: "Session analyze", exact: true }).click();
  await page.getByLabel("Import analysis JSON", { exact: true }).setInputFiles({
    name: "all-activity-frequencies.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(value)),
  });
  await expect(page.getByRole("heading", { name: value.session.title, exact: true })).toBeVisible();
  await tab(page, "MCP").click();
  const tools = page.getByRole("region", { name: "MCP tools", exact: true });
  const frequencies = tools.getByRole("list", { name: "MCP tools", exact: true });
  await expect(frequencies.getByRole("button")).toHaveCount(55);
  await expect(tools.getByText(/^More /)).toHaveCount(0);
  const lastTool = frequencies.getByRole("button", { name: /^mcp__fixture__tool_55: 1 events/ });
  await lastTool.scrollIntoViewIfNeeded();
  await expect(lastTool).toBeInViewport();
  expect(await frequencies.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await lastTool.click();
  await expectIds(page, [55]);

  await tab(page, "Tools").click();
  const commands = page.getByRole("region", { name: "Command frequency", exact: true });
  await expect(commands.getByRole("button")).toHaveCount(8);
  await expect(commands.getByText(/^More /)).toHaveCount(0);
  const previews = page.getByRole("region", { name: "Recorded command previews", exact: true });
  await expect(previews.locator(".sa-command-example")).toHaveCount(8);
  const lastPreview = previews.getByRole("heading", { name: "command-08 (1)", exact: true });
  await lastPreview.scrollIntoViewIfNeeded();
  await expect(lastPreview).toBeInViewport();
  const lastCommand = commands.getByRole("button", { name: /^command-08: 1 events/ });
  await lastCommand.scrollIntoViewIfNeeded();
  await lastCommand.click();
  await expectIds(page, [63]);
});
