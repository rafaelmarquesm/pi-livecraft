import type { UsageDay } from '../../api.ts'

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
