import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: ['**/autopilot.spec.mjs', '**/main.spec.mjs', '**/contact2.spec.mjs', '**/contact3.spec.mjs', '**/calls.spec.mjs'],
  timeout: 120_000,
  expect: { timeout: 7_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [['line'], ['html', { outputFolder: 'artifacts/html', open: 'never' }]],
  use: {
    baseURL: process.env.PRIME_URL || 'https://prime-online-v01.vercel.app/',
    channel: 'chrome',
    launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 8_000,
    navigationTimeout: 20_000
  },
  projects: [
    { name: 'iphone-15-pro', use: { browserName: 'chromium', viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } },
    { name: 'compact-iphone', use: { browserName: 'chromium', viewport: { width: 375, height: 667 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } }
  ]
});
