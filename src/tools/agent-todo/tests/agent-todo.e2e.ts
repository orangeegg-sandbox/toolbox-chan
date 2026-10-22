import { expect, test, type Page } from "@playwright/test";

const KEY = "toolbox-chan.agent-todo.preview.v1";
const seed = {
  enabledAt: Date.UTC(2026, 9, 22, 7),
  paused: false,
  history: [],
  items: [
    { id: "a", agent: "claude", project: "D:\\Work\\demo-app", chatTitle: "Demo task list", text: "Run the browser tests", kind: "step", foundAt: Date.UTC(2026, 9, 22, 8), sessionId: "s1" },
    { id: "b", agent: "codex", project: "D:\\Work\\demo-api", chatTitle: "Rate limits", text: "Set RATE_LIMIT in production", kind: "for-you", foundAt: Date.UTC(2026, 9, 22, 9), sessionId: "s2" },
    { id: "c", agent: "deepseek", project: "D:\\Work\\demo-app", chatTitle: "Demo site checks", text: "Write a closing note", kind: "step", foundAt: Date.UTC(2026, 9, 22, 10), sessionId: "s3" },
  ],
};

async function openTool(page: Page) {
  await page.goto("/");
  await page.evaluate(([key, value]) => localStorage.setItem(key, value), [KEY, JSON.stringify(seed)] as const);
  await page.reload();
  await page.getByRole("button", { name: "Agent TODO", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Agent TODO", level: 1 })).toBeVisible();
}

const openList = (page: Page) => page.getByRole("list", { name: "Open items" });
const removedList = (page: Page) => page.getByRole("list", { name: "Removed items" });

test("lists items, filters them, and moves them through History", async ({ page }) => {
  await openTool(page);
  await expect(page.getByText("Reading agent chats needs the desktop app.")).toBeVisible();
  const items = openList(page).getByRole("listitem");
  await expect(items).toHaveCount(3);
  await expect(items.first()).toContainText("Write a closing note");
  await expect(items.first()).toContainText("DSH");
  await expect(items.nth(1)).toContainText("For you");
  await expect(items.first().getByText("demo-app", { exact: true })).toHaveAttribute("title", "D:\\Work\\demo-app");

  await page.getByLabel("Filter by agent").selectOption("codex");
  await expect(items).toHaveCount(1);
  await expect(items.first()).toContainText("Set RATE_LIMIT in production");
  await page.getByLabel("Filter by agent").selectOption("all");
  await page.getByLabel("Filter by project").selectOption({ label: "demo-app" });
  await expect(items).toHaveCount(2);
  await page.getByLabel("Filter by agent").selectOption("codex");
  await expect(page.getByText("Nothing matches these filters")).toBeVisible();
  await page.getByLabel("Filter by agent").selectOption("all");
  await page.getByLabel("Filter by project").selectOption("");

  await page.getByRole("button", { name: "Remove: Run the browser tests" }).click();
  await expect(items).toHaveCount(2);
  await page.getByRole("tab", { name: /History/ }).click();
  await expect(removedList(page).getByRole("listitem")).toHaveCount(1);
  await expect(removedList(page)).toContainText("Removed");
  await page.getByRole("button", { name: "Restore: Run the browser tests" }).click();
  await expect(page.getByText("History is empty")).toBeVisible();
  await page.getByRole("tab", { name: /Open/ }).click();
  await expect(items).toHaveCount(3);

  await page.getByRole("button", { name: "Remove: Set RATE_LIMIT in production" }).click();
  await page.getByRole("tab", { name: /History/ }).click();
  await page.getByRole("button", { name: "Clear history" }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText("Clear all 1 item from History?");
  await expect(confirm.getByRole("button", { name: "Cancel" })).toBeFocused();
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(removedList(page).getByRole("listitem")).toHaveCount(1);
  await page.getByRole("button", { name: "Clear history" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Clear history" }).click();
  await expect(page.getByText("History is empty")).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "Agent TODO", exact: true }).click();
  await expect(openList(page).getByRole("listitem")).toHaveCount(2);
  await expect(page.getByRole("tab", { name: /History/ })).toContainText("0");
});

test("shows the fixed-format rule and keeps file changes to the desktop app", async ({ page }) => {
  await openTool(page);
  await page.getByRole("button", { name: "TODO settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Agent TODO settings" })).toBeVisible();
  await expect(page.getByText("When you leave a follow-up for the user, write it on its own line as `TODO(user): ...`")).toBeVisible();
  await expect(page.getByText("Instruction files can be changed in the desktop app only.")).toBeVisible();
  await expect(page.getByRole("switch", { name: "Watch agent chats" })).toBeDisabled();
  await page.getByRole("button", { name: "Back to list" }).click();
  await expect(openList(page)).toBeVisible();
});
