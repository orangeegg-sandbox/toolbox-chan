import { expect, test, type Page } from "@playwright/test";
import type { PaletteSnapshot } from "../commands/types";

interface NativeCall {
  command: string;
  args: Record<string, unknown>;
}

interface FloatingBridgeState {
  calls: NativeCall[];
  failSnapshot: boolean;
  emit: (event: string, payload?: unknown) => void;
  releaseSnapshot: () => void;
  releaseExecutor: () => void;
}

type TestWindow = typeof window & {
  __floatingPaletteTest: FloatingBridgeState;
};

const snapshot: PaletteSnapshot = {
  shortcutLabel: "Ctrl + Shift × 2",
  commands: [
    {
      id: "tool:ocr",
      name: "Image to text",
      description: "Extract text from an image",
      keywords: ["ocr"],
      kind: "tool",
    },
    {
      id: "ocr.extract",
      name: "OCR: Extract text",
      description: "Choose an image first",
      keywords: ["ocr"],
      kind: "action",
      disabled: true,
    },
    { id: "settings", name: "Settings", kind: "navigation" },
  ],
};

test.use({
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36",
});
test.setTimeout(45_000);

async function installBridge(
  page: Page,
  options: {
    delaySnapshot?: boolean;
    failSnapshot?: boolean;
    delayExecutor?: boolean;
  } = {},
) {
  await page.addInitScript(
    ({ snapshot, options }) => {
      let nextCallbackId = 1;
      let nextEventId = 1;
      const callbacks = new Map<number, (event: unknown) => void>();
      const listeners = new Map<number, { event: string; handler: number }>();
      const snapshotResolvers: (() => void)[] = [];
      const executorResolvers: (() => void)[] = [];
      const bridge: FloatingBridgeState = {
        calls: [],
        failSnapshot: options.failSnapshot ?? false,
        emit(event, payload = null) {
          for (const [id, listener] of listeners) {
            if (listener.event === event) {
              callbacks.get(listener.handler)?.({ event, id, payload });
            }
          }
        },
        releaseSnapshot() {
          snapshotResolvers.splice(0).forEach((resolve) => resolve());
        },
        releaseExecutor() {
          executorResolvers.splice(0).forEach((resolve) => resolve());
        },
      };
      // Use the installed Tauri core/event bridge instead of replacing app APIs.
      Object.assign(window, {
        isTauri: true,
        __floatingPaletteTest: bridge,
        __TAURI_INTERNALS__: {
          transformCallback(callback: (event: unknown) => void, once = false) {
            const id = nextCallbackId++;
            callbacks.set(id, (event) => {
              if (once) callbacks.delete(id);
              callback(event);
            });
            return id;
          },
          unregisterCallback(id: number) {
            callbacks.delete(id);
          },
          async invoke(command: string, args: Record<string, unknown> = {}) {
            bridge.calls.push({ command, args });
            if (command === "plugin:event|listen") {
              if (options.delayExecutor && args.event === "palette-execute") {
                await new Promise<void>((resolve) => executorResolvers.push(resolve));
              }
              const id = nextEventId++;
              listeners.set(id, {
                event: args.event as string,
                handler: args.handler as number,
              });
              return id;
            }
            if (command === "plugin:event|unlisten") {
              listeners.delete(args.eventId as number);
              return;
            }
            if (command === "palette_get_snapshot") {
              if (options.delaySnapshot) {
                await new Promise<void>((resolve) => snapshotResolvers.push(resolve));
              }
              if (bridge.failSnapshot) throw new Error("Snapshot temporarily unavailable");
              return snapshot;
            }
            if (["palette_execute", "palette_hide", "palette_update_snapshot", "palette_show", "set_palette_shortcut"].includes(command)) return;
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
    },
    { snapshot, options },
  );
}

function palette(page: Page) {
  return page.getByRole("dialog", { name: "Command palette" });
}

function search(page: Page) {
  return palette(page).getByRole("combobox", { name: "Find a tool", exact: true });
}

async function nativeCalls(page: Page, command: string) {
  return page.evaluate(
    (command) => (window as TestWindow).__floatingPaletteTest.calls.filter((call) => call.command === command),
    command,
  );
}

test("the standalone palette searches OCR and forwards execution without mounting the toolbox", async ({ page }) => {
  await installBridge(page);
  const toolModules: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/src/tools/")) toolModules.push(request.url());
  });
  await page.goto("/#command-palette");
  await expect(palette(page)).toBeVisible();
  await expect(search(page)).toBeFocused();
  await expect(page.locator(".sidebar, .app-shell, .ocr-workspace")).toHaveCount(0);
  await search(page).fill("ocr");
  await expect(page.getByRole("option", { name: "Image to text", exact: true })).toBeVisible();
  await search(page).press("Enter");
  await expect.poll(() => nativeCalls(page, "palette_execute")).toEqual([
    { command: "palette_execute", args: { id: "tool:ocr" } },
  ]);
  expect(await nativeCalls(page, "set_palette_shortcut")).toEqual([]);
  expect(await nativeCalls(page, "palette_update_snapshot")).toEqual([]);
  expect(await page.evaluate(() =>
    (window as TestWindow).__floatingPaletteTest.calls.some((call) => /window.*(show|unminimize|set_focus)/.test(call.command)),
  )).toBe(false);
  // The popup only renders core UI, so no tool module should be fetched.
  expect(toolModules).toEqual([]);
});

test("Escape dismisses only the floating palette through its native hide command", async ({ page }) => {
  await installBridge(page);
  await page.goto("/#command-palette");
  await expect(search(page)).toBeFocused();
  await search(page).press("Escape");
  await expect.poll(() => nativeCalls(page, "palette_hide")).toHaveLength(1);
  expect(await nativeCalls(page, "palette_execute")).toEqual([]);
});

test("disabled actions stay unavailable until the main window publishes updated state", async ({ page }) => {
  await installBridge(page);
  await page.goto("/#command-palette");
  await search(page).fill("> ocr.extract");
  const action = page.getByRole("option", { name: "OCR: Extract text", exact: true });
  await expect(action).toHaveAttribute("aria-disabled", "true");
  await search(page).press("Enter");
  expect(await nativeCalls(page, "palette_execute")).toEqual([]);

  const updatedSnapshot: PaletteSnapshot = {
    ...snapshot,
    commands: snapshot.commands.map((command) => ({ ...command, disabled: false })),
  };
  await page.evaluate((updated) => (window as TestWindow).__floatingPaletteTest.emit("palette-snapshot", updated), updatedSnapshot);
  await expect(action).not.toHaveAttribute("aria-disabled", "true");
  await search(page).press("Enter");
  await expect.poll(() => nativeCalls(page, "palette_execute")).toEqual([
    { command: "palette_execute", args: { id: "ocr.extract" } },
  ]);
});

test("reopening the floating palette clears its previous query and restores input focus", async ({ page }) => {
  await installBridge(page);
  await page.goto("/#command-palette");
  await search(page).fill("settings");
  await search(page).press("Escape");
  await page.evaluate(() => (window as TestWindow).__floatingPaletteTest.emit("palette-opened"));
  await expect(search(page)).toHaveValue("");
  await expect(search(page)).toBeFocused();
  await expect(page.getByRole("option").first()).toHaveAttribute("aria-selected", "true");
});

test("a live snapshot takes precedence over an older delayed initial response", async ({ page }) => {
  await installBridge(page, { delaySnapshot: true });
  await page.goto("/#command-palette");
  await expect.poll(async () => (await nativeCalls(page, "palette_get_snapshot")).length).toBeGreaterThan(0);
  const updatedSnapshot: PaletteSnapshot = {
    ...snapshot,
    commands: [{ id: "tool:fresh", name: "Fresh tool", kind: "tool" }],
  };
  await page.evaluate((updated) => {
    const bridge = (window as TestWindow).__floatingPaletteTest;
    bridge.emit("palette-snapshot", updated);
    bridge.releaseSnapshot();
  }, updatedSnapshot);
  await expect(page.getByRole("option", { name: "Fresh tool", exact: true })).toBeVisible();
  await expect(page.getByRole("option", { name: "Image to text", exact: true })).toHaveCount(0);
});

test("a failed snapshot request shows a retry that reconnects the floating palette", async ({ page }) => {
  await installBridge(page, { failSnapshot: true });
  await page.goto("/#command-palette");
  await expect(palette(page).getByRole("alert")).toBeVisible();
  await page.evaluate(() => { (window as TestWindow).__floatingPaletteTest.failSnapshot = false; });
  await palette(page).getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("option", { name: "Image to text", exact: true })).toBeVisible();
  await expect(palette(page).getByRole("alert")).toHaveCount(0);
});

test("the main window publishes serializable commands only after its execution listener is ready", async ({ page }) => {
  await installBridge(page, { delayExecutor: true });
  await page.goto("/src/core/tests/fixtures/index.html");
  await expect(page.getByLabel("Counter value")).toHaveText("0");
  await expect.poll(async () => (await nativeCalls(page, "plugin:event|listen")).some((call) => call.args.event === "palette-execute")).toBe(true);
  expect(await nativeCalls(page, "palette_update_snapshot")).toEqual([]);
  await page.evaluate(() => (window as TestWindow).__floatingPaletteTest.releaseExecutor());
  await expect.poll(async () => {
    const calls = await nativeCalls(page, "palette_update_snapshot");
    const latest = calls.at(-1)?.args.snapshot as PaletteSnapshot | undefined;
    return latest?.commands.some((command) => command.id === "counter.increment");
  }).toBe(true);
  const calls = await nativeCalls(page, "palette_update_snapshot");
  const published = calls.at(-1)!.args.snapshot as PaletteSnapshot;
  expect(published.shortcutLabel).toContain("Ctrl");
  expect(published.commands).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: "tool:counter", name: "Counter fixture", kind: "tool" }),
    expect.objectContaining({ id: "counter.increment", name: "Increment counter", kind: "action" }),
  ]));
  for (const command of published.commands) {
    expect(command).not.toHaveProperty("run");
    expect(command).not.toHaveProperty("icon");
  }
});

test("floating execution uses the main window's retained provider and current settings", async ({ page }) => {
  await installBridge(page);
  await page.goto("/src/core/tests/fixtures/index.html");
  await expect.poll(async () => (await nativeCalls(page, "palette_update_snapshot")).length).toBeGreaterThan(0);
  await page.getByLabel("Counter step").fill("3");
  await page.getByRole("button", { name: "Notes fixture", exact: true }).click();
  await page.getByLabel("Fixture note").fill("Retain this note");
  await page.evaluate(() => (window as TestWindow).__floatingPaletteTest.emit("palette-execute", { id: "counter.increment" }));
  await page.getByRole("button", { name: "Counter fixture", exact: true }).click();
  await expect(page.getByLabel("Counter value")).toHaveText("3");
  await page.evaluate(() => (window as TestWindow).__floatingPaletteTest.emit("palette-execute", { id: "counter.increment" }));
  await expect(page.getByLabel("Counter value")).toHaveText("6");
  await page.getByRole("button", { name: "Notes fixture", exact: true }).click();
  await expect(page.getByLabel("Fixture note")).toHaveValue("Retain this note");
});
