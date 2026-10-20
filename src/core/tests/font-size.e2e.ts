import { expect, test } from "@playwright/test";

const fixture = "/src/core/tests/fixtures/index.html";
const storageKey = "little-toolbox.font-size.v1";

test("font size updates the app and preview, preserves tool state, and survives restart", async ({
  page,
}) => {
  await page.goto(fixture);
  await expect(page.locator("html")).toHaveAttribute("data-ui-font-size", "125");
  await page.getByRole("button", { name: "Increment counter" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();

  const select = page.getByRole("combobox", { name: "Font size", exact: true });
  const preview = page.getByRole("group", { name: "Font size preview" });
  const previewHeading = preview.getByRole("heading");
  await expect(select).toHaveValue("125");
  await expect(previewHeading).toHaveCSS("font-size", "21.25px");

  await select.selectOption("175");
  await expect(page.locator("html")).toHaveAttribute("data-ui-font-size", "175");
  await expect(preview).toContainText("Extra large · 175%");
  await expect(previewHeading).toHaveCSS("font-size", "29.75px");
  expect(
    await page.evaluate(() =>
      document.documentElement.style.getPropertyValue("--ui-font-scale"),
    ),
  ).toBe("1.75");

  await page.getByRole("button", { name: "Counter fixture", exact: true }).click();
  await expect(page.getByLabel("Counter value")).toHaveText("1");
  await expect(page.locator("html")).toHaveAttribute("data-ui-font-size", "175");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-ui-font-size", "175");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(select).toHaveValue("175");
  expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBe(
    "175",
  );
});

test("invalid saved font sizes recover to Medium without preventing startup", async ({
  page,
}) => {
  await page.goto(`${fixture}?empty`);
  await page.evaluate((key) => localStorage.setItem(key, "broken"), storageKey);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-ui-font-size", "125");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "Font size", exact: true }),
  ).toHaveValue("125");
  expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBe(
    "125",
  );
});
