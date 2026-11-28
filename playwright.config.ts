import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:4199",
    channel: "chromium",
    viewport: { width: 1920, height: 1080 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run build && npm start",
    url: "http://127.0.0.1:4199/api/programme",
    env: { PORT: "4199", DEMO_DB: ":memory:", START_IN_DEMO: "1" },
    reuseExistingServer: false,
  },
});
