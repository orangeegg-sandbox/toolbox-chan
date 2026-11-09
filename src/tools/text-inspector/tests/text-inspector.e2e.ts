import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

async function openTool(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: async (text: string) => {
        (window as Window & { copiedText?: string }).copiedText = text;
      },
    } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Text inspector", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Text inspector", level: 1 })).toBeVisible();
}

// Real paste data is captured before a textarea can normalize CR/CRLF to LF.
async function paste(page: Page, text: string) {
  await page.getByLabel("Paste text to inspect", { exact: true }).evaluate((element, value) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", value);
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
  }, text);
}

async function copy(page: Page) {
  await page.getByRole("button", { name: "Copy cleaned text", exact: true }).click();
  return page.evaluate(() => (window as Window & { copiedText?: string }).copiedText);
}

test("preserves mixed Unicode and original newlines, then copies and exports chosen conversions", async ({ page }) => {
  await openTool(page);
  await expect(page.getByRole("heading", { name: "Paste text to inspect its characters" })).toBeVisible();
  const source = "\uFEFF你好\u00A0👩‍💻 ❤️e\u0301\r\nhello\u200Bworld\u0000\nlast\rline";
  await paste(page, source);
  await expect(page.getByLabel("Marked original text", { exact: true })).toContainText("[ZWSP]");
  expect(await copy(page)).toBe(source.replace(/^\uFEFF/, "").replace(/\u0000/g, ""));

  await page.getByLabel("Remove zero-width space", { exact: true }).check();
  await page.getByLabel("Convert unusual spaces", { exact: true }).check();
  await page.getByLabel("Line endings", { exact: true }).selectOption("crlf");
  const expected = "你好 👩‍💻 ❤️e\u0301\r\nhelloworld\r\nlast\r\nline";
  expect(await copy(page)).toBe(expected);

  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save .txt", exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("clean-text.txt");
  expect(await readFile((await download.path())!)).toEqual(Buffer.from(expected, "utf8"));

  await page.getByRole("button", { name: "All characters", exact: true }).click();
  await expect(page.getByRole("table", { name: "All characters in logical order" })).toContainText("U+200D");
});

test("keeps source in session across navigation, clears explicitly, and does not persist text", async ({ page }) => {
  await openTool(page);
  const source = "private-inspector-fixture\r\n你好👩‍💻";
  await paste(page, source);
  await page.getByRole("button", { name: "Agent TODO", exact: true }).click();
  await page.getByRole("button", { name: "Text inspector", exact: true }).click();
  expect(await copy(page)).toBe(source);
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain("private-inspector-fixture");
  await page.getByRole("button", { name: "Clear text", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Paste text to inspect its characters" })).toBeVisible();
  await paste(page, source);
  await page.reload();
  await page.getByRole("button", { name: "Text inspector", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Paste text to inspect its characters" })).toBeVisible();
});

test("rejects oversize pastes without replacing prior work and blocks lossy surrogate output", async ({ page }) => {
  await openTool(page);
  await paste(page, "keep me\r\n");
  await paste(page, "x".repeat(100_001));
  await expect(page.getByRole("alert")).toContainText("100,000");
  expect(await copy(page)).toBe("keep me\r\n");
  await paste(page, "invalid\uD800text");
  await expect(page.getByRole("button", { name: "Copy cleaned text", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save .txt", exact: true })).toBeDisabled();
  await expect(page.getByLabel("Marked original text", { exact: true })).toContainText("D800");
  await paste(page, "\uD800\u0000\uDC00");
  await expect(page.getByRole("button", { name: "Copy cleaned text", exact: true })).toBeDisabled();
  await paste(page, "\u0000\u0007");
  await expect(page.getByRole("button", { name: "Copy cleaned text", exact: true })).toBeEnabled();
  expect(await copy(page)).toBe("");
});

test("shows bidi controls and literal markup without executing or decoding pasted content", async ({ page }) => {
  await openTool(page);
  const source = '<img src=x onerror="window.inspectorExecuted=true">\\u200B\u202Etxt.exe\u202C';
  await paste(page, source);
  const marked = page.getByLabel("Marked original text", { exact: true });
  await expect(marked).toContainText("[RLO]");
  await expect(marked.locator("img")).toHaveCount(0);
  expect(await marked.textContent()).not.toContain("\u202E");
  expect(await copy(page)).toBe(source);
  await page.getByLabel("Remove direction controls", { exact: true }).check();
  expect(await copy(page)).toBe(source.replace(/[\u202E\u202C]/g, ""));
});

test("reports clipboard failure without losing source", async ({ page }) => {
  await openTool(page);
  await paste(page, "clipboard denial fixture");
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: async () => { throw new Error("Clipboard unavailable"); },
    } });
  });
  await page.getByRole("button", { name: "Copy cleaned text", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(/copy|clipboard/i);
  await expect(page.getByLabel("Marked original text", { exact: true })).toContainText("clipboard");
});

test("locates off-screen findings and keeps page-boundary CRLF characters inspectable", async ({ page }) => {
  await openTool(page);
  await paste(page, "\n".repeat(300) + "\u200B");
  await page.getByRole("button", { name: "Find Zero width space", exact: true }).click();
  const selected = page.getByRole("button", { name: "Inspect Zero width space, U+200B at position 301", exact: true });
  await expect(selected).toBeFocused();
  const visible = await selected.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const preview = element.closest(".text-inspector-preview")!.getBoundingClientRect();
    return bounds.top >= preview.top && bounds.bottom <= preview.bottom;
  });
  expect(visible).toBe(true);
  const rule = page.getByLabel("Remove zero-width space", { exact: true });
  await rule.check();
  await expect(rule).toBeFocused();

  await paste(page, "x".repeat(399) + "\r\n");
  await expect(page.getByLabel("Marked original text", { exact: true })).toContainText("[CR]");
  await page.getByRole("button", { name: "Next original text page", exact: true }).click();
  await expect(page.getByLabel("Marked original text", { exact: true })).toContainText("[LF]");
  await page.getByRole("button", { name: "Find Line feed", exact: true }).click();
  await expect(page.getByRole("button", { name: "Inspect Line feed, U+000A at position 401", exact: true })).toBeFocused();
});

test("rejects non-text clipboard content without clearing existing work", async ({ page }) => {
  await openTool(page);
  await paste(page, "retain this text");
  await page.getByLabel("Paste text to inspect", { exact: true }).evaluate(element => {
    const clipboardData = new DataTransfer();
    clipboardData.items.add(new File(["image data"], "image.png", { type: "image/png" }));
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
  });
  await expect(page.getByRole("alert")).toContainText("no plain text");
  expect(await copy(page)).toBe("retain this text");
});
