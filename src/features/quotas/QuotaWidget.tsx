import { useState } from 'react'
import { Tooltip } from '../../components/Tooltip.tsx'
import type {
  ProviderBalance,
  QuotaProviderSnapshot,
  QuotaSnapshot,
} from '../../../shared/types.ts'

/** Displays normalized quota readings without deducing absent quota from provider responses. */
export function QuotaWidget(
  { quotas, onOpenUsage, onRefresh }: {
    quotas: QuotaSnapshot | null
    onOpenUsage: () => void
    onRefresh: () => Promise<void>
  },
) {
  const [refreshing, setRefreshing] = useState(false)
  const updatedAt = Math.max(
    quotas?.openai.updatedAt ?? 0,
    quotas?.copilot.updatedAt ?? 0,
    quotas?.deepseek.updatedAt ?? 0,
    quotas?.moonshot.updatedAt ?? 0,
    quotas?.moonshotCn.updatedAt ?? 0,
  )

  /** Keeps the button disabled until the manual refresh completes, whether success or error. */
  async function refresh(): Promise<void> {
    setRefreshing(true)
    try {
      await onRefresh()
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <>
      <header className='widget-header quota-header'>
        <div>
          <strong>Quotas</strong>
          <span>{updatedAt ? `Updated ${formatRelativeDate(updatedAt)}` : 'No reading'}</span>
        </div>
        <Tooltip label='Refresh'>
          <button
            aria-label='Refresh quotas'
            className='git-refresh'
            disabled={refreshing || quotas?.refreshing || quotas?.sessionRequired}
            onClick={() => void refresh()}
            type='button'
          >
            ↻
          </button>
        </Tooltip>
      </header>
      <div className='widget-content quota-content' aria-busy={refreshing || quotas?.refreshing}>
        <button
          className='quota-usage-link'
          onClick={onOpenUsage}
          type='button'
        >
          <strong>$ Usage &amp; inference metrics</strong>
          <span>Costs, cache hit rate, input:output and generation speed</span>
        </button>
        {!quotas ? <QuotaSkeleton /> : (
          <>
            {quotas.sessionRequired && (
              <p className='quota-empty'>Open a Pi session to read quotas.</p>
            )}
            <ProviderSection name='OpenAI Codex' provider={quotas.openai}>
              {quotas.openai.data.map((window) => (
                <div className='quota-row' key={window.period}>
                  <div className='quota-row-copy'>
                    <strong>{window.period === '5h' ? '5-hour window' : '7-day window'}</strong>
                    <b>{formatPercent(window.remainingPercent)} remaining</b>
                  </div>
                  <QuotaBar
                    label={`${formatPercent(window.remainingPercent)} remaining`}
                    value={window.remainingPercent}
                  />
                  {window.resetsAt && <small>Reset {formatReset(window.resetsAt)}</small>}
                </div>
              ))}
            </ProviderSection>
            <ProviderSection name='GitHub Copilot' provider={quotas.copilot}>
              {quotas.copilot.data.map((window) => (
                <div className='quota-row' key={window.name}>
                  <div className='quota-row-copy'>
                    <strong>{window.name}</strong>
                    <b>{formatNumber(window.used)} / {formatNumber(window.limit)}</b>
                  </div>
                  <QuotaBar
                    label={`${formatNumber(window.used)} used of ${formatNumber(window.limit)}`}
                    value={window.used / window.limit * 100}
                  />
                  {window.resetsAt && <small>Reset {formatReset(window.resetsAt)}</small>}
                </div>
              ))}
            </ProviderSection>
            <BalanceSection name='DeepSeek' provider={quotas.deepseek} />
            <BalanceSection name='Moonshot AI' provider={quotas.moonshot} />
            <BalanceSection name='Moonshot AI China' provider={quotas.moonshotCn} />
          </>
        )}
      </div>
    </>
  )
}

function BalanceSection(
  { name, provider }: { name: string; provider: QuotaProviderSnapshot<ProviderBalance> },
) {
  if (provider.data.length === 0 && !provider.error && !provider.stale) return null
  return (
    <ProviderSection name={name} provider={provider}>
      {provider.data.map((balance) => (
        <div className='quota-balance-row' key={balance.currency}>
          <div className='quota-row-copy'>
            <strong>{balance.currency} balance</strong>
            <b>{formatBalance(balance.total, balance.currency)}</b>
          </div>
          {balanceDetails(balance).length > 0 && (
            <small>{balanceDetails(balance).join(' · ')}</small>
          )}
          {balance.usable === false && (
            <small className='quota-balance-unavailable'>Unavailable for API requests</small>
          )}
        </div>
      ))}
    </ProviderSection>
  )
}

function ProviderSection(
  { children, name, provider }: {
    children: React.ReactNode
    name: string
    provider: QuotaProviderSnapshot<unknown>
  },
) {
  return (
    <section className='quota-provider' aria-label={name}>
      <div className='quota-provider-heading'>
        <h2>{name}</h2>
        {provider.stale && <span>Stale reading</span>}
      </div>
      {children}
      {provider.data.length === 0 && !provider.error && (
        <p className='quota-provider-empty'>No quota data available.</p>
      )}
      {provider.error && <p className='quota-error' role='status'>{provider.error}</p>}
    </section>
  )
}

function QuotaBar({ label, value }: { label: string; value: number }) {
  const bounded = Math.min(100, Math.max(0, value))
  return (
    <div
      aria-label={label}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={Math.round(bounded)}
      className='quota-bar'
      role='progressbar'
    >
      <span style={{ width: `${bounded}%` }} />
    </div>
  )
}

function QuotaSkeleton() {
  return (
    <div aria-label='Loading quotas' className='quota-skeleton' role='status'>
      <span />
      <span />
      <span />
    </div>
  )
}

function formatRelativeDate(timestamp: number): string {
  const elapsedMinutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000))
  if (elapsedMinutes < 1) return 'just now'
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`
  return new Intl.DateTimeFormat(navigator.language, { dateStyle: 'short', timeStyle: 'short' })
    .format(timestamp)
}

function formatReset(timestamp: number): string {
  return new Intl.DateTimeFormat(navigator.language, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
    .format(timestamp)
}

function formatPercent(value: number): string {
  return `${
    new Intl.NumberFormat(navigator.language, { maximumFractionDigits: 1 }).format(value)
  } %`
}

function balanceDetails(balance: ProviderBalance): string[] {
  return [
    balance.cash === undefined
      ? undefined
      : `cash ${formatBalance(balance.cash, balance.currency)}`,
    balance.voucher === undefined
      ? undefined
      : `voucher ${formatBalance(balance.voucher, balance.currency)}`,
    balance.granted === undefined
      ? undefined
      : `granted ${formatBalance(balance.granted, balance.currency)}`,
    balance.toppedUp === undefined
      ? undefined
      : `topped up ${formatBalance(balance.toppedUp, balance.currency)}`,
  ]
    .filter((part): part is string => part !== undefined)
}

function formatBalance(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat(navigator.language, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    })
      .format(value)
  } catch {
    return `${currency} ${value.toFixed(2)}`
  }
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(navigator.language, { maximumFractionDigits: 0 }).format(value)
}
