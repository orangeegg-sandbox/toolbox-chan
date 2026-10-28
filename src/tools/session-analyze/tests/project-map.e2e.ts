import { expect, test, type Page } from "@playwright/test";
import type { FileActivity, GeneralChatAnalyze, ProjectCoverage, SessionEvent } from "../types";

interface NativeCall { command: string; args: Record<string, unknown> }
type TestWindow = typeof window & { __projectMapTest: { calls: NativeCall[]; ignoredPaths: string[] } };
const snapshotTime = Date.UTC(2026, 9, 27, 6);
const project = "D:/Synthetic/project-map-demo";

function syntheticReport(): GeneralChatAnalyze {
  const events: SessionEvent[] = ["read", "write", "read", "write", "failed read"].map((name, index) => ({
    id: `event-${index}`, order: index + 1, timestamp: "2026-10-27T06:00:00Z", kind: "tool", name,
    role: null, text: `Synthetic ${name} evidence`, callId: `call-${index}`,
    status: index === 4 ? "error" : "success", source: `synthetic-session.jsonl:${index + 1}`,
  }));
  return {
    schemaVersion: 1,
    session: { id: "project-map-session", sourcePath: "/synthetic/project-map.jsonl", agent: "codex",
      title: "Explore recorded project activity", project, modifiedAt: snapshotTime, sizeBytes: 2048, tower: "yes" },
    analyzedAt: "2026-10-27T06:00:00Z", events,
    files: [
      { path: "src/main.ts", operation: "read", eventId: "event-0", evidence: "explicit" },
      { path: "src/main.ts", operation: "write", eventId: "event-1", evidence: "explicit" },
      { path: "src/lib/utils.ts", operation: "read", eventId: "event-2", evidence: "explicit" },
      { path: "src/lib/new.ts", operation: "write", eventId: "event-3", evidence: "explicit" },
      { path: "src/untouched.ts", operation: "read", eventId: "event-4", evidence: "explicit" },
    ],
    usage: { inputTokens: 1000, outputTokens: 100, cachedInputTokens: 0, reasoningTokens: null, basis: "Synthetic totals" },
    cost: { amount: 0.01, currency: "USD", basis: "reported", detail: "Synthetic reported cost" }, warnings: [],
  };
}

