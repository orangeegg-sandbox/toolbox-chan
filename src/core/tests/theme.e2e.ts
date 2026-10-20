import { test, expect, type Locator, type Page } from "@playwright/test";

const fixture = "/src/core/tests/fixtures/index.html?empty";
const preferenceKey = "little-toolbox.theme.v1";

async function openSettings(page: Page) {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  return page.getByRole("combobox", { name: "Color theme", exact: true });
}

async function expectTheme(page: Page, theme: "light" | "dark") {
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await expect(page.locator("html")).toHaveCSS("color-scheme", theme);
}

// Check rendered colors rather than particular token names or palette values.
async function expectReadableDarkSurface(surface: Locator) {
  await expect(surface).toBeVisible();
  const colors = await surface.evaluate((element) => {
    const rgb = (color: string) =>
      (color.match(/[\d.]+/g) ?? []).map(Number);
    const text = rgb(getComputedStyle(element).color);
    let ancestor: Element | null = element;
    let background: number[] = [];
    while (ancestor) {
      background = rgb(getComputedStyle(ancestor).backgroundColor);
      if (background.length === 3 || background[3] === 1) break;
      ancestor = ancestor.parentElement;
    }
    const luminance = (channels: number[]) => {
      const [red, green, blue] = channels.slice(0, 3).map((channel) => {
        const value = channel / 255;
        return value <= 0.04045
          ? value / 12.92
          : ((value + 0.055) / 1.055) ** 2.4;
      });
      return red * 0.2126 + green * 0.7152 + blue * 0.0722;
    };
    const backgroundLuminance = luminance(background);
    const textLuminance = luminance(text);
    return {
      backgroundLuminance,
      contrast: (textLuminance + 0.05) / (backgroundLuminance + 0.05),
    };
  });
  expect(colors.backgroundLuminance).toBeLessThan(0.15);
  expect(colors.contrast).toBeGreaterThanOrEqual(4.5);
}

test("system theme is available without tools and follows live system changes", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(fixture);
  await expectTheme(page, "dark");
  const theme = await openSettings(page);
  await expect(theme).toHaveValue("system");
  await expect(theme.locator("option")).toHaveText(["System", "Light", "Dark"]);
  await expect(page.locator(".tool-card")).toHaveCount(0);

  await page.emulateMedia({ colorScheme: "light" });
  await expectTheme(page, "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expectTheme(page, "dark");
  await expect(theme).toHaveValue("system");
});

for (const preference of ["light", "dark"] as const) {
  test(`${preference} theme overrides the system and persists after reload`, async ({
    page,
  }) => {
    const opposite = preference === "dark" ? "light" : "dark";
    await page.emulateMedia({ colorScheme: opposite });
    await page.goto(fixture);
    const theme = await openSettings(page);
    await theme.selectOption(preference);
    await expectTheme(page, preference);
    await expect
      .poll(() => page.evaluate((key) => localStorage.getItem(key), preferenceKey))
      .toBe(preference);

    await page.emulateMedia({ colorScheme: preference });
    await page.emulateMedia({ colorScheme: opposite });
    await expectTheme(page, preference);
    await page.reload();
    await expectTheme(page, preference);
    await expect(await openSettings(page)).toHaveValue(preference);

    await page.getByLabel("Color theme", { exact: true }).selectOption("system");
    await expectTheme(page, opposite);
    await page.reload();
    await expectTheme(page, opposite);
    await expect(await openSettings(page)).toHaveValue("system");
    await page.emulateMedia({ colorScheme: preference });
    await expectTheme(page, preference);
  });
}

test("dark settings, library, search, and help keep dark surfaces and readable text", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/src/core/tests/fixtures/index.html");
  const theme = await openSettings(page);
  await theme.selectOption("dark");
  await expectTheme(page, "dark");
  await expectReadableDarkSurface(page.locator(".sidebar"));
  await expectReadableDarkSurface(theme);

  await page.getByRole("button", { name: /All tools/ }).click();
  await expectReadableDarkSurface(page.locator(".tool-card").first());
  await page.keyboard.press("Control+k");
  await expectReadableDarkSurface(page.locator(".command-dialog"));
  await expectReadableDarkSurface(page.getByRole("textbox", { name: "Find a tool", exact: true }));
  await page.getByRole("button", { name: "Close search" }).click();

  await page.getByRole("button", { name: "Keyboard shortcuts", exact: true }).click();
  await expectReadableDarkSurface(page.locator(".help-dialog"));
  await expectReadableDarkSurface(page.locator(".shortcut-list kbd").first());
});
