import { test, expect, type Page } from '@playwright/test'
import { closeCurrentSession, openSeededSession } from './helpers.ts'
import {
  awaitingPlanDetails,
  budgetStoppedDetails,
  campaignDetailFixture,
  campaignListFixture,
  executingPlanDetails,
  standardDetails,
} from './quality-fixtures.ts'
import type { ValidatedWorkDetailsResponse } from '../shared/validated-work.ts'

type ReviewFixture = 'empty' | 'error' | 'findings' | 'loading'

async function installQualityRoutes(
  page: Page,
  options: {
    campaigns?: boolean
    initialDetails?: ValidatedWorkDetailsResponse
    review?: ReviewFixture
  } = {},
) {
  const includeCampaigns = options.campaigns ?? true
  const reviewFixture = options.review ?? 'findings'
  let details = options.initialDetails ?? standardDetails
  let reviewStatus = 'complete'
  const reviewDetails = () => ({
    revision: 1,
    status: reviewStatus,
    reports: [{
      protocol: 'pi-livecraft.code-review',
      version: 1,
      id: 'review-1',
      cycleId: 'cycle-1',
      model: 'fixture-model',
      provider: 'fixture-provider',
      thinking: 'low',
      diffHash: 'sha256:fixture',
      baseRevision: 1,
      createdAt: 1,
      completedAt: 2,
      durationMs: 1000,
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0.01,
      },
      truncation: { diff: false, files: false, findings: false, output: false },
      findings: [{
        id: 'f1',
        severity: 'P1',
        confidence: 'high',
        title: 'API accepts invalid review status',
        path: 'src/api.ts',
        line: 42,
        requirementIds: ['r1'],
        evidence: 'The fixture parser does not reject invalid decisions.',
        recommendation: 'Reject unknown decisions at the API boundary.',
        fingerprint: 'sha256:f1',
        status: reviewStatus === 'confirmed' ? 'confirmed' : 'open',
      }],
      validityStatus: 'valid',
    }],
  })
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
  await page.route('**/api/sessions/*/reviews/estimate', async (route) => {
    await route.fulfill({ json: { estimatedInputTokens: 480, diffHash: 'sha256:fixture' } })
  })
  await page.route('**/api/sessions/*/reviews/send', async (route) => {
    await route.fulfill({ json: { prompt: 'Review f1', details: reviewDetails() } })
  })
  await page.route('**/api/sessions/*/reviews/*/findings/*', async (route) => {
    reviewStatus = route.request().postDataJSON().status
    await route.fulfill({ json: reviewDetails() })
  })
  await page.route('**/api/sessions/*/reviews', async (route) => {
    if (reviewFixture === 'loading') return
    if (reviewFixture === 'error') {
      await route.fulfill({ status: 503, json: { error: 'Review fixture unavailable.' } })
      return
    }
    if (reviewFixture === 'empty') {
      await route.fulfill({ json: { revision: 1, status: 'never_run', reports: [] } })
      return
    }
    if (route.request().method() === 'POST') reviewStatus = 'complete'
    await route.fulfill({ json: reviewDetails() })
  })
  await page.route('**/api/quality/campaigns', async (route) => {
    await route.fulfill({ json: includeCampaigns ? campaignListFixture : { campaigns: [] } })
  })
  await page.route('**/api/quality/campaigns/*', async (route) => {
    await route.fulfill({ json: campaignDetailFixture })
  })
  return {
    commands,
    getDetails: () => details,
    getReviewDetails: reviewDetails,
    setDetails: (next: ValidatedWorkDetailsResponse) => {
      details = next
    },
  }
}

async function choosePlanFirst(page: Page): Promise<void> {
  await page.getByRole('combobox', { name: /Quality mode: Standard/ }).click()
  await page.getByRole('option', { name: /^Plan first/ }).click()
  await expect(page.getByRole('heading', { name: 'Enable experimental quality mode?' }))
    .toBeVisible()
  await page.getByRole('button', { name: 'Enable plan-first mode' }).click()
}

async function expandQualityPanel(page: Page): Promise<void> {
  const expand = page.getByRole('button', { name: 'Expand quality panel' })
  if (await expand.isVisible()) await expand.click()
  await expect(page.getByRole('button', { name: 'Collapse quality panel' })).toBeVisible()
}

