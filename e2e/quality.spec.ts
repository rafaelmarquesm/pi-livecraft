import { test, expect, type Page } from '@playwright/test'
import { closeCurrentSession, openSeededSession } from './helpers.ts'
import { awaitingPlanDetails, executingPlanDetails, standardDetails } from './quality-fixtures.ts'

async function installQualityRoutes(page: Page) {
  let details = standardDetails
  const commands: unknown[] = []
  await page.route('**/api/sessions/*/validated-work**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: details, headers: { ETag: 'W/"quality-fixture"' } })
      return
    }
    const body = route.request().postDataJSON() as { action?: string; mode?: string }
    if (body.action === 'approve') details = executingPlanDetails()
    else if (body.mode === 'standard') details = standardDetails
    else details = awaitingPlanDetails()
    await route.fulfill({ json: details, headers: { ETag: 'W/"quality-fixture-next"' } })
  })
  await page.route('**/api/sessions/*/commands', async (route) => {
    commands.push(route.request().postDataJSON())
    await route.fulfill({ json: { success: true } })
  })
  return { commands, getDetails: () => details }
}

async function choosePlanFirst(page: Page): Promise<void> {
  await page.getByRole('combobox', { name: /Quality mode: Standard/ }).click()
  await page.getByRole('option', { name: /^Plan first/ }).click()
  await expect(page.getByRole('heading', { name: 'Enable experimental quality mode?' }))
    .toBeVisible()
  await page.getByRole('button', { name: 'Enable plan-first mode' }).click()
}

test.describe('quality plan-first workflow', () => {
  test.afterEach(async ({ page }) => {
    await closeCurrentSession(page)
  })

  test('shows mode warning, quality panel, and approves the plan', async ({ page }) => {
    await installQualityRoutes(page)
    await openSeededSession(page, ['quality plan approval fixture'])

    await choosePlanFirst(page)
    await expect(page.getByRole('dialog', { name: /Approve plan before execution/ })).toBeVisible()
    await expect(page.getByText('Add plan-first approval before execution.')).toBeVisible()
    await page.getByRole('button', { name: 'Approve and execute' }).click()
    await expect(page.getByRole('dialog', { name: /Approve plan before execution/ })).toBeHidden()

    await expect(page.getByRole('complementary', { name: 'Workspace tools' })).toContainText(
      'Executing',
    )
  })

  test('sends request changes as a real prompt and leaves planning read-only', async ({ page }) => {
    const quality = await installQualityRoutes(page)
    await openSeededSession(page, ['quality request changes fixture'])

    await choosePlanFirst(page)
    await page.getByRole('textbox', { name: 'Plan change request' }).fill(
      'Split the plan into smaller slices.',
    )
    await page.getByRole('button', { name: 'Request changes', exact: true }).click()

    await expect.poll(() => quality.commands.length).toBe(1)
    expect(quality.commands[0]).toMatchObject({
      type: 'prompt',
      message: 'Split the plan into smaller slices.',
    })
  })

  test('cancels back to standard mode at narrow width with keyboard reachable controls', async ({ page }) => {
    const quality = await installQualityRoutes(page)
    await page.setViewportSize({ width: 320, height: 720 })
    await openSeededSession(page, ['quality cancel fixture'])

    await choosePlanFirst(page)
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: 'Cancel mode' })).toBeVisible()
    await page.getByRole('button', { name: 'Cancel mode' }).click()

    await expect.poll(() => quality.getDetails().summary).toBeNull()
    await expect(page.getByRole('dialog', { name: /Approve plan before execution/ })).toBeHidden()
  })
})
