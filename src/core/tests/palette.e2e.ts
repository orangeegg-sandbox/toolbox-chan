import { test, expect, type Page } from "@playwright/test";

const fixtureUrl = "/src/core/tests/fixtures/index.html";

async function openPalette(page: Page) {
  await page.locator(".search-button").click();
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible();
  return palette.getByRole("combobox", { name: "Find a tool", exact: true });
}

async function doubleTapShortcut(page: Page) {
  await page.keyboard.press("Control+Shift");
  await page.keyboard.press("Control+Shift");
}

function paletteOptions(page: Page) {
  return page.getByRole("listbox", { name: "Commands" }).getByRole("option");
}

test("the default modifier double tap opens the palette without intercepting other shortcuts", async ({
  page,
}) => {
  await page.goto(fixtureUrl);
  await expect(
    page.getByRole("heading", { name: "Counter fixture", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Control+Shift+A");
  await page.keyboard.press("Control+Shift+A");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).not.toBeVisible();

  await doubleTapShortcut(page);
  await expect(palette).toBeVisible();
  await expect(
    palette.getByRole("combobox", { name: "Find a tool", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(palette).not.toBeVisible();
});

test("tool ids, descriptions, and keywords find tools and Enter opens the selected result", async ({
  page,
}) => {
  await page.goto(fixtureUrl);
  const search = await openPalette(page);
  await search.fill("notes");
  await expect(
    page.getByRole("option", { name: "Notes fixture", exact: true }),
  ).toBeVisible();
  await search.fill("another independent");
  await expect(
    page.getByRole("option", { name: "Notes fixture", exact: true }),
  ).toBeVisible();
  await search.fill("scratchpad");
  await expect(paletteOptions(page)).toHaveCount(1);
  await search.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Notes fixture", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "Command palette" }),
  ).not.toBeVisible();
});

test("keyboard result navigation supports arrows, Home, and End", async ({
  page,
}) => {
  await page.goto(fixtureUrl);
  const search = await openPalette(page);
  await search.fill("fixture");
  const counter = page.getByRole("option", {
    name: "Counter fixture",
    exact: true,
  });
  const notes = page.getByRole("option", {
    name: "Notes fixture",
    exact: true,
  });
  await expect(paletteOptions(page)).toHaveCount(2);
  await search.press("Home");
  await expect(counter).toHaveAttribute("aria-selected", "true");
  await search.press("ArrowDown");
  await expect(notes).toHaveAttribute("aria-selected", "true");
  await search.press("ArrowUp");
  await expect(counter).toHaveAttribute("aria-selected", "true");
  await search.press("End");
  await expect(notes).toHaveAttribute("aria-selected", "true");
  await search.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Notes fixture", exact: true }),
  ).toBeVisible();
});

test("tool commands use their retained provider and the current settings across navigation", async ({
  page,
}) => {
  await page.goto(fixtureUrl);
  await page.getByLabel("Counter step").fill("3");
  await page
    .getByRole("button", { name: "Notes fixture", exact: true })
    .click();
  await page.getByLabel("Fixture note").fill("Keep this note");

  const search = await openPalette(page);
  await search.fill("> plus");
  await expect(paletteOptions(page)).toHaveCount(1);
  await page
    .getByRole("option", { name: "Increment counter", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Command palette" }),
  ).not.toBeVisible();
  await page
    .getByRole("button", { name: "Counter fixture", exact: true })
    .click();
  await expect(page.getByLabel("Counter value")).toHaveText("3");

  const reopenedSearch = await openPalette(page);
  await reopenedSearch.fill("Increment counter");
  await reopenedSearch.press("Enter");
  await expect(page.getByLabel("Counter value")).toHaveText("6");
  await page
    .getByRole("button", { name: "Notes fixture", exact: true })
    .click();
  await expect(page.getByLabel("Fixture note")).toHaveValue("Keep this note");
});

test("Escape restores focus and reopening resets the query and result selection", async ({
  page,
}) => {
  await page.goto(fixtureUrl);
  const trigger = page.locator(".search-button");
  await trigger.focus();
  const search = await openPalette(page);
  await search.fill("fixture");
  await search.press("End");
  await search.press("Escape");
  await expect(trigger).toBeFocused();

  const reopenedSearch = await openPalette(page);
  await expect(reopenedSearch).toHaveValue("");
  await expect(paletteOptions(page).first()).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await reopenedSearch.fill("a command that does not exist");
  await expect(paletteOptions(page)).toHaveCount(0);
  await expect(page.getByText("No matching commands", { exact: true })).toBeVisible();
  await reopenedSearch.press("Enter");
  await expect(
    page.getByRole("dialog", { name: "Command palette" }),
  ).toBeVisible();
  await page.mouse.click(10, 10);
  await expect(
    page.getByRole("dialog", { name: "Command palette" }),
  ).not.toBeVisible();
});

test("the palette works with an empty tool registry", async ({ page }) => {
  await page.goto(`${fixtureUrl}?empty`);
  const search = await openPalette(page);
  await expect(
    page.getByRole("option", { name: "Counter fixture", exact: true }),
  ).toHaveCount(0);
  await search.fill("zzzzzzzz");
  await expect(paletteOptions(page)).toHaveCount(0);
  await expect(page.getByText("No matching commands", { exact: true })).toBeVisible();
  await search.fill("Settings");
  await search.press("Enter");
  await expect(
    page.getByRole("region", { name: "Command palette", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Counter step")).toHaveCount(0);
});

test("a recorded shortcut persists, replaces the default, and can be restored", async ({
  page,
}) => {
  await page.goto(fixtureUrl);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Record shortcut", exact: true }).click();
  await page.keyboard.press("Control+Alt+p");
  await expect(
    page.getByRole("button", { name: "Record shortcut", exact: true }),
  ).toBeVisible();
  await page.reload();

  const palette = page.getByRole("dialog", { name: "Command palette" });
  await doubleTapShortcut(page);
  await expect(palette).not.toBeVisible();
  await page.keyboard.press("Control+Alt+p");
  await expect(palette).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Restore default", exact: true }).click();
  await page.keyboard.press("Control+Alt+p");
  await expect(palette).not.toBeVisible();
  await doubleTapShortcut(page);
  await expect(palette).toBeVisible();
});
