import { expect, test, type Page } from "@playwright/test";

// The pet window runs against a stand-in for the Tauri bridge, so these tests
// exercise the same commands and events as the desktop app.

interface NativeCall {
  command: string;
  args: Record<string, unknown>;
}

interface BridgeState {
  calls: NativeCall[];
  emit: (event: string, payload?: unknown) => void;
  hooks: unknown;
}

type TestWindow = typeof window & { __petTest: BridgeState };

const PET_WINDOW = "/#tool-window/agent-pet/pets";
const PET_WINDOW_COMMANDS = ["plugin:event|listen", "plugin:event|unlisten", "pet_get_state", "pet_run_action", "agent_pet_set_window"];

const report = (claude: string) => ({
  executable: "C:/Apps/Toolbox-Chan/little-toolbox.exe",
  development: false,
  agents: [
    {
      agent: "claude", method: "hooks", path: "C:\\Users\\Me\\.claude\\settings.json", state: claude,
      events: ["UserPromptSubmit", "Stop", "Notification"].map((name, index) => ({
        name, status: ["working", "done", "needs-you"][index], installed: claude !== "missing", current: claude !== "missing",
      })),
      ...(claude !== "missing" && { backup: "C:\\Users\\Me\\.claude\\settings.json.toolbox-chan-backup" }),
    },
    {
      agent: "codex", method: "hooks", path: "C:\\Users\\Me\\.codex\\config.toml", state: "installed",
      events: [{ name: "Stop", status: "done", installed: true, current: true, reviewed: false }],
    },
    { agent: "deepseek", method: "watcher", path: "C:\\Users\\Me\\.dsh\\sessions", state: "missing", events: [] },
  ],
});

