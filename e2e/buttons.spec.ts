import { test, expect } from '@playwright/test'
import { closeCurrentSession, createSession, openApp, openPalette } from './helpers.ts'

/**
 * Semantic button/affordance audit. This is intentionally behavior-driven
 * (no screenshot diff): the controls that expose the newly shipped features
 * must be reachable through their accessible names and command palette.
 */
test.describe('primary controls', () => {
  test.afterEach(async ({ page }) => {
    await closeCurrentSession(page)
  })

  test('composer controls and an authenticated OpenAI model are visible', async ({ page }) => {
    await openApp(page)
    await createSession(page)

    // Radix select triggers expose the combobox role. Agent is deliberately
    // not required here: that control is conditional on loaded agent extensions.
    await expect(page.getByRole('combobox', { name: 'Model' })).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Thinking level' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible()

    // Read the model label from the real snapshot so the assertion remains
    // stable if Pi changes display names while retaining provider/id.
    const sessionId = await page.evaluate(() =>
      window.localStorage.getItem('pi-livecraft.selected-session')
    )
    expect(sessionId).toBeTruthy()
    const snapshot = await page
      .request
      .get(`/api/sessions/${sessionId}/snapshot`)
      .then((response) => response.json())
    const openAiModel = (snapshot.models as Array<Record<string, unknown>>).find((model) =>
      model.provider === 'openai-codex' && model.id === 'gpt-5.4'
    )
    expect(openAiModel).toBeTruthy()

    await page.getByRole('combobox', { name: 'Model' }).click()
    await expect(page.getByRole('option', {
      name: String(openAiModel?.name ?? openAiModel?.id),
      exact: true,
    }))
      .toBeVisible()
    await page.keyboard.press('Escape')
  })

  test('palette exposes export, search, clone, settings and Usage controls', async ({ page }) => {
    await openApp(page)
    await createSession(page)
    await openPalette(page)

    const palette = page.getByRole('dialog', { name: 'Command palette' })
    for (
      const label of [
        'Export session',
        'Search conversation',
        'Clone session',
        'Open settings',
        'Open agent picker',
        'Open Usage',
      ]
    ) await expect(palette.getByText(label, { exact: true })).toBeVisible()

    await palette.getByText('Open Usage', { exact: true }).click()
    await expect(page.getByRole('complementary', { name: 'Workspace tools' })).toContainText(
      'Usage',
    )
    await expect(page.getByRole('button', { name: 'Refresh usage' })).toBeVisible()
  })
})
