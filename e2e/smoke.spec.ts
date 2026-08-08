import { test, expect } from '@playwright/test'
import { closeCurrentSession, composer, createSession, openApp } from './helpers.ts'

// §3.1 — smoke: the app boots against the real stack, a session can be
// created, and the composer is reachable by keyboard.
test.describe('smoke', () => {
  test.afterEach(async ({ page }) => {
    await closeCurrentSession(page)
  })

  test('opens the app, creates a session, and focuses the composer', async ({ page }) => {
    await openApp(page)

    // The workspace sidebar and a create entry point are present.
    await expect(page.getByRole('button', { name: /new session/i })).toBeVisible()

    await createSession(page)

    // Composer is visible and accept keyboard input.
    const box = composer(page)
    await expect(box).toBeVisible()
    await box.fill('hello')
    await expect(box).toHaveValue('hello')
  })

  test('focus-composer shortcut (alt+2) moves focus into the composer', async ({ page }) => {
    await openApp(page)
    await createSession(page)

    await page.keyboard.press('Alt+2')
    // The composer textarea is the active element after the shortcut.
    await expect
      .poll(() =>
        page.evaluate(() => {
          const el = document.activeElement as HTMLTextAreaElement | null
          return el?.getAttribute('aria-label') ?? null
        })
      )
      .toBe('Message')
  })
})
