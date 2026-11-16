import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests: they drive the real page in a browser.
 * Run with `npm run build && npm run e2e`. SOAK_HANDS sets how many hands the soak test plays.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 40 * 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173/',
    trace: 'off',
    ...devices['Desktop Chrome'],
    viewport: { width: 1366, height: 820 },
    acceptDownloads: true,
  },
  webServer: {
    command: 'npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173/',
    reuseExistingServer: true,
  },
});
