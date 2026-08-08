import { test, expect } from '@playwright/test'
import { closeCurrentSession, createSession, openApp, openPalette, sendMessage } from './helpers.ts'

// §2.3 / §3.4 — in-conversation search.
test.describe('search', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page)
    await createSession(page)
  })

  test.afterEach(async ({ page }) => {
    await closeCurrentSession(page)
  })

  async function openSearch(page: import('@playwright/test').Page): Promise<void> {
    await openPalette(page)
    await page
      .getByRole('dialog', { name: 'Command palette' })
      .getByText('Search conversation')
      .click()
    await expect(page.getByRole('searchbox', { name: 'Search conversation' })).toBeVisible()
  }

  test('B1+B2+B4: counter, navigation, and empty term', async ({ page }) => {
    await sendMessage(page, 'apple pie is my favorite')
    await sendMessage(page, 'banana smoothies')
    await sendMessage(page, 'apple tart is nice')

    await openSearch(page)
    const input = page.getByRole('searchbox', { name: 'Search conversation' })
    const count = page.getByRole('status').filter({ hasText: '/' })

    // Matching term: a "first/total" counter that is not zero.
    await input.fill('apple')
    await expect(count).toHaveText(/^1\/\d+$/)

    // Next/Previous move the match; navigation is circular (always a valid index).
    const before = await count.innerText()
    await page.getByRole('button', { name: 'Next match' }).click()
    await expect(count).not.toHaveText(before)
    await expect(count).toHaveText(/^\d+\/\d+$/)

    // No match.
    await input.fill('zzz-no-such-term')
    await expect(count).toHaveText('0/0')
  })

  test('B5: matching is case-insensitive', async ({ page }) => {
    await sendMessage(page, 'The capital of France is Paris.')
    await openSearch(page)
    const input = page.getByRole('searchbox', { name: 'Search conversation' })
    const count = page.getByRole('status').filter({ hasText: '/' })
    await input.fill('paris')
    await expect(count).toHaveText('1/1')
  })
})
