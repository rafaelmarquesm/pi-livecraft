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
    // CI has no personal provider credentials. Inject deterministic model and
    // thinking state at the HTTP boundary: this tests UI reconciliation while
    // the cache/command contract is covered by focused backend unit tests.
    let thinkingLevel = 'off'
    await page.route('**/api/sessions/*/commands', async (route) => {
      const command = route.request().postDataJSON()
      if (command?.type !== 'set_thinking_level') {
        await route.continue()
        return
      }
      thinkingLevel = String(command.level)
      await route.fulfill({ json: { success: true, data: {} } })
    })
    await page.route('**/api/sessions/*/snapshot', async (route) => {
      const response = await route.fetch()
      const body = await response.json()
      body.state = { ...(body.state ?? {}), thinkingLevel }
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

    // Preference commands must reconcile get_state immediately; previously
    // the warm snapshot cache updated only after the next prompt settled.
    const thinking = page.getByRole('combobox', { name: 'Thinking level' })
    const target = (await thinking.textContent())?.includes('Max') ? 'Low' : 'Max'
    await thinking.click()
    await page.getByRole('option', { name: target, exact: true }).click()
    await expect(thinking).toContainText(target)
  })

  test('quota and usage rail buttons expose balances and inference metrics', async ({ page }) => {
    await page.route('**/api/quotas', async (route) => {
      await route.fulfill({
        json: {
          openai: { data: [], stale: false },
          copilot: { data: [], stale: false },
          deepseek: {
            data: [{
              currency: 'USD',
              total: 12.3456,
              granted: 2.5,
              toppedUp: 9.8456,
              usable: true,
            }],
            stale: false,
          },
          moonshot: {
            data: [{ currency: 'USD', total: 49.58894, cash: 3.00001, voucher: 46.58893 }],
            stale: false,
          },
          moonshotCn: { data: [], stale: false },
          refreshing: false,
          sessionRequired: false,
        },
      })
    })
    await page.route('**/api/usage**', async (route) => {
      await route.fulfill({
        json: {
          cwd: '/tmp/pi-livecraft-e2e-workspace',
          totals: {
            cost: 0.5,
            totalTokens: 2_000,
            records: 2,
            cacheHitRate: 0.34,
            costPer1kOutput: 1.2,
            inputOutputRatio: 4,
            tokensPerSecond: 12.4,
          },
          byDay: [],
          byProvider: [{
            provider: 'deepseek',
            cost: 0.3,
            totalTokens: 1_200,
            records: 1,
            cacheHitRate: 0.5,
          }],
          byModel: [],
        },
      })
    })
    await openApp(page)
    await createSession(page)

    const tools = page.getByRole('complementary', { name: 'Workspace tools' })
    await tools.getByRole('button', { name: /^Expand quota panel/ }).click()
    await expect(tools.getByText('Quotas', { exact: true })).toBeVisible()
    await expect(tools.getByRole('region', { name: 'DeepSeek' })).toContainText('granted')
    await expect(tools.getByRole('region', { name: 'Moonshot AI' })).toContainText('voucher')

    // The percent rail is provider capacity, not token/cost history. Its panel
    // now points users directly to the otherwise easy-to-confuse dollar rail.
    await tools.getByRole('button', { name: /Usage & inference metrics/ }).click()
    const metrics = tools.getByLabel('Inference metrics')
    await expect(metrics).toContainText('cache 34%')
    await expect(metrics).toContainText('$1.20/1k out')
    await expect(metrics).toContainText('4:1 in:out')
    await expect(metrics).toContainText('12 tok/s')
    const providers = tools.getByRole('region', { name: 'Usage by provider' })
    await expect(providers).toContainText('deepseek')
    await expect(providers).toContainText('cache 50%')

    // Exercise the dollar rail itself, including collapse and direct reopen.
    await tools.getByRole('button', { name: 'Collapse usage panel' }).click()
    await tools.getByRole('button', { name: 'Expand usage panel' }).click()
    await expect(tools.getByLabel('Inference metrics')).toBeVisible()
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
