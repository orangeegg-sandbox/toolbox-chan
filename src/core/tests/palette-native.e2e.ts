import { expect, test, type Page } from "@playwright/test";

const fixtureUrl = "/src/core/tests/fixtures/index.html";
const storageKey = "toolbox-command-palette-shortcut";
const defaultShortcut = "Ctrl+Shift+DoubleTap";

interface NativeCall {
  command: string;
  shortcut?: string;
  event?: string;
}

interface NativeBridgeTestState {
  calls: NativeCall[];
  activeShortcut: string;
  releaseListen: () => void;
  emitPaletteRequest: () => void;
}

type TestWindow = typeof window & {
  __paletteNativeTest: NativeBridgeTestState;
};

test.use({
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36",
});
test.setTimeout(45_000);

async function installNativeBridge(
  page: Page,
  scenario: "listen-failure" | "delayed-listen" | "reserved-shortcut",
  savedShortcut?: string,
) {
  await page.addInitScript(
    ({ scenario, savedShortcut, storageKey }) => {
      if (savedShortcut) localStorage.setItem(storageKey, savedShortcut);
      let nextCallbackId = 1;
      let nextEventId = 1;
      const callbacks = new Map<number, (event: unknown) => void>();
      const listeners = new Map<number, { event: string; handler: number }>();
      const bridge: NativeBridgeTestState = {
        calls: [],
        activeShortcut: "",
        releaseListen: () => {},
        emitPaletteRequest: () => {
          for (const [id, listener] of listeners) {
            if (listener.event === "palette-requested") {
              callbacks.get(listener.handler)?.({
                event: listener.event,
                id,
                payload: null,
              });
            }
          }
        },
      };
      // Match the installed core.js/event.js bridge: event.listen transforms the
      // callback, invokes plugin:event|listen, and unregisters by event ID.
      Object.assign(window, {
        isTauri: true,
        __paletteNativeTest: bridge,
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
            bridge.calls.push({
              command,
              shortcut: args.shortcut as string | undefined,
              event: args.event as string | undefined,
            });
            if (command === "plugin:event|listen") {
              if (scenario === "listen-failure" && args.event === "palette-requested") {
                throw new Error("Native event listener unavailable");
              }
              if (scenario === "delayed-listen" && args.event === "palette-requested") {
                await new Promise<void>((resolve) => {
                  bridge.releaseListen = resolve;
                });
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
            if (command === "set_palette_shortcut") {
              if (
                scenario === "reserved-shortcut" &&
                args.shortcut === "Ctrl+Alt+P"
              ) {
                throw new Error("Shortcut is already registered by another app");
              }
              bridge.activeShortcut = args.shortcut as string;
              return;
            }
            if (command === "palette_update_snapshot" || command === "palette_show") return;
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
    { scenario, savedShortcut, storageKey },
  );
}

test("a native listener failure keeps the local shortcut and reports its actual scope", async ({
  page,
}) => {
  await installNativeBridge(page, "listen-failure");
  await page.goto(fixtureUrl);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("region", { name: "Command palette" });
  await expect(settings.getByRole("status")).toContainText(
    "Native event listener unavailable",
  );
  await expect(
    settings.getByText("Your shortcut works while the toolbox is focused."),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      (window as TestWindow).__paletteNativeTest.calls.filter(
        (call) => call.command === "set_palette_shortcut" && call.shortcut,
      ),
    ),
  ).toEqual([]);

  await page.keyboard.press("Control+Shift");
  await page.keyboard.press("Control+Shift");
  await expect(
    page.getByRole("dialog", { name: "Command palette" }),
  ).toBeVisible();
});

test("native input is enabled after the listener is ready and its event opens the palette", async ({
  page,
}) => {
  await installNativeBridge(page, "delayed-listen");
  await page.goto(fixtureUrl);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as TestWindow).__paletteNativeTest.calls.some(
          (call) => call.command === "plugin:event|listen",
        ),
      ),
    )
    .toBe(true);
  expect(
    await page.evaluate(
      () => (window as TestWindow).__paletteNativeTest.activeShortcut,
    ),
  ).toBe("");
  expect(
    await page.evaluate(() =>
      (window as TestWindow).__paletteNativeTest.calls.some(
        (call) => call.command === "set_palette_shortcut" && call.shortcut,
      ),
    ),
  ).toBe(false);

  await page.evaluate(() =>
    (window as TestWindow).__paletteNativeTest.releaseListen(),
  );
  await expect(
    page.getByText(
      "Opens a floating palette anywhere on Windows. The toolbox stays minimized until you choose a command.",
    ),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as TestWindow).__paletteNativeTest.activeShortcut,
    ),
  ).toBe(defaultShortcut);
  await page.evaluate(() =>
    (window as TestWindow).__paletteNativeTest.emitPaletteRequest(),
  );
  await expect(
    page.getByRole("dialog", { name: "Command palette" }),
  ).toBeVisible();
});

test("a rejected native shortcut preserves the saved binding and keeps the error after reactivation", async ({
  page,
}) => {
  const previousShortcut = "Ctrl+Alt+L";
  await installNativeBridge(page, "reserved-shortcut", previousShortcut);
  await page.goto(fixtureUrl);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("region", { name: "Command palette" });
  const nativeScope = settings.getByText(
    "Opens a floating palette anywhere on Windows. The toolbox stays minimized until you choose a command.",
  );
  await expect(nativeScope).toBeVisible();
  await settings
    .getByRole("button", { name: "Record shortcut", exact: true })
    .click();
  await page.keyboard.press("Control+Alt+p");
  await expect(
    settings.getByRole("button", { name: "Record shortcut", exact: true }),
  ).toBeVisible();
  await expect(nativeScope).toBeVisible();
  await expect(settings.getByRole("status")).toContainText(
    "Your previous shortcut is still selected.",
  );
  await expect(settings.getByRole("status")).toContainText(
    "Shortcut is already registered by another app",
  );
  await expect(settings.getByLabel("Current shortcut")).toHaveText(
    "Ctrl + Alt + L",
  );
  expect(
    await page.evaluate((key) => localStorage.getItem(key), storageKey),
  ).toBe(previousShortcut);
  expect(
    await page.evaluate(
      () => (window as TestWindow).__paletteNativeTest.activeShortcut,
    ),
  ).toBe(previousShortcut);
});
