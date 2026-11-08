import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  outputDir: "./docs/test-results",
  reporter: [
    ["list"],
    ["html", { outputFolder: "docs/playwright-report", open: "never" }],
  ],
  workers: 1,
  use: { baseURL: "http://127.0.0.1:8001" },
  webServer: {
    command: "python -m http.server 8001 --bind 127.0.0.1 --directory out",
    url: "http://127.0.0.1:8001",
    reuseExistingServer: true,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
