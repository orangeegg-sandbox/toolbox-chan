import { test, expect } from "@playwright/test";

test("whole-image OCR works with all outside network requests blocked, then exports and restores history", async ({
  page,
}) => {
  const external: string[] = [];
  await page.route("**/*", (route) => {
    if (new URL(route.request().url()).hostname !== "127.0.0.1") {
      external.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Try a sample image" }).click();
  await page
    .getByRole("button", { name: "Extract text", exact: false })
    .click();
  const editor = page.getByRole("textbox", { name: "Recognized text" });
  await expect(editor).toHaveValue(/A little less busywork/);
  await expect(editor).toHaveValue(/No uploads. No accounts/);
  expect(external).toEqual([]);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export .txt", exact: true }).click();
  expect((await download).suggestedFilename()).toBe(
    "a-little-less-busywork.txt",
  );
  await page.getByRole("button", { name: /Recent activity/ }).click();
  await expect(
    page.getByRole("button", { name: /a-little-less-busywork.png/ }).first(),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: /Recent activity/ }).click();
  await page
    .getByRole("button", { name: /a-little-less-busywork.png/ })
    .first()
    .click();
  await expect(editor).toHaveValue(/A little less busywork/);
  await page.screenshot({
    path: "test-results/ocr-result.png",
    fullPage: true,
  });
});

test("overlay provides selectable positioned words and custom mode reads only a highlighted region", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try a sample image" }).click();
  await page.getByRole("tab", { name: "Overlay" }).click();
  await page
    .getByRole("button", { name: "Extract text", exact: false })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Recognized text" }),
  ).toHaveValue(/A little less busywork/);
  await expect(page.locator(".text-overlay span").first()).toBeVisible();
  expect(await page.locator(".text-overlay span").count()).toBeGreaterThan(10);
  const originalWidth = (await page.locator(".image-stage").boundingBox())!
    .width;
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  expect(
    (await page.locator(".image-stage").boundingBox())!.width,
  ).toBeGreaterThan(originalWidth * 1.9);
  await page.getByRole("button", { name: "Fit image", exact: true }).click();
  await page
    .locator(".text-overlay span")
    .first()
    .evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
    });
  expect(await page.evaluate(() => window.getSelection()?.toString())).toMatch(
    /\w/,
  );
  await page.getByRole("tab", { name: "Custom" }).click();
  const image = await page.locator(".image-stage").boundingBox();
  if (!image) throw new Error("Image preview missing");
  await page.mouse.move(
    image.x + image.width * 0.045,
    image.y + image.height * 0.16,
  );
  await page.mouse.down();
  await page.mouse.move(
    image.x + image.width * 0.95,
    image.y + image.height * 0.27,
  );
  await page.mouse.up();
  await expect(page.locator(".highlight-region")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Extract text", exact: false })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Recognized text" }),
  ).toHaveValue(/A little less busywork/);
  await expect(
    page.getByRole("textbox", { name: "Recognized text" }),
  ).not.toHaveValue(/No uploads/);
});

test("Chinese models are local and recognize both variants", async ({
  page,
}) => {
  await page.goto("/");
  const image = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 1400;
    canvas.height = 300;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, 1400, 300);
    ctx.fillStyle = "#000";
    ctx.font = '52px "Microsoft JhengHei", "Microsoft YaHei", sans-serif';
    ctx.fillText("你好世界 中文文字辨識", 70, 100);
    ctx.fillText("Hello world 简体中文文字识别", 70, 210);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await page.getByLabel("Choose image", { exact: true }).setInputFiles({
    name: "chinese.png",
    mimeType: "image/png",
    buffer: Buffer.from(image, "base64"),
  });
  await page
    .getByLabel("Recognition language")
    .selectOption("eng+chi_tra+chi_sim");
  await page
    .getByRole("button", { name: "Extract text", exact: false })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Recognized text" }),
  ).toHaveValue(/你好世界/);
  await expect(
    page.getByRole("textbox", { name: "Recognized text" }),
  ).toHaveValue(/Hello world/);
});

