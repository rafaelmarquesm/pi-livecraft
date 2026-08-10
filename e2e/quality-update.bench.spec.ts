import { expect, test, type Page } from '@playwright/test'
import type { ValidatedWorkDetailsResponse, ValidatedWorkMode } from '../shared/validated-work.ts'
import { qualityAcknowledgementKey } from '../src/features/quality/quality-state.ts'
import { closeCurrentSession, openSeededSession } from './helpers.ts'
import { executingPlanDetails } from './quality-fixtures.ts'

const warmupUpdates = 10
const measuredUpdates = 40
const commitBudgetMs = 16

interface QualityBenchmarkMetrics {
  commits: Array<{
    actualDuration: number
    baseDuration: number
    commitTime: number
    phase: string
    startTime: number
  }>
}

function benchmarkDetails(
  mode: Exclude<ValidatedWorkMode, 'standard'>,
  revision: number,
): ValidatedWorkDetailsResponse {
  const details = executingPlanDetails()
  if (!details.state || !details.summary)
    throw new Error('Benchmark fixture requires quality state')
  return {
    ...details,
    state: {
      ...details.state,
      mode,
      revision,
      updatedAt: revision,
    },
    summary: {
      ...details.summary,
      mode,
      revision,
    },
  }
}

async function installBenchmarkRoutes(page: Page) {
  let revision = 1
  let details = benchmarkDetails('plan', revision)
  let updateCount = 0

  await page.route('**/api/sessions/*/validated-work**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        json: details,
        headers: { ETag: `W/"quality-benchmark-${revision}"` },
      })
      return
    }
    const body = route.request().postDataJSON() as { mode?: ValidatedWorkMode }
    const mode = body.mode === 'validated' ? 'validated' : 'plan'
    revision += 1
    updateCount += 1
    details = benchmarkDetails(mode, revision)
    await route.fulfill({
      json: details,
      headers: { ETag: `W/"quality-benchmark-${revision}"` },
    })
  })
  await page.route(
    '**/api/quality/campaigns',
    (route) => route.fulfill({ json: { campaigns: [] } }),
  )
  await page.route(
    '**/api/sessions/*/reviews',
    (route) => route.fulfill({ json: { revision: 1, status: 'never_run', reports: [] } }),
  )

  return { getUpdateCount: () => updateCount }
}

async function selectMode(
  page: Page,
  routes: Awaited<ReturnType<typeof installBenchmarkRoutes>>,
  optionName: RegExp,
  expectedLabel: string,
): Promise<void> {
  const previousUpdates = routes.getUpdateCount()
  await page.getByRole('combobox', { name: /Quality mode:/ }).click()
  await page.getByRole('option', { name: optionName }).click()
  await expect.poll(routes.getUpdateCount).toBe(previousUpdates + 1)
  await expect(page.locator('.quality-widget-header')).toContainText(expectedLabel)
  await expect(page.getByText('Loading quality details…')).toBeHidden()
}

async function runUpdates(
  page: Page,
  routes: Awaited<ReturnType<typeof installBenchmarkRoutes>>,
  count: number,
): Promise<void> {
  for (let update = 0; update < count; update += 1) {
    const validated = update % 2 === 0
    await selectMode(
      page,
      routes,
      validated ? /^Validated/ : /^Plan first/,
      validated ? 'Validated' : 'Plan first',
    )
  }
}

function percentile95(samples: number[]): number {
  const sorted = samples.toSorted((left, right) => left - right)
  return sorted[Math.ceil(sorted.length * 0.95) - 1]
}

test.skip(
  process.env.PI_LIVECRAFT_QUALITY_BENCHMARK !== '1',
  'requires benchmark-only React Profiler instrumentation',
)

test.afterEach(async ({ page }) => {
  await closeCurrentSession(page)
})

test('QualityWidget update commit p95 stays below 16 ms', async ({ page }) => {
  await page.addInitScript(
    (key) => window.localStorage.setItem(key, 'yes'),
    qualityAcknowledgementKey,
  )
  const routes = await installBenchmarkRoutes(page)
  await openSeededSession(page, ['quality update benchmark fixture'])

  await page.getByRole('button', { name: 'Expand quality panel' }).click()
  await expect(page.getByRole('button', { name: 'Collapse quality panel' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Traceability' })).toBeVisible()

  await runUpdates(page, routes, warmupUpdates)
  await page.evaluate(() => {
    const benchmarkWindow = window as typeof window & {
      __PI_LIVECRAFT_QUALITY_BENCHMARK__?: QualityBenchmarkMetrics
    }
    benchmarkWindow.__PI_LIVECRAFT_QUALITY_BENCHMARK__ = { commits: [] }
  })

  await runUpdates(page, routes, measuredUpdates)
  const samples = await page.evaluate(() => {
    const benchmarkWindow = window as typeof window & {
      __PI_LIVECRAFT_QUALITY_BENCHMARK__?: QualityBenchmarkMetrics
    }
    return benchmarkWindow.__PI_LIVECRAFT_QUALITY_BENCHMARK__?.commits.map((commit) =>
      commit.actualDuration
    ) ?? []
  })
  expect(samples.length).toBeGreaterThanOrEqual(measuredUpdates)
  const p95 = percentile95(samples)

  console.info(
    `QualityWidget update commits: n=${samples.length}, p95=${
      p95.toFixed(2)
    } ms, budget=<${commitBudgetMs} ms`,
  )
  expect(p95).toBeLessThan(commitBudgetMs)
})
