import { defineConfig, devices } from '@playwright/test'

// E2E runs against the real dev stack (Vite frontend proxying /api to the
// backend). Offline mode keeps Pi from spending tokens while still allowing
// session creation, fork points, search, and export (see spec §2.0).
// Keep E2E isolated from the user's live dev stack. Dedicated defaults avoid
// false positives where Playwright silently talks to an orphan on 43120/43121.
const vitePort = process.env.PI_LIVECRAFT_E2E_VITE_PORT ?? '45173'
const backendPort = process.env.PI_LIVECRAFT_E2E_BACKEND_PORT ?? '45121'
const managerPort = process.env.PI_LIVECRAFT_E2E_MANAGER_PORT ?? '45120'
const baseURL = `http://127.0.0.1:${vitePort}`

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  // Real Pi startup can exceed Playwright's 30s default on a cold CI runner.
  timeout: 120_000,
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
      PI_LIVECRAFT_VITE_PORT: vitePort,
      PI_LIVECRAFT_BACKEND_PORT: backendPort,
      PI_LIVECRAFT_MANAGER_PORT: managerPort,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
