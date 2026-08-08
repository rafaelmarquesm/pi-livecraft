import { test, expect } from '@playwright/test'
import { closeCurrentSession, createSession, openApp, sendMessage } from './helpers.ts'

// §3.5 — the P1 regression: the fork button is gated on the snapshot reporting
// the `fork` capability. The original incident shipped the gate so the button
// was invisible. With a real Pi 0.84.1 the capability probe reports it present;
// when the snapshot reports no fork command, the button must disappear.
test.describe('capability-gates', () => {
  test.afterEach(async ({ page }) => {
    await closeCurrentSession(page)
  })

  test('fork button is visible when the snapshot reports the fork capability', async ({ page }) => {
    await openApp(page)
    await createSession(page)
    await sendMessage(page, 'List the numbers one two three.')

    const userMessage = page.locator('article.message.user', {
      hasText: 'List the numbers',
    })
    await expect(userMessage).toBeVisible()
    await userMessage.hover()
    await expect(userMessage.getByRole('button', { name: 'Fork from here' })).toBeVisible()
  })

  test('fork button is absent when the snapshot reports no fork capability', async ({ page }) => {
    // Strip the fork capability from every snapshot served to the app. The
    // gate should fail closed and hide the fork affordance.
    await page.route('**/api/sessions/*/snapshot', async (route) => {
      const response = await route.fetch()
      const body = await response.json()
      body.capabilities = { version: '0.84.1', commands: {} }
      await route.fulfill({ response, json: body })
    })

    await openApp(page)
    await createSession(page)
    await sendMessage(page, 'Say hello world.')

    const userMessage = page.locator('article.message.user', { hasText: 'Say hello world' })
    await expect(userMessage).toBeVisible()
    await userMessage.hover()
    await expect(userMessage.getByRole('button', { name: 'Fork from here' })).not.toBeVisible()
  })
})
