import assert from 'node:assert/strict'
import test from 'node:test'
import { createHarborAdapterPlan } from '../evals/quality/adapters/harbor.ts'
import { createJcodeBenchAdapterPlan } from '../evals/quality/adapters/jcode-bench.ts'

test('external adapter scaffolds are opt-in and path confined', () => {
  assert.throws(
    () =>
      createHarborAdapterPlan({
        campaignId: 'pilot',
        enabled: false,
        harborRoot: '.',
        maxCostUsd: 1,
        maxTasks: 1,
        resultsRoot: 'results',
        taskNames: ['smoke'],
        timeoutMs: 1000,
      }),
    /opt-in/,
  )
  assert.throws(
    () =>
      createHarborAdapterPlan({
        campaignId: '../pilot',
        enabled: true,
        harborRoot: '.',
        maxCostUsd: 1,
        maxTasks: 1,
        resultsRoot: 'results',
        taskNames: ['smoke'],
        timeoutMs: 1000,
      }),
    /safe identifier|path traversal/,
  )
  const plan = createHarborAdapterPlan({
    campaignId: 'pilot',
    enabled: true,
    harborRoot: '.',
    maxCostUsd: 1,
    maxTasks: 1,
    resultsRoot: 'results',
    taskNames: ['smoke'],
    timeoutMs: 1000,
  })
  assert.equal(plan.kind, 'harbor-terminal-bench')
  assert.match(plan.outputDirectory, /results/)
})

test('jcode bench scaffold refuses non-linux execution before provider work', () => {
  assert.throws(
    () =>
      createJcodeBenchAdapterPlan({
        benchmarkRoot: '.',
        campaignId: 'bench',
        enabled: false,
        maxCostUsd: 1,
        resultsRoot: 'results',
        taskIds: ['task1'],
        timeoutMs: 1000,
      }),
    /opt-in/,
  )
})
