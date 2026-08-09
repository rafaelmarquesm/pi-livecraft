import { test, expect } from '@playwright/test'
import { closeCurrentSession, openExportDialog, openSeededSession } from './helpers.ts'

// §2.1 — Export (Fase 1.1), E1–E4. Runs offline: the user message persists so
// the exported document has content.
test.describe('export', () => {
  test.beforeEach(async ({ page }) => {
    await openSeededSession(page, [
      'What is the speed of light?',
      'Name the color of a clear sky.',
      'Name a planet in our solar system.',
    ])
  })

  test.afterEach(async ({ page }) => {
    await closeCurrentSession(page)
  })

  test('E1: export dialog shows the three format buttons with HTML enabled', async ({ page }) => {
    await openExportDialog(page)
    const dialog = page.locator('.modal[role="dialog"]').filter({ hasText: 'Export session' })
    await expect(dialog.getByRole('button', { name: 'HTML' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'HTML' })).toBeEnabled()
    await expect(dialog.getByRole('button', { name: 'Markdown' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'JSONL' })).toBeVisible()
  })

  test('E2: Markdown download carries the User section and message text', async ({ page }) => {
    await openExportDialog(page)

    const dialog = page.locator('.modal[role="dialog"]').filter({ hasText: 'Export session' })
    const downloadPromise = page.waitForEvent('download')
    await dialog.getByRole('button', { name: 'Markdown' }).click()
    const download = await downloadPromise

    expect(download.suggestedFilename()).toMatch(/\.md$/i)
    const stream = await download.createReadStream()
    let body = ''
    for await (const chunk of stream) body += chunk
    expect(body).toContain('## User')
    expect(body).toContain('What is the speed of light?')
  })

  test('E4: JSONL download parses as one JSON object per line', async ({ page }) => {
    await openExportDialog(page)

    const dialog = page.locator('.modal[role="dialog"]').filter({ hasText: 'Export session' })
    const downloadPromise = page.waitForEvent('download')
    await dialog.getByRole('button', { name: 'JSONL' }).click()
    const download = await downloadPromise

    expect(download.suggestedFilename()).toMatch(/\.jsonl$/i)
    const stream = await download.createReadStream()
    let body = ''
    for await (const chunk of stream) body += chunk
    const lines = body.split('\n').filter(Boolean)
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow()
    }
  })
})
