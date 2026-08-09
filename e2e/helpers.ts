import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { expect, type Page } from '@playwright/test'

/**
 * Shared helpers for the Livecraft E2E suite. Tests run against the real dev
 * stack in `PI_OFFLINE=1` (see spec §2.0): sessions create, user messages
 * persist locally, and the assistant replies with an offline error. That is
 * enough to exercise fork points, search, tree, export, and the ledger.
 */

/** Absolute/canonical workspace used by both UI filtering and the backend.
 * macOS resolves `/tmp` to `/private/tmp`; keeping the symlink spelling would
 * make an opened session disappear from the current workspace. */
const configuredWorkspace = process.env.PI_LIVECRAFT_E2E_WORKSPACE
  ?? '/tmp/pi-livecraft-e2e-workspace'
export const WORKSPACE = existsSync(configuredWorkspace)
  ? realpathSync(configuredWorkspace)
  : join(realpathSync(dirname(configuredWorkspace)), basename(configuredWorkspace))

/** Seeds a fresh workspace and clears the restored selection before load. */
export async function openApp(page: Page, workspace = WORKSPACE): Promise<void> {
  await page.addInitScript((ws) => {
    window.localStorage.setItem('pi-livecraft.workspace-path', ws)
    window.localStorage.removeItem('pi-livecraft.selected-session')
    window.localStorage.removeItem('pi-livecraft.right-sidebar-widget')
  }, workspace)
  await page.goto('/')
  await expect(page.getByRole('main').first()).toBeVisible({ timeout: 15_000 })
}

/**
 * Opens a fully valid persisted Pi session without invoking an LLM. This is
 * the deterministic fixture for fork/search/export: pi@latest may reject an
 * offline prompt before persisting the user message on clean CI runners.
 */
export async function openSeededSession(page: Page, userMessages: string[]): Promise<string> {
  const cwd = WORKSPACE
  const sessionId = randomUUID()
  const directory = join(homedir(), '.pi', 'agent', 'sessions', 'pi-livecraft-e2e')
  mkdirSync(directory, { recursive: true })
  const sessionPath = join(directory, `${Date.now()}_${sessionId}.jsonl`)
  const now = Date.now()
  const lines: string[] = [JSON.stringify({
    type: 'session',
    version: 3,
    id: sessionId,
    timestamp: new Date(now).toISOString(),
    cwd,
  })]
  let parentId: string | null = null
  let entry = 0
  const append = (message: Record<string, unknown>): void => {
    const id = entry.toString(16).padStart(8, '0')
    lines.push(JSON.stringify({
      type: 'message',
      id,
      parentId,
      timestamp: new Date(now + entry).toISOString(),
      message,
    }))
    parentId = id
    entry += 1
  }
  userMessages.forEach((text, index) => {
    append({ role: 'user', content: [{ type: 'text', text }], timestamp: now + entry })
    append({
      role: 'assistant',
      content: [{ type: 'text', text: `Seeded response ${index + 1}.` }],
      api: 'openai-completions',
      provider: 'bench',
      model: 'bench-model',
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: 'stop',
      timestamp: now + entry,
    })
  })
  writeFileSync(sessionPath, `${lines.join('\n')}\n`)

  const response = await page.request.post('/api/sessions', {
    data: { cwd, sessionPath },
  })
  expect(response.ok(), await response.text()).toBe(true)
  const summary = await response.json() as { id: string }
  await page.addInitScript((workspace) => {
    window.localStorage.setItem('pi-livecraft.workspace-path', workspace)
    window.localStorage.removeItem('pi-livecraft.selected-session')
    window.localStorage.removeItem('pi-livecraft.right-sidebar-widget')
  }, cwd)
  await page.goto('/')
  await expect(page.getByRole('main').first()).toBeVisible({ timeout: 15_000 })

  // Select exactly the seeded session through the same sidebar affordance a
  // user uses. useWorkspaceSessions intentionally owns auto-selection and
  // does not initialize its state from the selected-session localStorage key.
  const row = page
    .getByRole('navigation', { name: 'Recent Pi sessions' })
    .getByRole('button')
    .filter({ hasText: userMessages[0] })
    .first()
  await expect(row).toBeVisible({ timeout: 30_000 })
  await row.click()
  await composer(page).waitFor({ state: 'visible', timeout: 120_000 })
  await expect(page.getByText('Connecting to Pi…')).toBeHidden({ timeout: 120_000 })
  await expect
    .poll(() => page.evaluate(() => window.localStorage.getItem('pi-livecraft.selected-session')))
    .not
    .toBeNull()
  return summary.id
}