async function installBridge(page: Page, badges: unknown[] = []) {
  await page.addInitScript(({ badges, initialHooks }) => {
    let nextCallback = 1;
    let nextEvent = 1;
    const callbacks = new Map<number, (event: unknown) => void>();
    const listeners = new Map<number, { event: string; handler: number }>();
    const bridge: BridgeState = {
      calls: [],
      hooks: initialHooks,
      emit(event, payload = null) {
        for (const [id, listener] of listeners)
          if (listener.event === event) callbacks.get(listener.handler)?.({ event, id, payload });
      },
    };
    Object.assign(window, {
      isTauri: true,
      __petTest: bridge,
      __TAURI_INTERNALS__: {
        transformCallback(callback: (event: unknown) => void) {
          const id = nextCallback++;
          callbacks.set(id, callback);
          return id;
        },
        unregisterCallback(id: number) {
          callbacks.delete(id);
        },
        async invoke(command: string, args: Record<string, unknown> = {}) {
          bridge.calls.push({ command, args });
          if (command === "plugin:event|listen") {
            const id = nextEvent++;
            listeners.set(id, { event: args.event as string, handler: args.handler as number });
            return id;
          }
          if (command === "plugin:event|unlisten") {
            listeners.delete(args.eventId as number);
            return;
          }
          if (command === "pet_get_state")
            return { visible: true, badges, door: { url: "http://127.0.0.1:47615/pet/events", listening: true } };
          if (command === "pet_notify") {
            bridge.emit("pet-event", args.event);
            return;
          }
          if (command === "agent_pet_hooks") return bridge.hooks;
          if (command === "agent_pet_install_hooks" || command === "agent_pet_remove_hooks") {
            const hooks = structuredClone(bridge.hooks) as { agents: { agent: string; state: string }[] };
            const entry = hooks.agents.find((agent) => agent.agent === args.agent);
            if (entry) entry.state = command === "agent_pet_install_hooks" ? "installed" : "missing";
            bridge.hooks = hooks;
            return hooks;
          }
          return null;
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
  }, { badges, initialHooks: report("missing") });
}

const emit = (page: Page, event: string, payload: unknown) =>
  page.evaluate(([event, payload]) => (window as TestWindow).__petTest.emit(event as string, payload), [event, payload] as const);

const petEvent = (page: Page, payload: Record<string, unknown>) => emit(page, "pet-event", { source: "hook", ...payload });

const calls = (page: Page, command?: string) =>
  page.evaluate((command) => (window as TestWindow).__petTest.calls.filter((call) => !command || call.command === command), command);

const pet = (page: Page, agent: string) => page.locator(`.agent-pet[data-agent="${agent}"]`);

async function center(page: Page, agent: string) {
  const box = await pet(page, agent).locator(".pet-hitbox").boundingBox();
  if (!box) throw new Error(`${agent} has no hit box`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function openPets(page: Page, badges: unknown[] = []) {
  await installBridge(page, badges);
  await page.goto(PET_WINDOW);
  await expect(page.locator(".agent-pet")).toHaveCount(3);
}

test.describe("pet window", () => {
  test("shows one pet per agent on the bottom edge, alone in its window", async ({ page }) => {
    await openPets(page);
    await expect(page.locator(".app-shell, .sidebar")).toHaveCount(0);
    const height = page.viewportSize()!.height;
    for (const agent of ["claude", "codex", "deepseek"]) {
      const box = await pet(page, agent).boundingBox();
      // Feet at y = 244 of 256: the box reaches just past the bottom edge.
      expect(Math.abs(box!.y + box!.height * (244 / 256) - height)).toBeLessThan(2);
    }
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
    // Only the commands granted to the pet window are used.
    const used = new Set((await calls(page)).map((call) => call.command));
    expect([...used].filter((command) => !PET_WINDOW_COMMANDS.includes(command))).toEqual([]);
  });

  test("events set working, done with a red dot, needs-you with a question, and a chat count", async ({ page }) => {
    await openPets(page);
    await petEvent(page, { agent: "claude", sessionId: "a", status: "working", note: "Repo · First chat" });
    await petEvent(page, { agent: "claude", sessionId: "b", status: "working" });
    await expect(pet(page, "claude")).toHaveAttribute("data-mood", "working");
    await expect(pet(page, "claude")).toHaveAttribute("data-pose", "working");
    await expect(pet(page, "claude").locator(".pet-count")).toHaveText("×2");
    await petEvent(page, { agent: "claude", sessionId: "a", status: "done" });
    await expect(pet(page, "claude")).toHaveAttribute("data-mood", "done");
    await expect(pet(page, "claude").locator(".pet-dot")).toBeVisible();
    await expect(pet(page, "claude").locator(".pet-count")).toHaveCount(0);

    await petEvent(page, { agent: "codex", sessionId: "c", status: "needs-you" });
    await expect(pet(page, "codex").locator(".pet-question")).toHaveText("?");
    await expect(pet(page, "codex")).toHaveAttribute("data-pose", "needsyou");
    await petEvent(page, { agent: "codex", sessionId: "c", status: "working" });
    await expect(pet(page, "codex").locator(".pet-question")).toHaveCount(0);
    await expect(pet(page, "deepseek")).toHaveAttribute("data-mood", "idle");
  });

  test("a done pet follows the cursor until it is clicked, then comes back down", async ({ page }) => {
    await openPets(page);
    await petEvent(page, { agent: "deepseek", sessionId: "d", status: "done" });
    await emit(page, "agent-pet-pointer", { x: 200, y: 260, fullscreen: false });
    await expect.poll(async () => {
      const point = await center(page, "deepseek");
      return Math.hypot(point.x - 200, point.y - 260);
    }, { timeout: 10_000 }).toBeLessThan(160);
    const target = await center(page, "deepseek");
    await page.mouse.move(target.x, target.y);
    await page.mouse.down();
    await page.mouse.up();
    await expect(pet(page, "deepseek").locator(".pet-dot")).toHaveCount(0);
    await expect(pet(page, "deepseek")).toHaveAttribute("data-mood", "idle");
    const height = page.viewportSize()!.height;
    await expect.poll(async () => {
      const box = await pet(page, "deepseek").boundingBox();
      return Math.round(box!.y + box!.height * (244 / 256));
    }, { timeout: 10_000 }).toBe(height);
  });

  test("clicks reach the window only over a pet", async ({ page }) => {
    await openPets(page);
    const lastWindowState = async () => (await calls(page, "agent_pet_set_window")).at(-1)?.args;
    await emit(page, "agent-pet-pointer", { x: 40, y: 40, fullscreen: false });
    await expect.poll(lastWindowState).toEqual({ shown: true, interactive: false });
    const over = await center(page, "codex");
    await emit(page, "agent-pet-pointer", { ...over, fullscreen: false });
    await expect.poll(lastWindowState).toEqual({ shown: true, interactive: true });
    // A full-screen app hides the pets; the window stays active so it hears when that app closes.
    await emit(page, "agent-pet-pointer", { x: 40, y: 40, fullscreen: true });
    await expect(page.locator(".agent-pet")).toHaveCount(0);
    await expect.poll(lastWindowState).toEqual({ shown: true, interactive: false });
    await emit(page, "agent-pet-pointer", { x: 40, y: 40, fullscreen: false });
    await expect(page.locator(".agent-pet")).toHaveCount(3);
    await emit(page, "pet-visibility", { visible: false });
    await expect.poll(lastWindowState).toEqual({ shown: false, interactive: false });
  });

  test("dragging holds the pet, and it lands where it was dropped", async ({ page }) => {
    await openPets(page);
    await petEvent(page, { agent: "claude", sessionId: "a", status: "working" });
    const start = await center(page, "claude");
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x - 150, start.y - 220, { steps: 8 });
    await expect(pet(page, "claude")).toHaveAttribute("data-pose", "held");
    const held = await center(page, "claude");
    expect(Math.abs(held.x - (start.x - 150))).toBeLessThan(3);
    await page.mouse.up();
    await expect(pet(page, "claude")).toHaveAttribute("data-pose", "working", { timeout: 10_000 });
    const landed = await center(page, "claude");
    expect(Math.abs(landed.x - held.x)).toBeLessThan(3);
    expect(landed.y).toBeGreaterThan(held.y + 150);
    // A drag is not a click: the pet's notices and mood are unchanged.
    await expect(pet(page, "claude")).toHaveAttribute("data-mood", "working");
  });

  test("a calm pet plays an emote when clicked, and emote events play too", async ({ page }) => {
    await openPets(page);
    const target = await center(page, "codex");
    await page.mouse.click(target.x, target.y);
    await expect(pet(page, "codex")).toHaveAttribute("data-pose", /^(happy|laugh|surprised|sleep)$/);
    await petEvent(page, { agent: "claude", emote: "surprised" });
    await expect(pet(page, "claude")).toHaveAttribute("data-pose", "surprised");
  });

  test("hovering shows the latest note", async ({ page }) => {
    await openPets(page);
    await petEvent(page, { agent: "claude", sessionId: "a", status: "working", note: "CustomOfflineTool · Add pet" });
    await petEvent(page, { agent: "claude", sessionId: "b", status: "working", note: "Other repo · Newest chat" });
    const target = await center(page, "claude");
    await page.mouse.move(target.x, target.y);
    await expect(page.getByRole("tooltip")).toHaveText("Other repo · Newest chat");
    await page.mouse.move(20, 20);
    await expect(page.getByRole("tooltip")).toHaveCount(0);
  });

  test("badges from any source show on the pet and run their own action", async ({ page }) => {
    const action = { type: "open-tool", toolId: "some-tool" };
    await openPets(page, [{ agent: "claude", source: "some-tool", badge: { count: 4, action } }]);
    const badge = pet(page, "claude").getByRole("button", { name: "4 from some-tool" });
    await expect(badge).toBeVisible();
    await badge.click();
    await expect.poll(() => calls(page, "pet_run_action")).toEqual([{ command: "pet_run_action", args: { action } }]);
    // A later event replaces only its own source's badge; null clears it.
    await petEvent(page, { source: "other", badge: { count: 120 } });
    await expect(pet(page, "codex").locator(".pet-badge")).toHaveText("99+");
    await petEvent(page, { source: "some-tool", agent: "claude", badge: null });
    await expect(pet(page, "claude").locator(".pet-badge")).toHaveText(["99+"]);
  });

  test("the tray switch and pet settings hide pets", async ({ page }) => {
    await openPets(page);
    await emit(page, "pet-visibility", { visible: false });
    await expect(page.locator(".agent-pet")).toHaveCount(0);
    await emit(page, "pet-visibility", { visible: true });
    await expect(page.locator(".agent-pet")).toHaveCount(3);
    await page.evaluate(() => {
      const key = "toolbox-chan.agent-pet.settings.v1";
      localStorage.setItem(key, JSON.stringify({ enabled: { claude: true, codex: false, deepseek: true }, size: "large" }));
      window.dispatchEvent(new StorageEvent("storage", { key }));
    });
    await expect(page.locator(".agent-pet")).toHaveCount(2);
    await expect(pet(page, "codex")).toHaveCount(0);
    expect((await pet(page, "claude").boundingBox())!.width).toBe(160);
  });
});

test.describe("pet settings page", () => {
  test("turns pets on and off, changes their size, and sends test events", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Agent pets", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Agent pets", exact: true })).toBeVisible();
    const codex = page.getByRole("switch", { name: "Codex-Chan" });
    await expect(codex).toBeChecked();
    await codex.uncheck();
    await page.getByLabel("Size").selectOption("small");
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("toolbox-chan.agent-pet.settings.v1")!))).toEqual({
      enabled: { claude: true, codex: false, deepseek: true }, size: "small",
    });
    await page.reload();
    await page.getByRole("button", { name: "Agent pets", exact: true }).click();
    await expect(page.getByRole("switch", { name: "Codex-Chan" })).not.toBeChecked();
    await expect(page.getByLabel("Size")).toHaveValue("small");
    // The browser preview has no event door or hooks.
    await expect(page.getByText("Outside programs can reach the pets in the desktop app only.")).toBeVisible();
    await expect(page.getByText("Hooks can be installed from the Toolbox-Chan desktop app.")).toBeVisible();
    await expect(page.getByText("ZipZipPipe (sheet watermark @amemily2050)", { exact: false })).toBeVisible();
    await expect(page.getByText("non-commercial", { exact: false })).toBeVisible();
  });

  test("shows hook status and installs or removes hooks through native commands", async ({ page }) => {
    await installBridge(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Agent pets", exact: true }).click();
    const claude = page.locator('.setting-row[data-agent="claude"]');
    await expect(claude).toContainText("Not installed");
    await expect(claude).toContainText("C:\\Users\\Me\\.claude\\settings.json");
    await expect(page.locator('.setting-row[data-agent="codex"]')).toContainText("waiting for review in Codex");
    await expect(page.getByText("Listening")).toBeVisible();
    await claude.getByRole("button", { name: "Install" }).click();
    await expect(claude).toContainText("Installed");
    await expect(claude.getByRole("button", { name: "Remove" })).toBeVisible();
    await page.locator('.setting-row[data-agent="deepseek"]').getByRole("button", { name: "Turn on" }).click();
    await expect(page.locator('.setting-row[data-agent="deepseek"]')).toContainText("Watching sessions");
    expect((await calls(page, "agent_pet_install_hooks")).map((call) => call.args)).toEqual([{ agent: "claude" }, { agent: "deepseek" }]);

    await page.getByRole("button", { name: "Done", exact: true }).click();
    await expect.poll(async () => (await calls(page, "pet_notify")).at(-1)?.args).toEqual({
      event: { source: "agent-pet", sessionId: "pet-settings-test", note: "Test from pet settings", status: "done" },
    });
  });
});
