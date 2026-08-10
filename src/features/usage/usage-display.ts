import type { UsageDay, UsageTotals } from '../../api.ts'
import { formatTurnCost } from '../conversation/message-usage.ts'

/** Totals include optional inference metrics from every backend rollup bucket. */
export type UsageStatsSource = UsageTotals

/**
 * Height of a day bar as a percentage of the tallest day in the chart window.
 * Returns 0 when there is nothing to scale against and clamps overflow so a
 * single dominant day never draws a bar taller than the chart.
 */
export function usageBarHeight(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0 || value <= 0) return 0
  return Math.round(Math.min(1, value / max) * 100)
}

/**
 * Compact label for a UTC day bucket ("YYYY-MM-DD"). Formats in UTC so a
 * non-UTC locale never shifts the bar onto the neighboring day, and falls
 * back to the raw key when the rollup contains a malformed day.
 */
export function usageDayLabel(day: string): string {
  const date = new Date(`${day}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return day
  return new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short', timeZone: 'UTC' })
    .format(date)
}

/**
 * Expands the rollup's sparse day buckets into a contiguous window of the
 * last `count` days (oldest first, ending on `today` UTC), filling idle days
 * with zero-cost buckets so the chart stays stable across quiet stretches.
 * Buckets older than the window are dropped.
 */
export function lastUsageDays(
  byDay: readonly UsageDay[],
  count = 14,
  today = new Date(),
): UsageDay[] {
  const zeroDay = (day: string): UsageDay => ({ day, cost: 0, totalTokens: 0, records: 0 })
  const byDate = new Map(byDay.map((bucket) => [bucket.day, bucket]))
  const window: UsageDay[] = []
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const date = new Date(today)
    date.setUTCDate(date.getUTCDate() - offset)
    const key = date.toISOString().slice(0, 10)
    window.push(byDate.get(key) ?? zeroDay(key))
  }
  return window
}

/** Renders the cache hit rate as a percentage ("34%"). */
export function formatCacheHitRate(value: number): string {
  return `${Math.round(value * 100)}%`
}

/** Renders the cost per 1k output tokens, reusing the shared USD formatter. */
export function formatCostPer1kOutput(value: number): string {
  return `${formatTurnCost(value)}/1k out`
}

/** Renders the input:output ratio as "1:4" / "4:1" / "1.5:1" (one side normalized to 1). */
export function formatInputOutputRatio(value: number): string {
  const side = (n: number): string => {
    const tenths = Math.round(n * 10)
    return tenths % 10 === 0 ? String(tenths / 10) : `${tenths / 10}`
  }
  return value >= 1 ? `${side(value)}:1` : `1:${side(1 / value)}`
}

/** Renders generation throughput, one decimal below 10 tok/s, integers above. */
export function formatTokensPerSecond(value: number): string {
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10
  return String(rounded)
}

/**
 * Formats the derived inference metrics of one aggregate into the compact
 * stats parts rendered by the Usage widget (Backlog B). Each metric is
 * included only when the payload carries it, so snapshots from an older
 * backend produce an empty list and the widget shows nothing.
 */
export function usageStatsParts(source: UsageStatsSource): string[] {
  const parts: string[] = []
  const cacheHitRate = source.cacheHitRate
  if (isFiniteNumber(cacheHitRate)) parts.push(`cache ${formatCacheHitRate(cacheHitRate)}`)
  const costPer1kOutput = source.costPer1kOutput
  if (isFiniteNumber(costPer1kOutput)) parts.push(formatCostPer1kOutput(costPer1kOutput))
  const inputOutputRatio = source.inputOutputRatio
  if (isFiniteNumber(inputOutputRatio) && inputOutputRatio > 0) {
    parts.push(`${formatInputOutputRatio(inputOutputRatio)} in:out`)
  }
  const tokensPerSecond = source.tokensPerSecond
  if (isFiniteNumber(tokensPerSecond) && tokensPerSecond > 0) {
    parts.push(`${formatTokensPerSecond(tokensPerSecond)} tok/s`)
  }
  return parts
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}
