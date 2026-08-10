import type { CopilotQuotaWindow, OpenAiQuotaWindow, ProviderBalance } from './types.ts'
import { isObject } from './is-object.ts'

/** Extracts rate-limit windows from OpenAI's opaque quota response. */
export function parseOpenAiUsage(value: unknown): OpenAiQuotaWindow[] {
  const root = object(value)
  const rateLimit = object(root?.rate_limit) ?? object(root?.rate_limits)
  if (!rateLimit) return []
  const candidates = [
    object(rateLimit.primary_window) ?? object(rateLimit.primary) ?? object(
      rateLimit.five_hour_limit,
    ) ?? object(rateLimit.five_hour),
    object(rateLimit.secondary_window) ?? object(rateLimit.secondary) ?? object(
      rateLimit.weekly_limit,
    ) ?? object(rateLimit.weekly),
  ]
  return candidates
    .flatMap((window, index): OpenAiQuotaWindow[] => {
      if (!window) return []
      const seconds = numberField(window, 'limit_window_seconds')
      const period: OpenAiQuotaWindow['period'] = seconds && seconds >= 6 * 24 * 60 * 60
        ? '7d'
        : index === 0
        ? '5h'
        : '7d'
      const used = numberField(window, 'used_percent') ?? percentUsedFromRemaining(window)
      if (used === undefined) return []
      const resetsAt = dateValue(window.reset_at ?? window.reset_time_ms)
      return [{ period, remainingPercent: clamp(100 - used), ...(resetsAt ? { resetsAt } : {}) }]
    })
    .filter((window, index, windows) =>
      windows.findIndex(({ period }) => period === window.period) === index
    )
}

/** Extracts monthly quota buckets from GitHub Copilot's opaque quota response. */
export function parseCopilotUsage(value: unknown): CopilotQuotaWindow[] {
  const root = object(value)
  const snapshots = object(root?.quota_snapshots)
  const resetsAt = dateValue(
    root?.quota_reset_date ?? root?.quota_reset_date_utc ?? root?.limited_user_reset_date,
  )
  if (snapshots) {
    const labels: [string, string][] = [['premium_interactions', 'Premium interactions'], [
      'chat',
      'Chat',
    ], ['completions', 'Completions']]
    return labels.flatMap(([key, name]) => {
      const quota = object(snapshots[key])
      if (!quota || quota.unlimited === true) return []
      const limit = numberField(quota, 'entitlement')
      const remaining = numberField(quota, 'remaining') ?? numberField(quota, 'quota_remaining')
      return limit && remaining !== undefined
        ? [{ name, used: Math.max(0, limit - remaining), limit, ...(resetsAt ? { resetsAt } : {}) }]
        : []
    })
  }
  const limits = object(root?.monthly_quotas)
  const remaining = object(root?.limited_user_quotas)
  if (!limits || !remaining) return []
  return ([['chat', 'Chat'], ['completions', 'Completions']] as const).flatMap(([key, name]) => {
    const limit = numberField(limits, key)
    const left = numberField(remaining, key)
    return limit && left !== undefined
      ? [{ name, used: Math.max(0, limit - left), limit, ...(resetsAt ? { resetsAt } : {}) }]
      : []
  })
}

/** Normalizes DeepSeek's per-currency prepaid and granted account balances. */
export function parseDeepSeekBalance(value: unknown): ProviderBalance[] {
  const root = object(value)
  if (!Array.isArray(root?.balance_infos)) return []
  const usable = typeof root.is_available === 'boolean' ? root.is_available : undefined
  return root.balance_infos.flatMap((candidate): ProviderBalance[] => {
    const balance = object(candidate)
    const currency = stringField(balance, 'currency')
    const total = numberField(balance, 'total_balance')
    if (!currency || total === undefined) return []
    const granted = numberField(balance, 'granted_balance')
    const toppedUp = numberField(balance, 'topped_up_balance')
    return [{
      currency,
      total,
      ...(granted !== undefined ? { granted } : {}),
      ...(toppedUp !== undefined ? { toppedUp } : {}),
      ...(usable !== undefined ? { usable } : {}),
    }]
  })
}

/** Normalizes Moonshot's balance response; currency follows the selected regional API. */
export function parseMoonshotBalance(value: unknown, currency: string): ProviderBalance[] {
  const data = object(object(value)?.data)
  const total = numberField(data, 'available_balance')
  if (total === undefined) return []
  const voucher = numberField(data, 'voucher_balance')
  const cash = numberField(data, 'cash_balance')
  return [{
    currency,
    total,
    ...(cash !== undefined ? { cash } : {}),
    ...(voucher !== undefined ? { voucher } : {}),
  }]
}

function percentUsedFromRemaining(value: Record<string, unknown>): number | undefined {
  const remaining = numberField(value, 'percent_left') ?? numberField(value, 'remaining_percent')
  return remaining === undefined ? undefined : 100 - remaining
}

function dateValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value))
    return value < 10_000_000_000
      ? value * 1000
      : value
  if (typeof value !== 'string' || !value) return undefined
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? undefined : parsed
}

function object(value: unknown): Record<string, unknown> | undefined {
  return isObject(value) ? value : undefined
}

function stringField(value: unknown, key: string): string | undefined {
  const raw = object(value)?.[key]
  return typeof raw === 'string' && /^[A-Z]{3,8}$/.test(raw) ? raw : undefined
}

function numberField(value: unknown, key: string): number | undefined {
  const raw = object(value)?.[key]
  if (raw === null || raw === '' || raw === undefined) return undefined
  const field = Number(raw)
  return Number.isFinite(field) ? field : undefined
}

function clamp(value: number): number {
  return Math.min(100, Math.max(0, value))
}