/** The composer textarea (aria-label `Message`). Exact to avoid the Git commit-message input. */
export function composer(page: Page) {
  return page.getByRole('textbox', { name: 'Message', exact: true })
}

/**
 * Creates a new Pi session from the sidebar and waits for the composer to
 * appear. Returns the session name text as rendered in the sidebar.
 */
export async function createSession(page: Page, timeout = 120_000): Promise<string> {
  await page.getByRole('button', { name: /new session/i }).click()
  await composer(page).waitFor({ state: 'visible', timeout })
  // Wait for the loading overlay to finish so the snapshot (and thus messages)
  // is ready before a test sends a prompt.
  await expect(page.getByText('Connecting to Pi…')).toBeHidden({ timeout })
  await expect(composer(page)).toBeEnabled({ timeout })
  return 'created'
}

/** Dismisses any blocking modal (e.g. a leftover ask-user-question) so the next step can proceed. */
export async function dismissBlockingDialog(page: Page): Promise<void> {
  const open = page.locator(
    '.ask-user-question-backdrop, .modal-backdrop, .command-palette-backdrop',
  )
  if (!(await open.count())) return
  const cancel = page.getByRole('button', { name: 'Cancel', exact: true }).first()
  if (await cancel.count()) await cancel.click().catch(() => undefined)
  else await page.keyboard.press('Escape').catch(() => undefined)
}

/** Sends a message through the composer, dismissing any blocking dialog that appears mid-send. */
export async function sendMessage(page: Page, text: string): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await dismissBlockingDialog(page)
    try {
      const box = composer(page)
      await box.click({ timeout: 3_000 })
      await box.fill(text)
      await page.getByRole('button', { name: 'Send message' }).click({ timeout: 3_000 })
      return
    } catch {
      // A leftover dialog intercepted an interaction; dismiss and retry.
    }
  }
  throw new Error(`Failed to send message: ${text}`)
}

/** Closes the currently selected session so later tests are not blocked by its live events. */
export async function closeCurrentSession(page: Page): Promise<void> {
  const sessionId = await page.evaluate(() =>
    window.localStorage.getItem('pi-livecraft.selected-session')
  )
  if (!sessionId) return
  await page.request.post(`/api/sessions/${sessionId}/close`, { data: {} }).catch(() => undefined)
}

/**
 * Waits for the selected session's JSONL file to appear on disk. The JSONL
 * export reads the on-disk file, which Pi flushes a moment after the turn
 * starts; exporting before it exists yields ENOENT (spec §2.1 E4).
 */
export async function waitForSessionPersisted(page: Page, timeout = 20_000): Promise<void> {
  const sessionId = await page.evaluate(() =>
    window.localStorage.getItem('pi-livecraft.selected-session')
  )
  if (!sessionId) return
  const sessions = await page.request.get('/api/sessions').then((res) => res.json())
  const session = (Array.isArray(sessions) ? sessions : []).find((s) => s.id === sessionId)
  const sessionPath = (session as { sessionPath?: string } | undefined)?.sessionPath
  if (!sessionPath) return
  const { existsSync } = await import('node:fs')
  const start = Date.now()
  while (!existsSync(sessionPath)) {
    if (Date.now() - start > timeout) throw new Error('Session was not persisted to disk')
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

/** Opens the command palette and returns its search input. */
export async function openPalette(page: Page): Promise<void> {
  await dismissBlockingDialog(page)
  await page.keyboard.press('Alt+k')
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible()
}

/** Opens the export dialog via the command palette. */
export async function openExportDialog(page: Page): Promise<void> {
  await openPalette(page)
  await page.getByRole('dialog', { name: 'Command palette' }).getByText('Export session').click()
  await expect(page.getByRole('heading', { name: 'Export session' })).toBeVisible()
}
