import type { QuotaSnapshot } from '../../../shared/types.ts'

export type QuotaProvider = 'openai' | 'copilot' | 'deepseek' | 'moonshot' | 'moonshotCn'

export interface RailQuota {
  label: string
  stale: boolean
  value: string
}

export function quotaProviderForModel(provider: unknown): QuotaProvider | undefined {
  if (provider === 'openai-codex') return 'openai'
  if (provider === 'github-copilot') return 'copilot'
  if (provider === 'deepseek') return 'deepseek'
  if (provider === 'moonshotai') return 'moonshot'
  if (provider === 'moonshotai-cn') return 'moonshotCn'
  return undefined
}

/** Summarizes the main window of the active provider for the compact rail. */
export function railQuota(
  quotas: QuotaSnapshot | null,
  provider: QuotaProvider | undefined,
): RailQuota | undefined {
  if (!quotas || !provider) return undefined
  if (provider === 'openai') {
    const window = quotas.openai.data.find(({ period }) => period === '5h') ?? quotas.openai.data[0]
    return window && {
      label: `OpenAI Codex quota: ${formatPercent(window.remainingPercent)} remaining`,
      stale: quotas.openai.stale,
      value: `${Math.round(window.remainingPercent)}%`,
    }
  }
  if (provider === 'copilot') {
    const window = quotas.copilot.data[0]
    if (!window) return undefined
    const remainingPercent = (window.limit - window.used) / window.limit * 100
    return {
      label: `GitHub Copilot quota: ${formatPercent(remainingPercent)} remaining`,
      stale: quotas.copilot.stale,
      value: `${Math.round(Math.max(0, Math.min(100, remainingPercent)))}%`,
    }
  }

  const snapshot = provider === 'deepseek'
    ? quotas.deepseek
    : provider === 'moonshot'
    ? quotas.moonshot
    : quotas.moonshotCn
  const balance = snapshot.data.find(({ currency }) => currency === 'USD') ?? snapshot.data[0]
  if (!balance) return undefined
  const name = provider === 'deepseek'
    ? 'DeepSeek'
    : provider === 'moonshot'
    ? 'Moonshot AI'
    : 'Moonshot AI China'
  return {
    label: `${name} balance: ${formatCurrency(balance.total, balance.currency)}`,
    stale: snapshot.stale,
    value: formatCompactCurrency(balance.total, balance.currency),
  }
}

function formatCurrency(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat(navigator.language, {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    })
      .format(value)
  } catch {
    return `${currency} ${value.toFixed(2)}`
  }
}

function formatCompactCurrency(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat(navigator.language, {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
      notation: 'compact',
      maximumFractionDigits: 1,
    })
      .format(value)
  } catch {
    return `${currency} ${Math.round(value)}`
  }
}

function formatPercent(value: number): string {
  return `${
    new Intl.NumberFormat(navigator.language, { maximumFractionDigits: 1 }).format(Math
      .max(0, Math.min(100, value)))
  } %`
}
