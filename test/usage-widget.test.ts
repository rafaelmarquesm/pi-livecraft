import assert from 'node:assert/strict'
import test from 'node:test'
import {
  formatCacheHitRate,
  formatCostPer1kOutput,
  formatInputOutputRatio,
  formatTokensPerSecond,
  lastUsageDays,
  usageBarHeight,
  usageDayLabel,
  usageStatsParts,
} from '../src/features/usage/usage-display.ts'

test('usageBarHeight scales bars relative to the window maximum', () => {
  assert.equal(usageBarHeight(10, 20), 50)
  assert.equal(usageBarHeight(20, 20), 100)
  assert.equal(usageBarHeight(0, 20), 0)
  assert.equal(usageBarHeight(-5, 20), 0)
  assert.equal(usageBarHeight(1, 3), 33)
  // A day above the max clamps to full height instead of overflowing.
  assert.equal(usageBarHeight(25, 20), 100)
  // Nothing to scale against: no bar at all, not an infinite one.
  assert.equal(usageBarHeight(10, 0), 0)
  assert.equal(usageBarHeight(Number.NaN, 20), 0)
})

test('usageDayLabel renders compact UTC day labels without timezone drift', () => {
  assert.equal(usageDayLabel('2026-08-08'), 'Aug 8')
  assert.equal(usageDayLabel('2026-01-05'), 'Jan 5')
  assert.equal(usageDayLabel('2026-12-31'), 'Dec 31')
  // A malformed bucket key falls back to the raw string instead of throwing.
  assert.equal(usageDayLabel('not-a-day'), 'not-a-day')
})

test('lastUsageDays fills a contiguous window ending today, oldest first', () => {
  const today = new Date('2026-08-08T12:00:00Z')
  const window = lastUsageDays(
    [
      { day: '2026-08-08', cost: 1, totalTokens: 100, records: 1 },
      { day: '2026-08-05', cost: 2, totalTokens: 200, records: 2 },
      { day: '2026-07-20', cost: 3, totalTokens: 300, records: 3 },
    ],
    14,
    today,
  )

  assert.equal(window.length, 14)
  assert.deepEqual(window[0], { day: '2026-07-26', cost: 0, totalTokens: 0, records: 0 })
  assert.deepEqual(window[13], { day: '2026-08-08', cost: 1, totalTokens: 100, records: 1 })
  // Gap days between recorded buckets become zero-cost buckets.
  assert.deepEqual(window[9], { day: '2026-08-04', cost: 0, totalTokens: 0, records: 0 })
  assert.deepEqual(window[10], { day: '2026-08-05', cost: 2, totalTokens: 200, records: 2 })
  // Buckets older than the window are dropped.
  assert.ok(!window.some((day) => day.day === '2026-07-20'))
})

test('formatCacheHitRate renders a percentage', () => {
  assert.equal(formatCacheHitRate(0.26), '26%')
  assert.equal(formatCacheHitRate(0), '0%')
  assert.equal(formatCacheHitRate(1), '100%')
  assert.equal(formatCacheHitRate(0.3889), '39%')
})

test('formatCostPer1kOutput reuses the shared USD formatter', () => {
  assert.equal(formatCostPer1kOutput(0.1486), '$0.15/1k out')
  assert.equal(formatCostPer1kOutput(1.2), '$1.20/1k out')
})

test('formatInputOutputRatio normalizes one side to 1', () => {
  assert.equal(formatInputOutputRatio(0.25), '1:4')
  assert.equal(formatInputOutputRatio(4), '4:1')
  assert.equal(formatInputOutputRatio(1.5), '1.5:1')
  assert.equal(formatInputOutputRatio(7.91), '7.9:1')
  assert.equal(formatInputOutputRatio(1), '1:1')
})

test('formatTokensPerSecond renders integers above 10, one decimal below', () => {
  assert.equal(formatTokensPerSecond(12), '12')
  assert.equal(formatTokensPerSecond(85), '85')
  assert.equal(formatTokensPerSecond(3.14), '3.1')
  assert.equal(formatTokensPerSecond(47.5), '48')
})

test('usageStatsParts builds the compact inference stats line from available metrics', () => {
  const parts = usageStatsParts({
    cost: 0.0639,
    totalTokens: 5030,
    records: 3,
    cacheHitRate: 0.2609,
    costPer1kOutput: 0.1486,
    inputOutputRatio: 7.91,
    tokensPerSecond: 47.5,
  })
  assert.deepEqual(parts, ['cache 26%', '$0.15/1k out', '7.9:1 in:out', '48 tok/s'])
  // A legacy snapshot without derived metrics produces no stats line.
  assert.deepEqual(usageStatsParts({ cost: 1, totalTokens: 10, records: 1 }), [])
  // A zero cache rate is still reported; a zero-output bucket drops the rest.
  assert.deepEqual(
    usageStatsParts({ cost: 0.01, totalTokens: 100, records: 1, cacheHitRate: 0 }),
    ['cache 0%'],
  )
})

test('lastUsageDays defaults to a 14-day window and keeps recorded buckets in place', () => {
  const today = new Date('2026-08-08T12:00:00Z')
  const byDay = [
    { day: '2026-08-08', cost: 0.5, totalTokens: 50, records: 1 },
    { day: '2026-08-07', cost: 1.5, totalTokens: 150, records: 1 },
  ]

  const window = lastUsageDays(byDay, undefined, today)
  assert.equal(window.length, 14)
  assert.equal(window[12].day, '2026-08-07')
  assert.equal(window[12].cost, 1.5)
  assert.equal(window[13].day, '2026-08-08')
})
