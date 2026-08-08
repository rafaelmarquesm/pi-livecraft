import { writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from '@playwright/test'
import { WORKSPACE, openApp } from './helpers.ts'

// §3.7 — the Git discard ConfirmDialog: ESC cancels and the safe (Cancel)
// button receives initial focus for a destructive confirmation.
test.describe('dialogs', () => {
  test('Git discard shows a ConfirmDialog with Cancel focused; ESC cancels without discarding', async ({ page }) => {
    const dirtyFile = join(WORKSPACE, 'dirty.txt')
    writeFileSync(dirtyFile, 'uncommitted\n')

    try {
      await openApp(page)

      // Open the Git widget and request a discard of the dirty file.
      await page.keyboard.press('Alt+g')
      await page
        .getByRole('button', { name: /discard changes to dirty\.txt/i })
        .click()

      const confirm = page.getByRole('alertdialog')
      await expect(confirm).toBeVisible()
      await expect(confirm).toContainText('Discard')

      // The safe action is the default focus.
      await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused()

      // ESC resolves as cancel and closes the dialog.
      await page.keyboard.press('Escape')
      await expect(confirm).not.toBeVisible()
    } finally {
      rmSync(dirtyFile, { force: true })
    }
  })
})
