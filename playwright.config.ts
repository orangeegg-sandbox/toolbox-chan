import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./src",
  testMatch: "**/tests/*.e2e.ts",
  timeout: 120_000,
  expect: { timeout: 90_000 },
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:1420",
    channel: process.platform === "win32" ? "msedge" : undefined,
    headless: true,
    viewport: { width: 1280, height: 960 },
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:1420",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
