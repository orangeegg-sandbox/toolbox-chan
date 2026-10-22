import { test, expect } from "@playwright/test";

test("the shell mounts independent tools into its layout and preserves module state across navigation", async ({
  page,
}) => {
  await page.goto("/src/core/tests/fixtures/index.html");
  await expect(
    page.getByRole("heading", { name: "Counter fixture", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Toolbar supplied by the counter module."),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Counter fixture workspace" }),
  ).toContainText("Counter footer slot.");
  await page.getByRole("button", { name: "Increment counter" }).click();
  await expect(page.getByLabel("Counter value")).toHaveText("1");
  await page
    .getByRole("button", { name: "Notes fixture", exact: true })
    .click();
  await page.getByLabel("Fixture note").fill("Independent module state");
  await page
    .getByRole("button", { name: "Counter fixture", exact: true })
    .click();
  await page.getByLabel("Counter step").fill("3");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel("Counter step")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Appearance", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Counter fixture", exact: true }).click();
  await expect(page.getByLabel("Counter step")).toHaveValue("3");
  await page.getByRole("button", { name: "Increment counter" }).click();
  await expect(page.getByLabel("Counter value")).toHaveText("4");
  await page
    .getByRole("button", { name: "Notes fixture", exact: true })
    .click();
  await expect(page.getByLabel("Fixture note")).toHaveValue(
    "Independent module state",
  );
});

test("registry entries populate navigation, library, search, and optional contributions", async ({
  page,
}) => {
  await page.goto("/src/core/tests/fixtures/index.html");
  await page.getByRole("button", { name: /All tools/ }).click();
  await expect(page.locator(".tool-card")).toHaveCount(2);
  await expect(page.getByRole("button", { name: /All tools/ })).toContainText(
    "02",
  );
  await page.keyboard.press("Control+k");
  await page
    .getByRole("combobox", { name: "Find a tool", exact: true })
    .fill("Notes");
  await page
    .locator(".command-results")
    .getByRole("option", { name: /Notes fixture/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "Notes fixture", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Recent activity", exact: true })
    .click();
  await expect(page.getByText("Counter activity contribution.")).toBeVisible();
  await expect(page.getByText("Recognition language")).toHaveCount(0);
});

test("the core also works with no tool modules registered", async ({
  page,
}) => {
  await page.goto("/src/core/tests/fixtures/index.html?empty");
  await expect(page.locator(".tool-card")).toHaveCount(0);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Command palette", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Recent activity", exact: true })
    .click();
  await expect(
    page.getByText("Your installed tools have no recent activity yet."),
  ).toBeVisible();
});
