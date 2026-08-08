import { defineConfig, devices } from '@playwright/test'

// E2E runs against the real dev stack (Vite frontend proxying /api to the
// backend). Offline mode keeps Pi from spending tokens while still allowing
// session creation, fork points, search, and export (see spec §2.0).
const vitePort = process.env.PI_LIVECRAFT_VITE_PORT ?? '5173'
const baseURL = `http://127.0.0.1:${vitePort}`

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run dev',
    // Wait on the backend health route through the Vite proxy so we know both
    // the frontend and the backend are up before the first test.
    url: `${baseURL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      ...process.env,
      PI_OFFLINE: '1',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