test("settings, invalid files, and online mode have clear boundaries", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Choose image", { exact: true }).setInputFiles({
    name: "document.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("test"),
  });
  await expect(page.getByRole("alert")).toContainText("Choose a PNG");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Keep recent activity").uncheck();
  await page.getByLabel("API key").fill("session-only-secret");
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
    "session-only-secret",
  );
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel("Keep recent activity")).not.toBeChecked();
  await expect(page.getByLabel("API key")).toHaveValue("");
  await page
    .getByRole("button", { name: "Image to text", exact: true })
    .click();
  await page.getByLabel("OCR engine").selectOption("online");
  await expect(page.getByRole("tab", { name: "Overlay" })).toBeDisabled();
  await expect(
    page.getByText("Your image will be sent", { exact: false }),
  ).toBeVisible();
});

test("online OCR uploads only highlighted crops on an explicit run and handles provider errors", async ({
  page,
}) => {
  let requests = 0;
  let fail = false;
  await page.route(
    "https://vision.example/v1/chat/completions",
    async (route) => {
      requests++;
      const body = route.request().postDataJSON();
      expect(body.model).toBe("test-vision");
      expect(route.request().headers().authorization).toBe(
        "Bearer test-session-key",
      );
      const image = Buffer.from(
        body.messages[1].content[1].image_url.url.split(",")[1],
        "base64",
      );
      expect(image.readUInt32BE(16)).toBeLessThan(1440);
      expect(image.readUInt32BE(20)).toBeLessThan(920);
      await route.fulfill({
        status: fail ? 401 : 200,
        contentType: "application/json",
        body: JSON.stringify({
          choices: [
            {
              message: { content: "Highlighted text 中文" },
              finish_reason: "stop",
            },
          ],
        }),
      });
    },
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("API base URL").fill("https://vision.example/v1");
  await page.getByLabel("Vision model", { exact: true }).fill("test-vision");
  await page.getByLabel("API key", { exact: true }).fill("test-session-key");
  await page
    .getByRole("button", { name: "Image to text", exact: true })
    .click();
  await page.getByRole("button", { name: "Try a sample image" }).click();
  await page.getByLabel("OCR engine").selectOption("online");
  await page.getByRole("tab", { name: "Custom" }).click();
  await page.getByRole("button", { name: "Fit image", exact: true }).click();
  const image = await page.locator(".image-stage").boundingBox();
  if (!image) throw new Error("Image preview missing");
  await page.mouse.move(
    image.x + image.width * 0.1,
    image.y + image.height * 0.15,
  );
  await page.mouse.down();
  await page.mouse.move(
    image.x + image.width * 0.9,
    image.y + image.height * 0.3,
  );
  await page.mouse.up();
  expect(requests).toBe(0);
  await page
    .getByRole("button", { name: "Upload & extract text", exact: false })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Recognized text" }),
  ).toHaveValue("Highlighted text 中文");
  expect(requests).toBe(1);
  fail = true;
  await page
    .getByRole("button", { name: "Upload & extract text", exact: false })
    .click();
  await expect(page.getByRole("alert")).toContainText("HTTP 401");
});

test("cancellation releases the job and allows another offline run", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try a sample image" }).click();
  await page
    .getByRole("button", { name: "Extract text", exact: false })
    .click();
  await page.getByRole("button", { name: "Cancel recognition" }).click();
  await expect(
    page.getByRole("button", { name: "Extract text", exact: false }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Extract text", exact: false })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Recognized text" }),
  ).toHaveValue(/A little less busywork/);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("pasted image events feed the same offline OCR workflow", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 1100;
    canvas.height = 250;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, 1100, 250);
    ctx.fillStyle = "#000";
    ctx.font = "bold 58px Arial";
    ctx.fillText("Pasted images work offline.", 50, 140);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((value) => resolve(value!), "image/png"),
    );
    const data = new DataTransfer();
    data.items.add(new File([blob], "pasted-image.png", { type: "image/png" }));
    document.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(
    page.getByRole("img", { name: "pasted-image.png" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Extract text", exact: false })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Recognized text" }),
  ).toHaveValue(/Pasted images work offline/);
});
