import { isObject } from '../../../shared/is-object.ts'
import type {
  CopilotQuotaWindow,
  JsonObject,
  OpenAiQuotaWindow,
  ProviderBalance,
  QuotaProviderReport,
  QuotaProviderSnapshot,
  QuotaReport,
  QuotaSnapshot,
} from '../../../shared/types.ts'

const emptyProvider = <T>(): QuotaProviderSnapshot<T> => ({ data: [], stale: false })

/** Keeps each provider's last valid snapshot when the next one fails. */
export class QuotaCache {
  #openai = emptyProvider<OpenAiQuotaWindow>()
  #copilot = emptyProvider<CopilotQuotaWindow>()
  #deepseek = emptyProvider<ProviderBalance>()
  #moonshot = emptyProvider<ProviderBalance>()
  #moonshotCn = emptyProvider<ProviderBalance>()
  #refreshing = false

  snapshot(sessionRequired: boolean): QuotaSnapshot {
    return {
      openai: this.#openai,
      copilot: this.#copilot,
      deepseek: this.#deepseek,
      moonshot: this.#moonshot,
      moonshotCn: this.#moonshotCn,
      refreshing: this.#refreshing,
      sessionRequired,
    }
  }

  setRefreshing(refreshing: boolean): void {
    this.#refreshing = refreshing
  }

  /** Accepts only the private, versioned status emitted by the quota extension. */
  receiveManagerEvent(event: unknown): boolean {
    const data = object(object(event)?.data)
    if (
      object(event)?.event !== 'pi' || data?.type !== 'extension_ui_request' || data
          .method !== 'setStatus'
      || data.statusKey !== 'pi-livecraft.quotas' || typeof data.statusText !== 'string'
    ) return false
    let parsed: unknown
    try {
      parsed = JSON.parse(data.statusText)
    } catch {
      return false
    }
    const report = parseQuotaReport(parsed)
    if (!report) return false
    this.#openai = mergeProvider(this.#openai, report.openai, report.refreshedAt)
    this.#copilot = mergeProvider(this.#copilot, report.copilot, report.refreshedAt)
    this.#deepseek = mergeProvider(this.#deepseek, report.deepseek, report.refreshedAt)
    this.#moonshot = mergeProvider(this.#moonshot, report.moonshot, report.refreshedAt)
    this.#moonshotCn = mergeProvider(this.#moonshotCn, report.moonshotCn, report.refreshedAt)
    this.#refreshing = false
    return true
  }
}

function mergeProvider<T>(
  current: QuotaProviderSnapshot<T>,
  report: QuotaProviderReport<T>,
  updatedAt: number,
): QuotaProviderSnapshot<T> {
  if (report.ok) return { data: report.data, updatedAt, stale: false }
  return { ...current, stale: current.updatedAt !== undefined, error: report.error }
}

function parseQuotaReport(value: unknown): QuotaReport | undefined {
  const report = object(value)
  if (
    report?.protocol !== 'pi-livecraft.quotas' || (report.version !== 1 && report.version !== 2)
    || !finiteNumber(report.refreshedAt)
  ) return undefined
  const openai = parseProvider(report.openai, parseOpenAiWindow)
  const copilot = parseProvider(report.copilot, parseCopilotWindow)
  const legacyBalance = { ok: true as const, data: [] as ProviderBalance[] }
  const deepseek = report.version === 1
    ? legacyBalance
    : parseProvider(report.deepseek, parseProviderBalance)
  const moonshot = report.version === 1
    ? legacyBalance
    : parseProvider(report.moonshot, parseProviderBalance)
  const moonshotCn = report.version === 1
    ? legacyBalance
    : parseProvider(report.moonshotCn, parseProviderBalance)
  if (!openai || !copilot || !deepseek || !moonshot || !moonshotCn) return undefined
  return {
    protocol: 'pi-livecraft.quotas',
    version: 2,
    refreshedAt: report.refreshedAt,
    openai,
    copilot,
    deepseek,
    moonshot,
    moonshotCn,
  }
}

function parseProvider<T>(
  value: unknown,
  parseItem: (value: unknown) => T | undefined,
): QuotaProviderReport<T> | undefined {
  const provider = object(value)
  if (provider?.ok === false && typeof provider.error === 'string')
    return {
      ok: false,
      error: provider.error.slice(0, 300),
    }
  if (provider?.ok !== true || !Array.isArray(provider.data)) return undefined
  const data = provider.data.map(parseItem)
  return data.every((item): item is T => item !== undefined) ? { ok: true, data } : undefined
}

function parseOpenAiWindow(value: unknown): OpenAiQuotaWindow | undefined {
  const window = object(value)
  if (
    (window?.period !== '5h' && window?.period !== '7d') || !finiteNumber(window.remainingPercent)
  ) return undefined
  const resetsAt = finiteNumber(window.resetsAt) ? window.resetsAt : undefined
  return {
    period: window.period,
    remainingPercent: Math.min(100, Math.max(0, window.remainingPercent)),
    ...(resetsAt ? { resetsAt } : {}),
  }
}

function parseCopilotWindow(value: unknown): CopilotQuotaWindow | undefined {
  const window = object(value)
  if (
    typeof window?.name !== 'string' || !finiteNumber(window.used) || !finiteNumber(window.limit)
    || window.limit <= 0
  ) return undefined
  const resetsAt = finiteNumber(window.resetsAt) ? window.resetsAt : undefined
  return {
    name: window.name.slice(0, 80),
    used: Math.max(0, window.used),
    limit: window.limit,
    ...(resetsAt ? { resetsAt } : {}),
  }
}

function parseProviderBalance(value: unknown): ProviderBalance | undefined {
  const balance = object(value)
  if (
    typeof balance?.currency !== 'string' || !/^[A-Z]{3,8}$/.test(balance.currency)
    || !finiteNumber(balance.total)
    || !optionalFiniteNumber(balance.cash)
    || !optionalFiniteNumber(balance.voucher)
    || !optionalFiniteNumber(balance.granted)
    || !optionalFiniteNumber(balance.toppedUp)
    || (balance.usable !== undefined && typeof balance.usable !== 'boolean')
  ) return undefined
  return {
    currency: balance.currency,
    total: balance.total,
    ...(finiteNumber(balance.cash) ? { cash: balance.cash } : {}),
    ...(finiteNumber(balance.voucher) ? { voucher: balance.voucher } : {}),
    ...(finiteNumber(balance.granted) ? { granted: balance.granted } : {}),
    ...(finiteNumber(balance.toppedUp) ? { toppedUp: balance.toppedUp } : {}),
    ...(typeof balance.usable === 'boolean' ? { usable: balance.usable } : {}),
  }
}

function object(value: unknown): JsonObject | undefined {
  return isObject(value) ? value : undefined
}

function optionalFiniteNumber(value: unknown): boolean {
  return value === undefined || finiteNumber(value)
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}
