import { expect, test, type Page } from "@playwright/test";

const imageWidth = 1451;
const imageHeight = 192;

async function loadWideScreenshot(page: Page) {
  const image = await page.evaluate(({ width, height }) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
    context.fillStyle = "#222";
    context.font = "24px monospace";
    context.fillText("10:00:00 INFO Screenshot starts here", 20, 56);
    context.fillText("10:00:01 INFO Compare each highlighted region", 20, 110);
    context.fillText("END OF LOG", width - 190, 164);
    return canvas.toDataURL("image/png").split(",")[1];
  }, { width: imageWidth, height: imageHeight });
  await page.getByLabel("Choose image", { exact: true }).setInputFiles({
    name: "wide-log.png",
    mimeType: "image/png",
    buffer: Buffer.from(image, "base64"),
  });
  await expect(page.getByRole("img", { name: "wide-log.png", exact: true })).toBeVisible();
}

async function expectStageScale(page: Page, scale: number) {
  await expect.poll(async () => (await page.locator(".image-stage").boundingBox())!.width)
    .toBeCloseTo(imageWidth * scale, 0);
  await expect.poll(async () => (await page.locator(".image-stage").boundingBox())!.height)
    .toBeCloseTo(imageHeight * scale, 0);
}

async function drawRegion(page: Page, x: number, y: number, width: number, height: number) {
  const bounds = await page.locator(".image-stage").boundingBox();
  if (!bounds) throw new Error("Image stage missing");
  await page.mouse.move(bounds.x + bounds.width * x, bounds.y + bounds.height * y);
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width * (x + width),
    bounds.y + bounds.height * (y + height),
    { steps: 5 },
  );
  await page.mouse.up();
}

async function regionGeometry(page: Page) {
  return page.locator(".image-stage").evaluate((stage) => {
    const image = stage.getBoundingClientRect();
    return Array.from(stage.querySelectorAll(".highlight-region:not(.draft)"), (region) => {
      const bounds = region.getBoundingClientRect();
      return {
        x: (bounds.left - image.left) / image.width,
        y: (bounds.top - image.top) / image.height,
        width: bounds.width / image.width,
        height: bounds.height / image.height,
      };
    });
  });
}

