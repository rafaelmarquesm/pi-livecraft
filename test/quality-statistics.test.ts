import assert from 'node:assert/strict'
import test from 'node:test'
import type { QualityTrial } from '../evals/quality/artifact-schema.ts'
import {
  bootstrapMeanCi,
  costPerSuccess,
  invalidReasonCounts,
  mean,
  median,
  pairedDeltas,
  passAt1,
  passAtK,
  progressCurve,
  sampleStandardDeviation,
  timeToFirstPass,
  wilsonInterval,
} from '../evals/quality/statistics.ts'

function trial(partial: Partial<QualityTrial>): QualityTrial {
  return {
    arm: 'livecraft-standard',
    attempt: 1,
    campaignId: 'campaign',
    cellId: 'cell',
    costUsd: 0.1,
    durationMs: 1000,
    grader: { exitCode: 0, parsed: true, passed: partial.passed ?? false, summary: 'ok' },
    id: partial.id ?? 'trial',
    invalidReasons: [],
    observed: { model: 'model', provider: 'provider', thinking: 'low' },
    passed: false,
    progress: [],
    score: null,
    seed: 'seed',
    settledAt: '2026-01-01T00:00:01.000Z',
    startedAt: '2026-01-01T00:00:00.000Z',
    taskId: 'task',
    taskRevision: 'rev',
    timeToPassMs: null,
    tokens: { cacheRead: 0, cacheWrite: 0, input: 1, output: 1 },
    valid: true,
    ...partial,
  }
}

test('computes pass@1 and combinatorial pass@k from valid raw counts', () => {
  assert.equal(passAt1(5, 2), 0.4)
  assert.equal(passAtK(5, 2, 1), 0.4)
  assert.equal(passAtK(5, 2, 2), 0.7)
  assert.equal(passAtK(5, 0, 3), 0)
  assert.equal(passAtK(5, 5, 3), 1)
  assert.throws(() => passAtK(2, 1, 3), /1 <= k <= n/)
})

test('computes Wilson interval for the raw success proportion', () => {
  const interval = wilsonInterval(2, 5)
  assert.ok(interval.lower > 0.1 && interval.lower < 0.2)
  assert.ok(interval.center > 0.44 && interval.center < 0.45)
  assert.ok(interval.upper > 0.75 && interval.upper < 0.8)
})

test('computes descriptive statistics and deterministic bootstrap CI', () => {
  assert.equal(mean([1, 2, 6]), 3)
  assert.equal(median([9, 1, 2, 6]), 4)
  assert.ok(Math.abs(sampleStandardDeviation([2, 4, 4, 4, 5, 5, 7, 9]) - 2.138089935299395) < 1e-12)

  const first = bootstrapMeanCi([1, 2, 6], { confidence: 0.9, iterations: 200, seed: 42 })
  const second = bootstrapMeanCi([1, 2, 6], { confidence: 0.9, iterations: 200, seed: 42 })
  assert.deepEqual(first, second)
  assert.ok(first.lower <= mean([1, 2, 6]))
  assert.ok(first.upper >= mean([1, 2, 6]))
})

test('computes cost, first pass, invalid reasons, progress curves, and paired deltas', () => {
  const trials = [
    trial({
      costUsd: 0.2,
      id: 'fail',
      invalidReasons: ['network_failure'],
      passed: false,
      score: 0.1,
      valid: false,
    }),
    trial({ costUsd: 0.3, id: 'pass1', passed: true, score: 0.8, timeToPassMs: 700 }),
    trial({ costUsd: 0.5, id: 'pass2', passed: true, score: 0.9, timeToPassMs: 500 }),
  ]
  assert.equal(costPerSuccess(trials), 0.4)
  assert.equal(timeToFirstPass(trials), 500)
  assert.equal(invalidReasonCounts(trials).get('network_failure'), 1)

  const curve = progressCurve([
    trial({ id: 'a', progress: [{ bestScore: 0.2, elapsedMs: 20, passed: false }] }),
    trial({ id: 'b', progress: [{ bestScore: 0.7, elapsedMs: 10, passed: true }] }),
  ])
  assert.deepEqual(curve, [
    { bestPassed: true, bestScore: 0.7, elapsedMs: 10 },
    { bestPassed: true, bestScore: 0.7, elapsedMs: 20 },
  ])

  const deltas = pairedDeltas(
    [trial({ score: 0.3, seed: 'same', taskId: 'task' })],
    [trial({ score: 0.8, seed: 'same', taskId: 'task' })],
    (item) => item.score,
  )
  assert.deepEqual(deltas, [{ delta: 0.5, left: 0.3, right: 0.8, seed: 'same', taskId: 'task' }])
})
