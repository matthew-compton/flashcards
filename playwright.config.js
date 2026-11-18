import { defineConfig, devices } from '@playwright/test';

const baseURL = 'http://127.0.0.1:' + (process.env.FLASHCARDS_TEST_PORT ?? '8799');
export default defineConfig({
  testDir: './tests/browser',
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL,
    trace: 'retain-on-failure',
    launchOptions: process.env.FLASHCARDS_TEST_CHROME ? { executablePath: process.env.FLASHCARDS_TEST_CHROME } : {}
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
    ...(process.env.FLASHCARDS_TEST_WEBKIT ? [{ name: 'ios-layout', use: { ...devices['iPhone 13'] } }] : [])
  ],
  webServer: {
    command: 'node tests/browser/server.mjs',
    url: baseURL + '/flashcards/',
    reuseExistingServer: false
  }
});
