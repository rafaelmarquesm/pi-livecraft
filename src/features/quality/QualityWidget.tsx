import { useEffect, useMemo, useRef, useState } from 'react'
import { getValidatedWork } from '../../api.ts'
import type {
  ValidatedWorkDetailsResponse,
  ValidatedWorkMode,
  ValidatedWorkSummaryV1,
} from '../../../shared/validated-work.ts'
import { phaseLabels, qualityModes } from './quality-display.ts'
import { PlanSection } from './PlanSection.tsx'
import { ReadinessCard } from './ReadinessCard.tsx'
import { ReviewSection } from './ReviewSection.tsx'
import { TraceabilitySection } from './TraceabilitySection.tsx'

export function QualityWidget({
  mode,
  onModeChange,
  reviewRevision,
  sessionId,
  summary,
}: {
  mode: ValidatedWorkMode
  onModeChange: (mode: ValidatedWorkMode) => void
  reviewRevision: number
  sessionId: string
  summary: ValidatedWorkSummaryV1 | null
}) {
  const [details, setDetails] = useState<ValidatedWorkDetailsResponse | null>(null)
  const [etag, setEtag] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const lastKey = useRef<string>('')
  const detailKey = `${sessionId}:${summary?.revision ?? 'standard'}`

  useEffect(() => {
    let cancelled = false
    const needsFetch = lastKey.current !== detailKey
    if (!needsFetch) return
    lastKey.current = detailKey
    setLoading(true)
    setError(null)
    void getValidatedWork(sessionId, etag)
      .then((result) => {
        if (cancelled) return
        if (result.status === 'ok') {
          setDetails(result.data)
          setEtag(result.etag)
        }
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [detailKey, etag, sessionId])

  const activeSummary = details?.summary ?? summary
  const state = details?.state ?? null
  const phase = activeSummary ? phaseLabels[activeSummary.phase] : 'Standard'
  const modeLabel = qualityModes[mode].label
  const checkSummary = useMemo(() => {
    if (!activeSummary) return 'No checks'
    const checks = activeSummary.counts.checks
    return `${checks.passed}/${activeSummary.counts.requirements} requirements with passed checks`
  }, [activeSummary])

  return (
    <div className='quality-widget'>
      <header className='quality-widget-header'>
        <div>
          <strong>Quality</strong>
          <span>{modeLabel} · {phase}</span>
        </div>
        <button
          aria-label='Switch to standard quality mode'
          disabled={mode === 'standard'}
          onClick={() => onModeChange('standard')}
          type='button'
        >
          Standard
        </button>
      </header>
      <p className='quality-widget-summary'>{checkSummary}</p>
      {loading && <p className='quality-muted'>Loading quality details…</p>}
      {error && <p className='quality-error' role='alert'>{error}</p>}
      <ReadinessCard state={state} summary={activeSummary} />
      <PlanSection state={state} />
      <TraceabilitySection state={state} />
      <ReviewSection revision={reviewRevision} sessionId={sessionId} />
    </div>
  )
}
