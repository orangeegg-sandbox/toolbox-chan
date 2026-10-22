import { test, expect, type Page } from "@playwright/test";

async function openPalette(page: Page) {
  await page.locator(".search-button").click();
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible();
  return palette.getByRole("combobox", { name: "Find a tool", exact: true });
}

function paletteOptions(page: Page) {
  return page.getByRole("listbox", { name: "Commands" }).getByRole("option");
}

test("the OCR tool is discoverable by its tool id", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /All tools/ }).click();
  const search = await openPalette(page);
  await search.fill("ocr");
  await expect(
    page.getByRole("option", { name: "Image to text", exact: true }),
  ).toBeVisible();
  await search.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Image to text", exact: true }),
  ).toBeVisible();

  const actionSearch = await openPalette(page);
  await actionSearch.fill("> ocr.extract");
  await expect(paletteOptions(page)).toHaveCount(1);
  await expect(
    page.getByRole("option", { name: "OCR: Extract text", exact: true }),
  ).toHaveAttribute("aria-disabled", "true");
  await actionSearch.press("Enter");
  await expect(
    page.getByRole("dialog", { name: "Command palette" }),
  ).toBeVisible();

  await actionSearch.press("Escape");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settingsSearch = await openPalette(page);
  await settingsSearch.fill("> ocr.settings");
  await expect(paletteOptions(page)).toHaveCount(1);
  await expect(
    page.getByRole("option", { name: "OCR: Open settings", exact: true }),
  ).toBeEnabled();
  await settingsSearch.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Image to text", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "OCR settings", exact: true })).toBeVisible();
  await expect(page.getByLabel("Default language", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Appearance", exact: true })).toHaveCount(0);
});

test("a custom palette shortcut takes priority over the OCR file shortcut", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Record shortcut", exact: true }).click();
  await page.keyboard.press("Control+Shift+o");
  await expect(
    page.getByRole("button", { name: "Record shortcut", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Image to text", exact: true }).click();

  let fileChooserCount = 0;
  page.on("filechooser", () => fileChooserCount++);
  await page.keyboard.press("Control+Shift+o");
  await expect(
    page.getByRole("dialog", { name: "Command palette" }),
  ).toBeVisible();
  expect(fileChooserCount).toBe(0);
});
