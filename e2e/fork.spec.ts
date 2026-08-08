import { test, expect } from '@playwright/test'
import { closeCurrentSession, createSession, openApp, sendMessage } from './helpers.ts'

// §2.2 — Fork (Fase 3). The capability gate is exercised separately in
// capability-gates.spec.ts; here we verify the fork affordance is reachable.
test.describe('fork', () => {
  test.afterEach(async ({ page }) => {
    await closeCurrentSession(page)
  })

  test('F1: Fork from here is visible on a settled user message', async ({ page }) => {
    await openApp(page)
    await createSession(page)
    await sendMessage(page, 'List the numbers one two three.')

    const userMessage = page.locator('article.message.user', { hasText: 'List the numbers' })
    await expect(userMessage).toBeVisible()

    // The fork button is a hover/action affordance on the message card.
    const forkButton = userMessage.getByRole('button', { name: 'Fork from here' })
    await forkButton.hover()
    await expect(forkButton).toBeVisible()
  })

  test('F2: forking an idle session rewrites the branch', async ({ page }) => {
    await openApp(page)
    await createSession(page)
    await sendMessage(page, 'Say hello.')
    await sendMessage(page, 'Say goodbye.')

    const firstMessage = page.locator('article.message.user', { hasText: 'Say hello' })
    await firstMessage.hover()
    await firstMessage.getByRole('button', { name: 'Fork from here' }).click()

    // Fork triggers a session reassignment; the UI remains usable and the
    // forked (first) message stays visible.
    await expect(firstMessage).toBeVisible()
  })
})
