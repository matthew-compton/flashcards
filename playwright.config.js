import { defineConfig, devices } from '@playwright/test';

const baseURL = 'http://127.0.0.1:' + (process.env.FLASHCARDS_TEST_PORT ?? '8799');
const chromiumOptions = process.env.FLASHCARDS_TEST_CHROME ? { executablePath: process.env.FLASHCARDS_TEST_CHROME } : {};
export default defineConfig({
  testDir: './tests/browser',
  globalSetup: './tests/browser/server.mjs',
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL,
    trace: 'retain-on-failure'
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], launchOptions: chromiumOptions } },
    { name: 'phone', use: { ...devices['Pixel 7'], launchOptions: chromiumOptions } },
    ...(process.env.FLASHCARDS_TEST_WEBKIT ? [{ name: 'ios-layout', use: { ...devices['iPhone 13'] } }] : [])
  ]
});