test("wide screenshots open at actual pixels, fit honestly, and can be zoomed and panned", async ({ page }) => {
  await page.goto("/");
  await loadWideScreenshot(page);
  const zoom = page.getByRole("combobox", { name: "Image zoom", exact: true });
  const preview = page.locator(".image-scroll");
  await expect(preview).toHaveAccessibleName("Image preview");
  await expect(zoom).toHaveValue("1");
  await expectStageScale(page, 1);

  await page.getByRole("button", { name: "Fit image", exact: true }).click();
  await expect(zoom).toHaveValue("fit");
  const fitted = (await page.locator(".image-stage").boundingBox())!;
  const viewportWidth = await preview.evaluate((element) => element.clientWidth);
  expect(fitted.width).toBeLessThan(imageWidth);
  expect(fitted.width).toBeLessThanOrEqual(viewportWidth);
  expect(fitted.width / fitted.height).toBeCloseTo(imageWidth / imageHeight, 1);
  await expect(zoom.locator("option:checked")).toContainText(
    `${Math.round((fitted.width / imageWidth) * 100)}%`,
  );

  for (const scale of [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4]) {
    await zoom.selectOption(String(scale));
    await expectStageScale(page, scale);
  }
  await page.getByRole("button", { name: "Actual size (100%)", exact: true }).click();
  await expect(zoom).toHaveValue("1");
  await expectStageScale(page, 1);
  await page.getByRole("button", { name: "Zoom out", exact: true }).click();
  expect(Number(await zoom.inputValue())).toBeLessThan(1);
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expectStageScale(page, 1);

  await zoom.selectOption("2");
  expect(await preview.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  await preview.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
  const farRight = await preview.evaluate((element) => element.scrollLeft);
  expect(farRight).toBeGreaterThan(imageWidth);
  const stageBounds = (await page.locator(".image-stage").boundingBox())!;
  const previewBounds = (await preview.boundingBox())!;
  expect(stageBounds.x + stageBounds.width).toBeLessThanOrEqual(previewBounds.x + previewBounds.width + 1);

  await page.getByRole("button", { name: "Pan image", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pan image", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.mouse.move(previewBounds.x + 60, previewBounds.y + 65);
  await page.mouse.down();
  await page.mouse.move(previewBounds.x + 240, previewBounds.y + 65, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => preview.evaluate((element) => element.scrollLeft)).toBeLessThan(farRight - 100);
});

test("regions keep source coordinates and crop dimensions through zoom, resize, and comparison expansion", async ({ page }) => {
  const uploads: Array<{ width: number; height: number }> = [];
  await page.route("https://preview.example/v1/chat/completions", async (route) => {
    const body = route.request().postDataJSON();
    const png = Buffer.from(body.messages[1].content[1].image_url.url.split(",")[1], "base64");
    uploads.push({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) });
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ choices: [{ message: { content: `Crop ${uploads.length}` }, finish_reason: "stop" }] }),
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "OCR settings", exact: true }).click();
  await page.getByLabel("API base URL").fill("https://preview.example/v1");
  await page.getByLabel("Vision model", { exact: true }).fill("preview-test");
  await page.getByRole("button", { name: "Back to workspace", exact: true }).click();
  await loadWideScreenshot(page);
  await page.getByLabel("OCR engine").selectOption("online");
  await page.getByRole("tab", { name: "Custom", exact: true }).click();
  await page.getByRole("button", { name: "Fit image", exact: true }).click();
  await drawRegion(page, 0.08, 0.12, 0.25, 0.4);
  await drawRegion(page, 0.58, 0.5, 0.3, 0.4);
  await expect(page.locator(".highlight-region:not(.draft)")).toHaveCount(2);
  await expect(page.locator(".region-list").getByRole("button", { name: "Region 1", exact: true })).toBeVisible();
  await expect(page.locator(".region-list").getByRole("button", { name: "Region 2", exact: true })).toBeVisible();
  const original = await regionGeometry(page);
  expect(original[0].x).toBeCloseTo(0.08, 2);
  expect(original[0].width).toBeCloseTo(0.25, 2);
  expect(original[1].x).toBeCloseTo(0.58, 2);
  expect(uploads).toEqual([]);

  await page.getByRole("button", { name: "Upload & extract text", exact: false }).click();
  await expect(page.getByRole("textbox", { name: "Recognized text", exact: true })).toHaveValue("Crop 1\n\nCrop 2");
  expect(uploads).toHaveLength(2);
  for (let index = 0; index < original.length; index++) {
    expect(uploads[index].width).toBeCloseTo(original[index].width * imageWidth, -1);
    expect(uploads[index].height).toBeCloseTo(original[index].height * imageHeight, -1);
  }

  await page.locator(".region-list").getByRole("button", { name: "Region 1", exact: true }).click();
  await expect(page.locator(".highlight-region").nth(0)).toHaveClass(/selected/);
  await expect(page.locator(".highlight-region").nth(1)).not.toHaveClass(/selected/);
  await expect(page.locator(".region-results .selected")).toContainText("Region 1");
  await expect(page.getByRole("textbox", { name: "Recognized text for region 1", exact: true })).toHaveValue("Crop 1");
  await page.getByRole("textbox", { name: "Recognized text for region 1", exact: true }).fill("Edited first crop");
  await page.locator(".region-results").getByRole("button", { name: "All text", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Recognized text", exact: true })).toHaveValue("Edited first crop\n\nCrop 2");
  await page.locator(".region-results").getByRole("button", { name: "Region 2", exact: true }).click();
  await expect(page.locator(".highlight-region").nth(1)).toHaveClass(/selected/);
  await expect(page.getByRole("textbox", { name: "Recognized text for region 2", exact: true })).toHaveValue("Crop 2");
  await page.locator(".region-results").getByRole("button", { name: "Region 1", exact: true }).click();
  await page.getByRole("combobox", { name: "Image zoom", exact: true }).selectOption("2");
  await expectStageScale(page, 2);
  const zoomed = await regionGeometry(page);
  for (let index = 0; index < original.length; index++) {
    for (const coordinate of ["x", "y", "width", "height"] as const)
      expect(zoomed[index][coordinate]).toBeCloseTo(original[index][coordinate], 3);
  }
  await page.getByRole("button", { name: "Pan image", exact: true }).click();
  const preview = page.locator(".image-scroll");
  await preview.evaluate((element) => { element.scrollLeft = 0; });
  const bounds = (await preview.boundingBox())!;
  await page.mouse.move(bounds.x + 240, bounds.y + 65);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 60, bounds.y + 65, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => preview.evaluate((element) => element.scrollLeft)).toBeGreaterThan(100);
  await expect(page.locator(".highlight-region:not(.draft)")).toHaveCount(2);
  await page.getByRole("button", { name: "Draw regions", exact: true }).click();
  await expect(page.getByRole("button", { name: "Draw regions", exact: true })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "Expand comparison", exact: true }).click();
  const comparison = page.locator(".ocr-comparison.is-expanded");
  await expect(comparison).toBeVisible();
  await expect(comparison.locator(".image-stage")).toBeVisible();
  await expect(comparison.getByRole("textbox", { name: "Recognized text for region 1", exact: true })).toBeVisible();
  expect(await comparison.evaluate((element) => getComputedStyle(element).position)).toBe("fixed");
  await expect(page.getByRole("button", { name: "Restore comparison", exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "Fit image", exact: true }).click();
  const afterResize = await regionGeometry(page);
  for (let index = 0; index < original.length; index++) {
    for (const coordinate of ["x", "y", "width", "height"] as const)
      expect(afterResize[index][coordinate]).toBeCloseTo(original[index][coordinate], 3);
  }
  await page.screenshot({
    path: "test-results/ocr-comparison-expanded.png",
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await expect(page.locator(".ocr-comparison.is-expanded")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Expand comparison", exact: true })).toBeVisible();
  await page.locator(".region-results").getByRole("button", { name: "All text", exact: true }).click();
  await page.getByRole("button", { name: "Upload & extract text", exact: false }).click();
  await expect(page.getByRole("textbox", { name: "Recognized text", exact: true })).toHaveValue("Crop 3\n\nCrop 4");
  expect(uploads.slice(2)).toEqual(uploads.slice(0, 2));
});

test("expanded comparison shows errors and can restore after removing its last image", async ({ page }) => {
  await page.goto("/");
  await loadWideScreenshot(page);
  await page.getByRole("tab", { name: "Custom", exact: true }).click();
  await page.getByRole("button", { name: "Expand comparison", exact: true }).click();
  const comparison = page.getByRole("dialog", { name: "Image and text comparison", exact: true });
  await comparison.getByRole("button", { name: "Extract text", exact: false }).click();
  await expect(comparison.getByRole("alert")).toHaveCount(1);
  await expect(comparison.getByRole("alert")).toBeVisible();
  await expect(comparison.getByRole("alert")).toContainText("Highlight at least one area on the image first.");
  await expect(page.getByRole("alert")).toHaveCount(1);

  await comparison.getByRole("button", { name: "Remove image", exact: true }).click();
  await expect(comparison.locator(".image-stage")).toHaveCount(0);
  await expect(comparison.getByRole("textbox", { name: /Recognized text/ })).toHaveCount(0);
  const restore = comparison.getByRole("button", { name: "Restore comparison", exact: true });
  await expect(restore).toBeEnabled();
  await restore.click();
  await expect(page.getByRole("dialog", { name: "Image and text comparison", exact: true })).toHaveCount(0);
  await expect(page.locator(".ocr-comparison.is-expanded")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Expand comparison", exact: true })).toBeDisabled();
});
