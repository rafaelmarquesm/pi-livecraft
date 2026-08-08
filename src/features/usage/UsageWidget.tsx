import { useEffect, useState } from 'react'
import { Tooltip } from '../../components/Tooltip.tsx'
import { getUsage, type UsageSnapshot } from '../../api.ts'
import { formatTokens, formatTurnCost } from '../conversation/message-usage.ts'
import { lastUsageDays, usageBarHeight, usageDayLabel } from './usage-display.ts'

/** Self-fetched usage rollup with the same stale/error/refreshing semantics as QuotaSnapshot. */
interface UsageState {
  snapshot: UsageSnapshot | null
  stale: boolean
  error: string | null
  refreshing: boolean
}

/** Shows the workspace cost/token ledger (GET /api/usage) with an SVG cost chart. */
export function UsageWidget({ workspacePath }: { workspacePath: string }) {
  const [state, setState] = useState<UsageState>({
    snapshot: null,
    stale: false,
    error: null,
    refreshing: true,
  })
  const [reloadRequest, setReloadRequest] = useState(0)
  const [updatedAt, setUpdatedAt] = useState<number | null>(null)
  const { snapshot, stale, error, refreshing } = state

  /** Loads the rollup on mount and after manual refreshes, keeping the last snapshot visible (stale) while refetching. */
  useEffect(() => {
    let cancelled = false
    setState((current) => ({
      ...current,
      stale: current.snapshot !== null,
      refreshing: true,
      error: null,
    }))
    void getUsage(workspacePath)
      .then((next) => {
        if (cancelled) return
        setState({ snapshot: next, stale: false, error: null, refreshing: false })
        setUpdatedAt(Date.now())
      })
      .catch((cause) => {
        if (cancelled) return
        setState((current) => ({
          ...current,
          stale: current.snapshot !== null,
          refreshing: false,
          error: messageOf(cause),
        }))
      })
    return () => {
      cancelled = true
    }
  }, [reloadRequest, workspacePath])

  return (
    <>
      <header className='widget-header usage-header'>
        <div>
          <strong>Usage</strong>
          <span>
            {refreshing
              ? 'Refreshing…'
              : updatedAt
              ? `Updated ${formatRelativeDate(updatedAt)}`
              : 'No reading'}
          </span>
        </div>
        <Tooltip label='Refresh'>
          <button
            aria-label='Refresh usage'
            className='git-refresh'
            disabled={refreshing}
            onClick={() => setReloadRequest((count) => count + 1)}
            type='button'
          >
            ↻
          </button>
        </Tooltip>
      </header>
      <div className='widget-content usage-content' aria-busy={refreshing}>
        {!snapshot
          ? (
            error
              ? <p className='usage-error' role='status'>Usage unavailable. {error}</p>
              : <UsageSkeleton />
          )
          : (
            <>
              {stale && <span className='usage-stale'>Stale reading</span>}
              {snapshot.totals.records === 0
                ? <p className='usage-empty'>No usage recorded yet.</p>
                : <UsageSummary snapshot={snapshot} />}
              {error && <p className='usage-error' role='status'>{error}</p>}
            </>
          )}
      </div>
    </>
  )
}

function UsageSummary({ snapshot }: { snapshot: UsageSnapshot }) {
  const days = lastUsageDays(snapshot.byDay)
  const maxCost = Math.max(0, ...days.map((day) => day.cost))
  return (
    <>
      <dl className='usage-totals'>
        <div>
          <dt>Cost</dt>
          <dd>{formatTurnCost(snapshot.totals.cost)}</dd>
        </div>
        <div>
          <dt>Tokens</dt>
          <dd>{formatTokens(snapshot.totals.totalTokens)}</dd>
        </div>
        <div>
          <dt>Records</dt>
          <dd>{String(snapshot.totals.records)}</dd>
        </div>
      </dl>
      <section className='usage-days' aria-label='Cost per day'>
        <h2>Last 14 days</h2>
        <svg
          aria-label='Daily cost'
          className='usage-bars'
          role='img'
          viewBox={`0 0 ${days.length * 18 - 4} 50`}
        >
          {days.map((day, index) => {
            const height = usageBarHeight(day.cost, maxCost) / 100 * 44
            return (
              <rect
                aria-hidden='true'
                fill='currentColor'
                height={height}
                key={day.day}
                rx={2}
                width={14}
                x={index * 18}
                y={6 + 44 - height}
              >
                <title>{`${usageDayLabel(day.day)} — ${formatTurnCost(day.cost)}`}</title>
              </rect>
            )
          })}
        </svg>
        <div className='usage-day-range'>
          <span>{usageDayLabel(days[0].day)}</span>
          <span>{usageDayLabel(days[days.length - 1].day)}</span>
        </div>
      </section>
      {snapshot.byModel.length > 0 && (
        <section className='usage-models' aria-label='Usage by model'>
          <h2>By model</h2>
          <ul>
            {snapshot.byModel.map((entry) => (
              <li key={entry.model}>
                <span className='usage-model-name'>{entry.model}</span>
                <b>{formatTurnCost(entry.cost)}</b>
                <small>
                  {formatTokens(entry.totalTokens)} tokens · {entry.records} record
                  {entry.records === 1 ? '' : 's'}
                </small>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}

function UsageSkeleton() {
  return (
    <div aria-label='Loading usage' className='usage-skeleton' role='status'>
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

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
