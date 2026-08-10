import { expect, test } from '@playwright/test'
import { openApp } from './helpers.ts'

test('Quality settings tab falls back from malformed storage and persists explicit choices', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('pi-livecraft.quality.default-mode', 'turbo')
    window.localStorage.setItem('pi-livecraft.quality.max-followups', '10')
    window.localStorage.setItem('pi-livecraft.quality.attributed-budget-usd', 'NaN')
    window.localStorage.setItem('pi-livecraft.quality.auto-review', 'maybe')
    window.localStorage.setItem('pi-livecraft.quality.reviewer-model', '   ')
    window.localStorage.setItem('pi-livecraft.quality.reviewer-thinking', 'extreme')
    window.localStorage.setItem('pi-livecraft.quality.auto-send', 'maybe')
    window.localStorage.setItem('pi-livecraft.quality.retain-reports', '???')
    window.localStorage.setItem('pi-livecraft.quality.first-use-acknowledged', 'yes')
  })
  await openApp(page)

  await page.keyboard.press('Alt+s')
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible()
  await page.getByRole('tab', { name: 'Quality' }).click()

  await expect(page.getByLabel('Default quality mode')).toHaveValue('standard')
  await expect(page.getByLabel('Max automatic follow-up turns')).toHaveValue('2')
  await expect(page.getByLabel('Attributed automation budget in USD')).toHaveValue('1')
  await expect(page.getByRole('switch', { name: 'Automatic independent review' })).not.toBeChecked()
  await expect(page.getByLabel('Reviewer model')).toHaveValue('inherit')
  await expect(page.getByLabel('Reviewer thinking')).toHaveValue('medium')
  await expect(page.getByRole('switch', { name: 'Auto-send high findings' })).not.toBeChecked()
  await expect(page.getByRole('switch', { name: 'Retain review reports' })).toBeChecked()

  await page.getByLabel('Default quality mode').selectOption('validated')
  await page.getByLabel('Max automatic follow-up turns').fill('4')
  await page.getByLabel('Attributed automation budget in USD').fill('12.5')
  await page.getByRole('switch', { name: 'Automatic independent review' }).check()
  await page.getByLabel('Reviewer model').fill('anthropic/claude-sonnet-4-20250514')
  await page.getByLabel('Reviewer thinking').selectOption('high')
  await page.getByRole('switch', { name: 'Auto-send high findings' }).check()
  await page.getByRole('switch', { name: 'Retain review reports' }).uncheck()
  await page.getByRole('button', { name: 'Reset acknowledgement' }).click()

  const stored = await page.evaluate(() => ({
    acknowledged: window.localStorage.getItem('pi-livecraft.quality.first-use-acknowledged'),
    attributedBudget: window.localStorage.getItem('pi-livecraft.quality.attributed-budget-usd'),
    autoReview: window.localStorage.getItem('pi-livecraft.quality.auto-review'),
    autoSend: window.localStorage.getItem('pi-livecraft.quality.auto-send'),
    defaultMode: window.localStorage.getItem('pi-livecraft.quality.default-mode'),
    maxFollowups: window.localStorage.getItem('pi-livecraft.quality.max-followups'),
    retainReports: window.localStorage.getItem('pi-livecraft.quality.retain-reports'),
    reviewerModel: window.localStorage.getItem('pi-livecraft.quality.reviewer-model'),
    reviewerThinking: window.localStorage.getItem('pi-livecraft.quality.reviewer-thinking'),
  }))

  expect(stored).toEqual({
    acknowledged: null,
    attributedBudget: '12.5',
    autoReview: 'true',
    autoSend: 'true',
    defaultMode: 'validated',
    maxFollowups: '4',
    retainReports: 'false',
    reviewerModel: 'anthropic/claude-sonnet-4-20250514',
    reviewerThinking: 'high',
  })
})
