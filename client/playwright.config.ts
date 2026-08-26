// P10-BR2 — Playwright configuration for the bounded real-browser venue.
//
// Orchestration only. It starts and stops processes and points a real browser
// at the production client; it decides nothing about the application, supplies
// no expected value, and intercepts no request.
//
// `channel: 'chrome'` drives the Google Chrome already installed on the host.
// No Playwright-managed browser is downloaded or used: none was authorized, and
// none is present.
//
// The spec lives in `client/browser/` and is named `*.browser.ts` rather than
// `*.spec.ts` so that Vitest's default discovery cannot collect it. That keeps
// the browser venue out of the mounted-test tree WITHOUT editing the committed
// Vite/Vitest configuration, which is outside this gate's ceiling.
import { defineConfig } from '@playwright/test';
import { CLIENT_ORIGIN } from './browser/apparatus.ts';

export default defineConfig({
  testDir: './browser',
  testMatch: /.*\.browser\.ts$/,
  // One worker, and no parallelism: the venue owns one database, one server,
  // and one client, and nothing about the observation benefits from racing it.
  workers: 1,
  fullyParallel: false,
  // A real browser journey against a real server is slower than a mounted one;
  // these are ceilings, not expectations, and nothing waits on a fixed delay.
  timeout: 120_000,
  expect: { timeout: 15_000 },
  // Never silently re-run: a retry would obscure which observation actually
  // occurred, and one execution is what the chamber authorizes.
  retries: 0,
  forbidOnly: true,
  // The setup returns its own teardown, so processes are stopped by the same
  // module that started them.
  globalSetup: './browser/apparatus.ts',
  use: {
    baseURL: CLIENT_ORIGIN,
    // The real browser network stack. No route interception, no request
    // fulfilment, no offline emulation, no service-worker substitution.
    serviceWorkers: 'block',
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
  projects: [
    {
      name: 'chrome',
      use: { browserName: 'chromium', channel: 'chrome' },
    },
  ],
});