async function installNativeBridge(page: Page, report = syntheticReport(), suppliedUnmatched?: ProjectCoverage["unmatchedFiles"], componentCount = 24) {
  await page.addInitScript(({ report, snapshotTime, suppliedUnmatched, componentCount }) => {
    let nextCallbackId = 1;
    let nextEventId = 1;
    const callbacks = new Map<number, (event: unknown) => void>();
    const listeners = new Map<number, { event: string; handler: number }>();
    const bridge = { calls: [] as NativeCall[], ignoredPaths: ["src/main.ts", "docs/history.md"] };
    const file = (path: string): ProjectCoverage["entries"][number] => ({ path, kind: "file", excluded: false });
    const directory = (path: string, excluded = false): ProjectCoverage["entries"][number] => ({ path, kind: "directory", excluded });
    const baseEntries: ProjectCoverage["entries"] = [
      directory("src"), directory("src/components"), directory("src/lib"),
      file("src/main.ts"), file("src/lib/utils.ts"), file("src/lib/new.ts"), file("src/untouched.ts"), file("src/styles.css"),
      ...Array.from({ length: componentCount }, (_, index) => file(`src/components/component-${index + 1}.tsx`)),
      directory("docs"), directory("docs/empty"), file("docs/guide.md"), file("docs/history.md"),
      directory("tests"), file("tests/main.test.ts"), directory("assets"), file("assets/icon.svg"),
      directory("public"), file("public/robots.txt"), directory("empty-root"), file("README.md"), file("package.json"),
      directory(".git", true), directory("node_modules", true), directory("dist", true),
    ];
    Object.assign(window, {
      isTauri: true,
      __projectMapTest: bridge,
      __TAURI_INTERNALS__: {
        transformCallback(callback: (event: unknown) => void, once = false) {
          const id = nextCallbackId++;
          callbacks.set(id, (event) => { if (once) callbacks.delete(id); callback(event); });
          return id;
        },
        unregisterCallback(id: number) { callbacks.delete(id); },
        async invoke(command: string, args: Record<string, unknown> = {}) {
          bridge.calls.push({ command, args });
          if (command === "plugin:event|listen") {
            const id = nextEventId++;
            listeners.set(id, { event: args.event as string, handler: args.handler as number });
            return id;
          }
          if (command === "plugin:event|unlisten") { listeners.delete(args.eventId as number); return; }
          if (["set_palette_shortcut", "palette_update_snapshot", "palette_show", "palette_hide", "pet_notify"].includes(command)) return;
          if (command === "agent_todo_state") return { items: [], history: [], enabledAt: null, paused: false, lastScanAt: null, sources: [], error: null };
          if (command === "pet_get_state") return { visible: true, badges: [], door: { url: "", listening: false } };
          if (command === "plugin:autostart|is_enabled") return false;
          if (command === "session_analyze_scan") return { sessions: [report.session], sources: [{ agent: "codex", path: "/synthetic", found: true }], warnings: [] };
          if (command === "session_analyze_run") return report;
          if (command === "session_analyze_prices") return { folder: "/synthetic/pricing", files: [] };
          if (command === "session_analyze_coverage") {
            const includeDependencies = Boolean(args.includeDependencies);
            const respectGitignore = Boolean(args.respectGitignore);
            const key = `synthetic-project-map-snapshot:${String(args.project)}:${includeDependencies}:${respectGitignore}`;
            const saved = localStorage.getItem(key);
            const previous = saved ? JSON.parse(saved) as { entries: ProjectCoverage["entries"]; scannedAt: number; ignoredEntries: number } : null;
            const cached = previous !== null && !args.rescan;
            let snapshot = previous;
            if (!cached) {
              let entries = baseEntries.map((entry) => ({ ...entry }));
              if (includeDependencies) {
                for (const entry of entries) if (entry.path === "node_modules" || entry.path === "dist") entry.excluded = false;
                entries.push(file("node_modules/synthetic-package/index.js"), file("dist/app.js"));
              }
              if (args.rescan) entries.push(file("src/new-after-rescan.ts"));
              const beforeIgnore = entries.length;
              if (respectGitignore) entries = entries.filter((entry) => !bridge.ignoredPaths.includes(entry.path));
              snapshot = { entries, scannedAt: previous ? previous.scannedAt + 60_000 : snapshotTime, ignoredEntries: beforeIgnore - entries.length };
              localStorage.setItem(key, JSON.stringify(snapshot));
            }
            const paths = snapshot!.entries.filter((entry) => entry.kind === "file" && !entry.excluded).map((entry) => entry.path);
            const operations = args.files as FileActivity[];
            const readFiles = [...new Set(operations.filter((entry) => entry.operation === "read" && paths.includes(entry.path)).map((entry) => entry.path))];
            const writtenFiles = [...new Set(operations.filter((entry) => entry.operation === "write" && paths.includes(entry.path)).map((entry) => entry.path))];
            const unmatchedFiles = suppliedUnmatched ?? operations.filter((entry) => (entry.operation === "read" || entry.operation === "write") && !paths.includes(entry.path))
              .map((entry) => ({ ...entry, reason: "not-in-snapshot" as const }));
            return { project: args.project, totalFiles: paths.length, readFiles, writtenFiles,
              untouchedFiles: paths.filter((path) => !readFiles.includes(path) && !writtenFiles.includes(path)),
              outsideProject: [], unmatchedFiles, basis: "Synthetic filename inventory; file contents are never opened.", warnings: [],
              entries: snapshot!.entries, scannedAt: snapshot!.scannedAt, ignoredEntries: snapshot!.ignoredEntries,
              cached, includeDependencies, respectGitignore, complete: true };
          }
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
  }, { report, snapshotTime, suppliedUnmatched, componentCount });
}

const map = (page: Page) => page.getByRole("region", { name: "Project structure and coverage" });
const workspace = (page: Page, name: string) => page.getByRole("tablist", { name: "Session analyze views" }).getByRole("tab", { name: new RegExp(`^${name}(?:\\s|$)`) });
const filesTab = (page: Page) => page.getByRole("tablist", { name: "Report sections" }).getByRole("tab", { name: /^Files(?:\s|$)/ });
const tree = (page: Page) => map(page).getByRole("list", { name: "Project directory tree" });
const search = (page: Page) => map(page).getByRole("searchbox", { name: /Search all .* paths/ });
const coverageCalls = (page: Page) => page.evaluate(() => (window as TestWindow).__projectMapTest.calls.filter((call) => call.command === "session_analyze_coverage"));

async function openTool(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Session analyze", exact: true }).click();
  await expect(page.getByRole("button", { name: `Analyze: ${syntheticReport().session.title}`, exact: true })).toBeVisible();
}

async function analyzeAndScan(page: Page) {
  await page.getByRole("button", { name: `Analyze: ${syntheticReport().session.title}`, exact: true }).click();
  await filesTab(page).click();
  await map(page).getByRole("button", { name: "Scan project structure", exact: true }).click();
  await expect(map(page).locator(".pm-snapshot time")).toBeVisible();
}

test("keeps panels separate and scrolls through all folder, expanded-tree, and global search results", async ({ page }, testInfo) => {
  await installNativeBridge(page, syntheticReport(), undefined, 75);
  await openTool(page);
  await expect(page.locator("#sa-workspace-panel-sessions")).toBeVisible();
  await expect(page.locator("#sa-workspace-panel-analysis")).toBeHidden();
  expect(await coverageCalls(page)).toEqual([]);
  await analyzeAndScan(page);
  await expect(page.locator("#sa-workspace-panel-sessions")).toBeHidden();
  await expect(page.locator("#sa-workspace-panel-analysis")).toBeVisible();
  const calls = await coverageCalls(page);
  expect(calls).toHaveLength(1);
  expect(calls[0].args).toEqual({ project, files: syntheticReport().files.slice(0, 4), rescan: false, includeDependencies: false, respectGitignore: false });
  await expect(map(page).locator(".pm-snapshot-badge")).toHaveText("Fresh scan");
  await expect(map(page).getByLabel("File activity legend")).toContainText("Untouched");
  await tree(page).getByRole("button", { name: "Expand src", exact: true }).click();
  const untouched = tree(page).getByRole("listitem").filter({ has: page.getByRole("button", { name: "untouched.ts", exact: true }) });
  await expect(untouched).toContainText("Untouched");
  await tree(page).getByRole("button", { name: "Expand src/components", exact: true }).click();
  const finalExpandedFile = tree(page).getByRole("button", { name: "component-75.tsx", exact: true });
  await finalExpandedFile.scrollIntoViewIfNeeded();
  await expect(finalExpandedFile).toBeVisible();
  expect(await tree(page).evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await tree(page).getByRole("button", { name: "Collapse src/components", exact: true }).click();
  await tree(page).getByRole("button", { name: "Expand docs", exact: true }).click();
  await expect(tree(page).getByRole("button", { name: "empty", exact: true })).toBeVisible();
  await expect(tree(page).getByRole("button", { name: "empty-root", exact: true })).toBeVisible();
  await map(page).getByLabel("Inside src", { exact: true }).getByRole("button", { name: /^lib/ }).click();
  await expect(map(page).locator(".pm-folder-summary code")).toHaveText("src/lib");
  await expect(map(page).getByRole("navigation", { name: "Project map location" }).getByRole("button")).toHaveText(["project-map-demo", "src", "lib"]);
  await expect(tree(page).getByRole("listitem").filter({ hasText: "utils.ts" })).toContainText("Read only");
  await expect(tree(page).getByRole("listitem").filter({ hasText: "new.ts" })).toContainText("Write only");
  await search(page).fill("docs/guide");
  await map(page).getByRole("list", { name: "Project path search results" }).getByRole("button", { name: "docs/guide.md", exact: true }).click();
  await expect(map(page).locator(".pm-folder-summary code")).toHaveText("docs");
  await expect(map(page).locator(".pm-selection")).toContainText("docs/guide.md");
  await expect(map(page).locator(".pm-selection")).toContainText("Untouched");
  await tree(page).getByRole("button", { name: "empty", exact: true }).click();
  await expect(map(page).getByText("This folder has no inventoried entries.", { exact: true })).toBeVisible();
  await map(page).getByRole("navigation", { name: "Project map location" }).getByRole("button", { name: "project-map-demo", exact: true }).click();
  await search(page).fill("component-");
  const allMatches = map(page).getByRole("list", { name: "Project path search results" });
  await expect(allMatches.getByRole("listitem")).toHaveCount(75);
  await expect(map(page).locator(".pm-result-count")).toHaveText("75 matching paths across the project");
  const finalMatch = allMatches.getByRole("button", { name: "src/components/component-75.tsx", exact: true });
  await finalMatch.scrollIntoViewIfNeeded();
  await finalMatch.click();
  await expect(map(page).locator(".pm-folder-summary code")).toHaveText("src/components");
  await expect(tree(page).getByRole("listitem")).toHaveCount(75);
  await expect(map(page).locator(".pm-map-cell")).toHaveCount(75);
  await expect(map(page).locator(".pm-map-heading")).toContainText("Equal-size tiles");
  const finalTile = map(page).locator(".pm-tile-heading").filter({ hasText: "component-75.tsx" });
  await finalTile.scrollIntoViewIfNeeded();
  await expect(finalTile).toBeVisible();
  expect(await map(page).locator(".pm-mosaic").evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await finalTile.focus();
  await finalTile.press("Enter");
  await expect(map(page).locator(".pm-selection")).toContainText("src/components/component-75.tsx");
  await expect(map(page).getByRole("button", { name: /^(Next|Previous|Explore all)/ })).toHaveCount(0);
  await map(page).getByRole("navigation", { name: "Project map location" }).getByRole("button", { name: "project-map-demo", exact: true }).click();
  await page.locator(".sa-map-pane").evaluate((element) => { element.scrollTop = 0; });
  await page.locator(".sa-files-layout").screenshot({ path: testInfo.outputPath("project-map-navigation.png") });
});

test("reuses snapshot timestamps across analysis and reload, rescans explicitly, and includes dependencies on request", async ({ page }) => {
  await installNativeBridge(page);
  await openTool(page);
  await analyzeAndScan(page);
  const originalTime = await map(page).locator(".pm-snapshot time").getAttribute("datetime");
  expect(originalTime).toBe(new Date(snapshotTime).toISOString());
  await workspace(page, "Sessions").click();
  await analyzeAndScan(page);
  await expect(map(page).locator(".pm-snapshot-badge")).toHaveText("Cached snapshot");
  await expect(map(page).locator(".pm-snapshot time")).toHaveAttribute("datetime", originalTime!);
  await page.reload();
  await page.getByRole("button", { name: "Session analyze", exact: true }).click();
  await analyzeAndScan(page);
  await expect(map(page).locator(".pm-snapshot-badge")).toHaveText("Cached snapshot");
  await expect(map(page).locator(".pm-snapshot time")).toHaveAttribute("datetime", originalTime!);
  await search(page).fill("new-after-rescan");
  await expect(map(page).getByText("No paths match this search.", { exact: true })).toBeVisible();
  await map(page).getByRole("button", { name: "Rescan project", exact: true }).click();
  await expect(map(page).locator(".pm-snapshot-badge")).toHaveText("Fresh scan");
  await expect(map(page).locator(".pm-snapshot time")).not.toHaveAttribute("datetime", originalTime!);
  await expect(map(page).getByRole("list", { name: "Project path search results" })).toContainText("src/new-after-rescan.ts");
  expect((await coverageCalls(page)).at(-1)?.args).toMatchObject({ rescan: true, includeDependencies: false });
  await search(page).fill("");
  await expect(tree(page).getByRole("listitem").filter({ has: page.getByRole("button", { name: "node_modules", exact: true }) })).toContainText("Excluded");
  await map(page).getByLabel("Include dependency and build folders").check();
  await expect(map(page).getByLabel("Include dependency and build folders")).toBeChecked();
  await expect(tree(page).getByRole("button", { name: "Expand node_modules", exact: true })).toBeVisible();
  expect((await coverageCalls(page)).at(-1)?.args).toMatchObject({ rescan: false, includeDependencies: true });
  await tree(page).getByRole("button", { name: "Expand node_modules", exact: true }).click();
  await tree(page).getByRole("button", { name: "Expand node_modules/synthetic-package", exact: true }).click();
  await expect(tree(page).getByRole("button", { name: "index.js", exact: true })).toBeVisible();
  await expect(tree(page).getByRole("listitem").filter({ has: page.getByRole("button", { name: ".git", exact: true }) })).toContainText("Excluded");
  await map(page).getByLabel("Include dependency and build folders").uncheck();
  await expect(map(page).locator(".pm-snapshot-badge")).toHaveText("Cached snapshot");
  expect((await coverageCalls(page)).at(-1)?.args).toMatchObject({ rescan: false, includeDependencies: false });
});

test("filters structure activity without changing recorded operations or losing folder ancestry", async ({ page }) => {
  await installNativeBridge(page);
  await openTool(page);
  await analyzeAndScan(page);
  const operations = page.getByRole("table", { name: "File operations", exact: true });
  const originalOperations = await operations.getByRole("row").allTextContents();
  const activity = map(page).getByLabel("Structure activity", { exact: true });
  await activity.selectOption("touched");
  await expect(map(page).locator(".pm-filter-summary")).toContainText("3 of 36 files");
  await expect(tree(page).getByRole("button", { name: "src", exact: true })).toBeVisible();
  await expect(tree(page).getByRole("button", { name: "docs", exact: true })).toHaveCount(0);
  await expect(map(page).getByLabel("Inside src", { exact: true }).getByRole("button", { name: /^lib/ })).toBeVisible();
  await map(page).getByLabel("Inside src", { exact: true }).getByRole("button", { name: /^lib/ }).click();
  await activity.selectOption("read");
  await expect(map(page).locator(".pm-filter-summary")).toContainText("2 of 36 files");
  await expect(map(page).locator(".pm-folder-summary code")).toHaveText("src/lib");
  await expect(tree(page).getByRole("button", { name: "utils.ts", exact: true })).toBeVisible();
  await expect(tree(page).getByRole("button", { name: "new.ts", exact: true })).toHaveCount(0);
  await activity.selectOption("written");
  await expect(tree(page).getByRole("button", { name: "new.ts", exact: true })).toBeVisible();
  await expect(tree(page).getByRole("button", { name: "utils.ts", exact: true })).toHaveCount(0);
  await search(page).fill("main");
  await expect(map(page).getByRole("list", { name: "Project path search results" })).toContainText("src/main.ts");
  await search(page).fill("");
  await activity.selectOption("untouched");
  await expect(map(page).locator(".pm-folder-summary code")).toHaveText("/");
  await search(page).fill("main.ts");
  await expect(map(page).getByText("No paths match this search.", { exact: true })).toBeVisible();
  await search(page).fill("");
  await activity.selectOption("excluded");
  await expect(map(page).locator(".pm-filter-summary")).toContainText("3 excluded entries");
  await expect(tree(page).getByRole("listitem")).toHaveCount(3);
  expect(await operations.getByRole("row").allTextContents()).toEqual(originalOperations);
  await page.getByLabel("File operation", { exact: true }).selectOption("write");
  await expect(operations.getByRole("row")).toHaveCount(3);
  await expect(activity).toHaveValue("excluded");
  await map(page).getByRole("button", { name: "Clear structure filter", exact: true }).click();
  await expect(activity).toHaveValue("all");
  await expect(map(page).locator(".pm-filter-summary")).toHaveCount(0);
  await expect(tree(page).getByRole("button", { name: "docs", exact: true })).toBeVisible();
  await expect(operations.getByRole("row")).toHaveCount(3);
  expect(await coverageCalls(page)).toHaveLength(1);
});

test("selects a gitignore snapshot before initial scan and retains recorded operations across rule refreshes", async ({ page }) => {
  await installNativeBridge(page);
  await openTool(page);
  await page.getByRole("button", { name: `Analyze: ${syntheticReport().session.title}`, exact: true }).click();
  await filesTab(page).click();
  const respect = map(page).getByLabel("Respect .gitignore", { exact: true });
  await expect(respect).not.toBeChecked();
  await respect.check();
  await expect(map(page).locator(".pm-snapshot")).toContainText("2 entries skipped by .gitignore");
  expect((await coverageCalls(page)).at(-1)?.args).toMatchObject({ rescan: false, includeDependencies: false, respectGitignore: true });
  const operations = page.getByRole("table", { name: "File operations", exact: true });
  const recordedRows = await operations.getByRole("row").allTextContents();
  expect(recordedRows.some((row) => row.includes("src/main.ts"))).toBe(true);
  await search(page).fill("src/main.ts");
  await expect(map(page).getByText("No paths match this search.", { exact: true })).toBeVisible();
  await respect.uncheck();
  await expect(map(page).getByRole("list", { name: "Project path search results" })).toContainText("src/main.ts");
  expect((await coverageCalls(page)).at(-1)?.args).toMatchObject({ rescan: false, includeDependencies: false, respectGitignore: false });
  await respect.check();
  await expect(map(page).locator(".pm-snapshot-badge")).toHaveText("Cached snapshot");
  const cachedTime = await map(page).locator(".pm-snapshot time").getAttribute("datetime");
  await page.evaluate(() => (window as TestWindow).__projectMapTest.ignoredPaths.push("src/lib/utils.ts"));
  await respect.uncheck();
  await respect.check();
  await search(page).fill("src/lib/utils.ts");
  await expect(map(page).getByRole("list", { name: "Project path search results" })).toContainText("src/lib/utils.ts");
  await expect(map(page).locator(".pm-snapshot time")).toHaveAttribute("datetime", cachedTime!);
  await map(page).getByRole("button", { name: "Rescan project", exact: true }).click();
  await expect(map(page).locator(".pm-snapshot")).toContainText("3 entries skipped by .gitignore");
  await expect(map(page).getByText("No paths match this search.", { exact: true })).toBeVisible();
  expect((await coverageCalls(page)).at(-1)?.args).toMatchObject({ rescan: true, includeDependencies: false, respectGitignore: true });
  expect(await operations.getByRole("row").allTextContents()).toEqual(recordedRows);
  await map(page).getByLabel("Include dependency and build folders").check();
  expect((await coverageCalls(page)).at(-1)?.args).toMatchObject({ rescan: false, includeDependencies: true, respectGitignore: true });
  await expect(respect).toBeChecked();
});

test("explains unmatched inferred reads without counting them and scrolls all diagnostics independently of recorded operations", async ({ page }, testInfo) => {
  const report = syntheticReport();
  const unmatched: ProjectCoverage["unmatchedFiles"] = [
    { path: "Assets/Editor/FileSelection.cs", operation: "read", eventId: "event-0", evidence: "inferred", reason: "not-in-snapshot" },
    { path: "$PROJECT/Unknown.cs", operation: "read", eventId: "event-2", evidence: "inferred", reason: "unresolved" },
    { path: "D:/Other/Generated.cs", operation: "write", eventId: "event-1", evidence: "explicit", reason: "outside-project" },
    ...Array.from({ length: 50 }, (_, index) => ({ path: `Assets/Other/missing-${index + 1}.cs`, operation: "read" as const,
      eventId: "event-2", evidence: "inferred" as const, reason: "not-in-snapshot" as const })),
  ];
  report.files = unmatched.map(({ reason: _reason, ...file }) => file);
  report.events[0].status = "observed";
  report.events[2].status = "unknown";
  await installNativeBridge(page, report, unmatched);
  await openTool(page);
  await analyzeAndScan(page);
  const operations = page.getByRole("table", { name: "File operations", exact: true });
  const recordedRows = await operations.getByRole("row").allTextContents();
  const diagnostic = map(page).locator(".pm-unmatched");
  await expect(diagnostic.locator("summary")).toHaveText("Recorded paths not mapped (53)");
  await map(page).getByLabel("Structure activity", { exact: true }).selectOption("read");
  await expect(map(page).locator(".pm-filter-summary")).toContainText("0 of 36 files");
  await expect(map(page).locator(".pm-unmatched-explanation")).toContainText("No recorded read paths matched included files in this snapshot. 52 recorded read paths are not mapped.");
  await expect(map(page).locator(".pm-folder-summary")).toContainText("0 files · 0 read");
  await expect(diagnostic.locator("summary")).toHaveText("Recorded paths not mapped (52)");
  await diagnostic.locator("summary").click();
  const unmappedList = diagnostic.getByRole("list", { name: "Unmapped recorded file operations" });
  await expect(unmappedList.getByRole("listitem")).toHaveCount(52);
  const originalRead = unmappedList.getByRole("listitem").filter({ hasText: "Assets/Editor/FileSelection.cs" });
  await expect(originalRead).toContainText("inferred");
  await expect(originalRead).toContainText("Not in snapshot");
  await expect(unmappedList.getByRole("listitem").filter({ hasText: "$PROJECT/Unknown.cs" })).toContainText("Unresolved path");
  await expect(unmappedList).not.toContainText("Generated.cs");
  const finalUnmapped = unmappedList.getByRole("listitem").filter({ hasText: "Assets/Other/missing-50.cs" });
  await finalUnmapped.scrollIntoViewIfNeeded();
  await expect(finalUnmapped).toBeVisible();
  expect(await unmappedList.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await expect(diagnostic.getByRole("navigation")).toHaveCount(0);
  await map(page).getByLabel("Structure activity", { exact: true }).selectOption("written");
  await expect(diagnostic.locator("summary")).toHaveText("Recorded paths not mapped (1)");
  await expect(unmappedList.getByRole("listitem")).toHaveCount(1);
  await expect(unmappedList).toContainText("Outside project");
  expect(await operations.getByRole("row").allTextContents()).toEqual(recordedRows);
  await expect(operations.getByRole("row").filter({ hasText: "Assets/Editor/FileSelection.cs" })).toContainText("inferred");
  await map(page).getByLabel("Structure activity", { exact: true }).selectOption("read");
  await expect(unmappedList.getByRole("listitem")).toHaveCount(52);
  expect(await coverageCalls(page)).toHaveLength(1);
  await page.locator(".sa-map-pane").evaluate((element) => { element.scrollTop = 0; });
  await page.locator(".sa-files-layout").screenshot({ path: testInfo.outputPath("unmapped-read-diagnostics.png") });
});

test("keeps the populated map within light and dark layouts at 175 percent text size", async ({ page }, testInfo) => {
  await installNativeBridge(page);
  await openTool(page);
  await analyzeAndScan(page);
  for (const theme of ["light", "dark"] as const) {
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByLabel("Color theme", { exact: true }).selectOption(theme);
    await page.getByLabel("Font size", { exact: true }).selectOption("175");
    await page.getByRole("button", { name: "Session analyze", exact: true }).click();
    await filesTab(page).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(page.locator("html")).toHaveAttribute("data-ui-font-size", "175");
    for (const width of [1920, 1280, 780]) {
      await page.setViewportSize({ width, height: 960 });
      await expect(map(page).locator(".pm-mosaic")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      expect(await map(page).evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      const structurePane = page.locator(".sa-map-pane");
      const operationsPane = page.getByRole("region", { name: "Recorded file operations pane", exact: true });
      const structureBox = await structurePane.boundingBox();
      const operationsBox = await operationsPane.boundingBox();
      if (width > 860) expect(structureBox!.x + structureBox!.width).toBeLessThanOrEqual(operationsBox!.x);
      else expect(structureBox!.y + structureBox!.height).toBeLessThanOrEqual(operationsBox!.y);
      await structurePane.evaluate((element) => { element.scrollTop = 0; });
      const recordedScroll = await operationsPane.locator(".sa-table-scroll").evaluate((element) => element.scrollTop);
      await page.locator(".sa-files-layout").screenshot({ path: testInfo.outputPath(`files-layout-${theme}-175-${width}.png`) });
      await map(page).locator(".pm-mosaic").scrollIntoViewIfNeeded();
      expect(await operationsPane.locator(".sa-table-scroll").evaluate((element) => element.scrollTop)).toBe(recordedScroll);
      await page.locator(".sa-files-layout").screenshot({ path: testInfo.outputPath(`project-map-${theme}-175-${width}.png`) });
    }
  }
});
