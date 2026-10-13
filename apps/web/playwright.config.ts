import { defineConfig } from '@playwright/test'

/**
 * Browser layout checks (`npm run e2e`) — not snapshot tests. Two engines: WebKit (the
 * engine iOS Safari uses) and the installed Chrome. They start their own dev server on a
 * port of their own, so a running `npm run dev` is never touched.
 *
 * First run on a machine: `npx playwright install webkit`.
 */
const PORT = 5199

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: 'list',
  use: { baseURL: `http://127.0.0.1:${PORT}` },
  projects: [
    { name: 'webkit', use: { browserName: 'webkit', isMobile: true, hasTouch: true, deviceScaleFactor: 3 } },
    { name: 'chrome', use: { browserName: 'chromium', channel: 'chrome', isMobile: true, hasTouch: true, deviceScaleFactor: 3 } },
  ],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
  },
})
