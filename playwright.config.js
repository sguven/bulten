import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}/`,
    locale: 'tr-TR',
    timezoneId: 'America/New_York',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'masaustu', use: { ...devices['Desktop Chrome'] } },
    { name: 'telefon', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: `node tests/e2e/build-site.mjs && python3 -m http.server ${PORT} --bind 127.0.0.1 --directory tests/.site`,
    url: `http://127.0.0.1:${PORT}/index.html`,
    reuseExistingServer: false,
  },
});