test.describe('quality plan-first workflow', () => {
  let openedSessionIds: string[] = []

  test.beforeEach(() => {
    openedSessionIds = []
  })

  test.afterEach(async ({ page }) => {
    await closeCurrentSession(page)
    await Promise.all(
      openedSessionIds.map((sessionId) =>
        page.request.post(`/api/sessions/${sessionId}/close`, { data: {} }).catch(() => undefined)
      ),
    )
  })

  async function openQualitySession(page: Page, userMessages: string[]): Promise<string> {
    const sessionId = await openSeededSession(page, userMessages)
    openedSessionIds.push(sessionId)
    return sessionId
  }

  test('shows mode warning, quality panel, and approves the plan', async ({ page }) => {
    await installQualityRoutes(page)
    await openQualitySession(page, ['quality plan approval fixture'])

    await choosePlanFirst(page)
    await expect(page.getByRole('dialog', { name: /Approve plan before execution/ })).toBeVisible()
    await expect(page.getByText('Add plan-first approval before execution.', { exact: true }))
      .toBeVisible()
    await page.getByRole('button', { name: 'Approve and execute' }).click()
    await expect(page.getByRole('dialog', { name: /Approve plan before execution/ })).toBeHidden()

    await expect(page.getByRole('complementary', { name: 'Workspace tools' })).toContainText(
      'Executing',
    )
  })

  test('sends request changes as a real prompt and leaves planning read-only', async ({ page }) => {
    const quality = await installQualityRoutes(page)
    await openQualitySession(page, ['quality request changes fixture'])

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
    await openQualitySession(page, ['quality cancel fixture'])

    await choosePlanFirst(page)
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: 'Cancel mode' })).toBeVisible()
    await page.getByRole('button', { name: 'Cancel mode' }).click()

    await expect.poll(() => quality.getDetails().summary).toBeNull()
    await expect(page.getByRole('dialog', { name: /Approve plan before execution/ })).toBeHidden()
  })

  test('hides campaign tab when no artifact exists', async ({ page }) => {
    await installQualityRoutes(page, { campaigns: false })
    await openQualitySession(page, ['quality no campaign fixture'])

    await page.getByRole('button', { name: /Expand quality panel/ }).click()
    await expect(page.getByRole('tab', { name: /Campaigns/ })).toHaveCount(0)
  })

  test('shows campaign artifact metrics only when campaign artifacts exist', async ({ page }) => {
    await installQualityRoutes(page)
    await openQualitySession(page, ['quality campaign fixture'])

    await page.getByRole('button', { name: /Expand quality panel/ }).click()
    await expect(page.getByRole('tab', { name: /Campaigns/ })).toBeVisible()
    await page.getByRole('tab', { name: /Campaigns/ }).click()
    await expect(page.getByRole('heading', { name: 'Campaigns' })).toBeVisible()
    await expect(page.getByText('No winner: fewer than 3 valid trials per cell')).toBeVisible()
    await expect(page.getByText('livecraft-standard vs livecraft-validated')).toBeVisible()
    await expect(page.getByText('Wilson CI')).toBeVisible()
    await expect(page.getByText('Paired deltas by task/seed')).toBeVisible()
    await expect(page.getByText('Progress over time')).toBeVisible()
    await expect(page.getByText('settings_drift: 1')).toBeVisible()
  })

  test('triages review findings and confirms selected send preview', async ({ page }) => {
    await installQualityRoutes(page)
    await openQualitySession(page, ['quality review fixture'])

    await page.getByRole('button', { name: /Expand quality panel/ }).click()
    await expect(page.getByText('API accepts invalid review status')).toBeVisible()
    await page.getByRole('button', { name: 'Confirm' }).click()
    await expect(page.getByText('src/api.ts:42 · confirmed')).toBeVisible()
    await page.getByLabel('Select').check()
    await page.getByRole('button', { name: 'Send selected to agent' }).click()
    await expect(page.getByRole('dialog', { name: 'Confirm selected review findings' }))
      .toContainText(
        'Estimated prompt input',
      )
    await page.getByRole('button', { name: 'Confirm send selected' }).click()
  })

  test('navigates to seeded requirement, check, and evidence traceability', async ({ page }) => {
    await installQualityRoutes(page)
    await openQualitySession(page, ['quality traceability navigation fixture'])

    await choosePlanFirst(page)
    await page.getByRole('button', { name: 'Approve and execute' }).click()

    const tools = page.getByRole('complementary', { name: 'Workspace tools' })
    await expandQualityPanel(page)
    await expect(tools.getByRole('heading', { name: 'Traceability' })).toBeVisible()
    const requirement = tools.getByRole('row').filter({ hasText: 'r1' })
    await expect(requirement).toContainText('Add plan-first approval before execution.')
    await expect(requirement).toContainText('c1')
    await expect(requirement).toContainText('No linked evidence')
    await expect(tools.getByText('Playwright covers approve/request changes/cancel.')).toBeVisible()
  })

  test('shows the configured budget stop in the quality readiness panel', async ({ page }) => {
    await installQualityRoutes(page, { initialDetails: budgetStoppedDetails() })
    await openQualitySession(page, ['quality budget stop fixture'])

    const tools = page.getByRole('complementary', { name: 'Workspace tools' })
    await expandQualityPanel(page)
    await expect(tools.getByText('Budget stopped', { exact: true })).toBeVisible()
    await expect(tools.getByText('Stopped at the configured budget')).toBeVisible()
    await expect(tools.getByText('Stopped after reaching the configured automation budget.'))
      .toBeVisible()
  })

  test('shows review loading state while seeded review details are pending', async ({ page }) => {
    await installQualityRoutes(page, { review: 'loading' })
    await openQualitySession(page, ['quality review loading fixture'])

    await page.getByRole('button', { name: 'Expand quality panel' }).click()
    await expect(page.getByText('Loading review…')).toBeVisible()
    await expect(page.getByText('No findings recorded.')).toHaveCount(0)
  })

  test('shows a seeded review fetch error without provider access', async ({ page }) => {
    await installQualityRoutes(page, { review: 'error' })
    await openQualitySession(page, ['quality review error fixture'])

    await page.getByRole('button', { name: 'Expand quality panel' }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'Review fixture unavailable.' }))
      .toBeVisible()
  })

  test('shows the empty review state when no report or finding exists', async ({ page }) => {
    await installQualityRoutes(page, { review: 'empty' })
    await openQualitySession(page, ['quality review empty fixture'])

    await page.getByRole('button', { name: 'Expand quality panel' }).click()
    await expect(page.getByText('Status: never run')).toBeVisible()
    await expect(page.getByText('No findings recorded.')).toBeVisible()
  })

  test('attributes seeded usage by purpose without guessing provider cost', async ({ page }) => {
    await page.route('**/api/usage**', async (route) => {
      await route.fulfill({
        json: {
          cwd: '/tmp/pi-livecraft-e2e-workspace',
          totals: { cost: 0.06, records: 3, totalTokens: 600 },
          byDay: [],
          byProvider: [],
          byModel: [],
          byPurpose: [
            { purpose: 'main', cost: 0.01, records: 1, totalTokens: 100 },
            { purpose: 'automated_validation', cost: 0.02, records: 1, totalTokens: 200 },
            { purpose: 'code_review', cost: 0.03, records: 1, totalTokens: 300 },
          ],
        },
      })
    })
    await installQualityRoutes(page)
    await openQualitySession(page, ['quality usage purpose fixture'])

    const tools = page.getByRole('complementary', { name: 'Workspace tools' })
    await tools.getByRole('button', { name: 'Expand usage panel' }).click()
    const purposes = tools.getByRole('region', { name: 'Usage by purpose' })
    await expect(purposes).toContainText('Main session')
    await expect(purposes).toContainText('Automated validation')
    await expect(purposes).toContainText('Code review')
    await expect(purposes).toContainText('$0.03')
    await expect(purposes).toContainText('Attributed usage includes automated follow-ups')
  })

  test('keeps quality controls accessible at 768px and 200% zoom', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 900 })
    await installQualityRoutes(page)
    await openQualitySession(page, ['quality responsive accessibility fixture'])

    await choosePlanFirst(page)
    await page.getByRole('button', { name: 'Approve and execute' }).click()

    const tools = page.getByRole('complementary', { name: 'Workspace tools' })
    await expandQualityPanel(page)
    const collapse = tools.getByRole('button', { name: 'Collapse quality panel' })
    await expect(collapse).toBeInViewport()
    await expect(tools.getByRole('button', { name: 'Switch to standard quality mode' }))
      .toBeInViewport()

    await page.setViewportSize({ width: 1536, height: 900 })
    await page.evaluate(() => {
      document.documentElement.style.zoom = '200%'
    })
    await expect(collapse).toBeInViewport()
    const traceability = tools.getByRole('heading', { name: 'Traceability' })
    await traceability.scrollIntoViewIfNeeded()
    await expect(traceability).toBeInViewport()
  })

  test('does not show stale quality or review state while switching sessions', async ({ page }) => {
    const quality = await installQualityRoutes(page)
    const firstSessionId = await openQualitySession(page, ['quality first session fixture'])
    const secondSessionId = await openQualitySession(page, ['quality second session fixture'])

    await page.unroute('**/api/sessions/*/validated-work**')
    await page.unroute('**/api/sessions/*/reviews')
    let releaseSecondSession: () => void = () => undefined
    const secondSessionPending = new Promise<void>((resolve) => {
      releaseSecondSession = resolve
    })
    await page.route('**/api/sessions/*/validated-work**', async (route) => {
      const sessionId = new URL(route.request().url()).pathname.split('/')[3]
      if (sessionId === secondSessionId) await secondSessionPending
      await route.fulfill({
        json: sessionId === firstSessionId ? executingPlanDetails() : standardDetails,
        headers: { ETag: `W/"quality-${sessionId}"` },
      })
    })
    await page.route('**/api/sessions/*/reviews', async (route) => {
      const sessionId = new URL(route.request().url()).pathname.split('/')[3]
      if (sessionId === secondSessionId) await secondSessionPending
      await route.fulfill({
        json: sessionId === firstSessionId
          ? quality.getReviewDetails()
          : { revision: 1, status: 'never_run', reports: [] },
      })
    })

    const sessions = page.getByRole('navigation', { name: 'Recent Pi sessions' })
    await sessions
      .getByRole('button')
      .filter({ hasText: 'quality first session fixture' })
      .first()
      .click()
    await page.getByRole('button', { name: 'Expand quality panel' }).click()
    await expect(page.getByText('Add plan-first approval before execution.', { exact: true }))
      .toBeVisible()
    await expect(page.getByText('API accepts invalid review status')).toBeVisible()

    await sessions
      .getByRole('button')
      .filter({ hasText: 'quality second session fixture' })
      .first()
      .click()
    await expect(page.getByText('Loading quality details…')).toBeVisible()
    await expect(page.getByText('Loading review…')).toBeVisible()
    await expect(page.getByText('Add plan-first approval before execution.', { exact: true }))
      .toHaveCount(0)
    await expect(page.getByText('API accepts invalid review status')).toHaveCount(0)

    releaseSecondSession()
    await expect(page.getByText('Standard mode is active.')).toBeVisible()
    await expect(page.getByText('No findings recorded.')).toBeVisible()
  })

  test('preserves quality state across a seeded backend reconnect', async ({ page }) => {
    await installQualityRoutes(page, { initialDetails: executingPlanDetails() })
    await openQualitySession(page, ['quality reconnect fixture'])
    await page.getByRole('button', { name: 'Expand quality panel' }).click()
    await expect(page.getByText('Add plan-first approval before execution.', { exact: true }))
      .toBeVisible()

    let connections = 0
    let completedConnections = 0
    let releaseReconnect: () => void = () => undefined
    const reconnectPending = new Promise<void>((resolve) => {
      releaseReconnect = resolve
    })
    await page.route('**/api/events', async (route) => {
      connections += 1
      if (connections === 2) await reconnectPending
      const events: unknown[] = [{
        kind: 'event',
        event: 'manager_connected',
        sessionId: 'manager',
      }]
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'Cache-Control': 'no-cache' },
        body: `${connections === 1 ? 'retry: 100' : 'retry: 60000'}\n${
          events
            .map((event) => `data: ${JSON.stringify(event)}\n\n`)
            .join('')
        }`,
      })
      completedConnections += 1
    })

    await page.reload()
    await expect.poll(() => connections).toBeGreaterThanOrEqual(1)
    await page.getByRole('button', { name: 'Expand quality panel' }).click()
    await expect(page.getByText('Add plan-first approval before execution.', { exact: true }))
      .toBeVisible()
    await expect(page.getByText('Connection to backend lost; retrying.')).toBeVisible()
    releaseReconnect()
    await expect.poll(() => completedConnections).toBeGreaterThanOrEqual(2)
    await expect(page.getByText('Add plan-first approval before execution.', { exact: true }))
      .toBeVisible()
    await expect(page.getByText('API accepts invalid review status')).toBeVisible()
  })
})
