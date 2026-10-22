import { expect, test, type Page } from "@playwright/test";

async function settings(page: Page) {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
}

async function expectNoPageOverflow(page: Page) {
  expect(await page.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  )).toBe(true);
}

test("appearance changes preserve OCR results and actual image dimensions", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try a sample image" }).click();
  await page.getByRole("button", { name: "Actual size (100%)", exact: true }).click();
  const sourceWidth = await page.locator(".image-stage > img").evaluate(
    (image: HTMLImageElement) => image.naturalWidth,
  );
  await expect.poll(async () => (await page.locator(".image-stage").boundingBox())!.width)
    .toBeCloseTo(sourceWidth, 0);
  await page.getByRole("button", { name: "Extract text", exact: false }).click();
  const editor = page.getByRole("textbox", { name: "Recognized text" });
  await expect(editor).toHaveValue(/A little less busywork/);
  const originalFont = await editor.evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
  await editor.fill("Compared and corrected text stays here.");

  await settings(page);
  await page.getByLabel("Color theme", { exact: true }).selectOption("dark");
  await page.getByLabel("Font size", { exact: true }).selectOption("175");
  await page.getByRole("button", { name: "Image to text", exact: true }).click();
  await expect(editor).toHaveValue("Compared and corrected text stays here.");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const largerFont = await editor.evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
  expect(largerFont / originalFont).toBeCloseTo(1.4, 2);
  await page.getByRole("button", { name: "Actual size (100%)", exact: true }).click();
  expect((await page.locator(".image-stage").boundingBox())!.width).toBeCloseTo(sourceWidth, 0);
  const colors = await editor.evaluate((element) => {
    const style = getComputedStyle(element);
    return { text: style.color, background: style.backgroundColor };
  });
  expect(colors.background).not.toBe("rgb(255, 255, 255)");
  expect(colors.text).not.toBe(colors.background);

  for (const width of [1280, 900, 780]) {
    await page.setViewportSize({ width, height: 720 });
    await page.getByRole("tab", { name: "Custom", exact: true }).click();
    await expectNoPageOverflow(page);
    const clippedControls = await page.locator(".image-toolbar").evaluate((toolbar) => {
      const bounds = toolbar.getBoundingClientRect();
      return Array.from(toolbar.querySelectorAll("button, select")).filter((control) => {
        const rect = control.getBoundingClientRect();
        return rect.left < bounds.left - 1 || rect.right > bounds.right + 1
          || rect.top < bounds.top - 1 || rect.bottom > bounds.bottom + 1;
      }).map((control) => control.getAttribute("aria-label") || control.textContent);
    });
    expect(clippedControls).toEqual([]);
    await settings(page);
    await expect(page.getByLabel("Font size", { exact: true })).toHaveValue("175");
    await expectNoPageOverflow(page);
    await page.getByRole("button", { name: "Help & shortcuts", exact: true }).click();
    await expect(page.locator(".help-dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Image to text", exact: true }).click();
  }
});

test("expanded OCR displays errors and can be restored after removing its image", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try a sample image" }).click();
  await page.getByLabel("OCR engine").selectOption("online");
  await page.getByRole("button", { name: "Expand comparison", exact: true }).click();
  const comparison = page.getByRole("dialog", { name: "Image and text comparison", exact: true });
  await comparison.getByRole("button", { name: "Upload & extract text", exact: false }).click();
  await expect(comparison.getByRole("alert")).toBeVisible();
  await expect(comparison.getByRole("alert")).toBeInViewport();
  await comparison.getByRole("button", { name: "Dismiss error", exact: true }).click();
  await comparison.getByRole("button", { name: "Remove image", exact: true }).click();
  const restore = comparison.getByRole("button", { name: "Restore comparison", exact: true });
  await expect(restore).toBeEnabled();
  await restore.click();
  await expect(comparison).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Expand comparison", exact: true })).toBeDisabled();
});
