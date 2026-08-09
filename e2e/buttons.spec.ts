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

  test('composer controls and an OpenAI model from the snapshot are visible', async ({ page }) => {
    // CI has no personal provider credentials. Inject one deterministic model
    // at the HTTP boundary: this tests the UI contract without depending on a
    // developer's auth.json. Live auth is covered by the API smoke outside CI.
    await page.route('**/api/sessions/*/snapshot', async (route) => {
      const response = await route.fetch()
      const body = await response.json()
      body.models = Array.isArray(body.models) ? body.models : []
      if (
        !body.models.some((model: { provider?: string; id?: string }) =>
          model.provider === 'openai-codex' && model.id === 'gpt-5.4'
        )
      ) body.models.push({ provider: 'openai-codex', id: 'gpt-5.4', name: 'GPT-5.4' })
      await route.fulfill({ response, json: body })
    })

    await openApp(page)
    await createSession(page)

    // Radix select triggers expose the combobox role. Agent is deliberately
    // not required here: that control is conditional on loaded agent extensions.
    await expect(page.getByRole('combobox', { name: 'Model' })).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Thinking level' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible()

    await page.getByRole('combobox', { name: 'Model' }).click()
    await expect(page.getByRole('option', { name: 'GPT-5.4', exact: true })).toBeVisible()
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
