import { expect, test } from "@playwright/test";

const fixture = "/src/core/tests/fixtures/index.html";

test("a tool window renders only its own surface on a transparent page", async ({ page }) => {
  await page.goto(`${fixture}#tool-window/counter/mini`);
  const surface = page.getByRole("region", { name: "Counter window" });
  await expect(surface).toContainText("Counter fixture window surface.");
  // No shell, no other tools, and no tool providers.
  await expect(surface).toContainText("No tool provider here.");
  await expect(page.locator(".app-shell, .sidebar, .topbar")).toHaveCount(0);
  await expect(page.getByLabel("Fixture note")).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("data-surface", "tool-window");
  expect(await page.evaluate(() => [
    getComputedStyle(document.documentElement).backgroundColor,
    getComputedStyle(document.body).backgroundColor,
  ])).toEqual(["rgba(0, 0, 0, 0)", "rgba(0, 0, 0, 0)"]);
  // The shared appearance providers still apply.
  await expect(page.locator("html")).toHaveAttribute("data-theme", /light|dark/);
});

test("an unknown tool window says so instead of opening the toolbox", async ({ page }) => {
  for (const hash of ["#tool-window/counter/missing", "#tool-window/notes/mini", "#tool-window/absent/mini"]) {
    // A hash-only change would not reload the page.
    await page.goto("about:blank");
    await page.goto(`${fixture}${hash}`);
    await expect(page.getByRole("alert")).toHaveText("This window is not available.");
    await expect(page.locator(".app-shell")).toHaveCount(0);
  }
});

test("the app entry routes tool windows without mounting the toolbox shell", async ({ page }) => {
  const shellModules: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/src/core/ToolboxApp.tsx") shellModules.push(request.url());
  });
  await page.goto("/#tool-window/no-such-tool/window");
  await expect(page.getByRole("alert")).toHaveText("This window is not available.");
  await expect(page.locator(".app-shell, .sidebar")).toHaveCount(0);
  expect(shellModules).toEqual([]);
  await page.goto("/");
  await expect(page.locator(".app-shell")).toBeVisible();
  await expect(page.locator("html")).not.toHaveAttribute("data-surface", "tool-window");
});
