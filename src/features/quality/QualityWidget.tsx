import { Profiler, type ProfilerOnRenderCallback, useEffect, useMemo, useState } from 'react'
import { getValidatedWork, listQualityCampaigns } from '../../api.ts'
import type { QualityCampaignListItem } from '../../../shared/quality-campaigns.ts'
import type {
  ValidatedWorkDetailsResponse,
  ValidatedWorkMode,
  ValidatedWorkSummaryV1,
} from '../../../shared/validated-work.ts'
import { phaseLabels, qualityModes } from './quality-display.ts'
import { CampaignsSection } from './CampaignsSection.tsx'
import { PlanSection } from './PlanSection.tsx'
import { ReadinessCard } from './ReadinessCard.tsx'
import { ReviewSection } from './ReviewSection.tsx'
import { TraceabilitySection } from './TraceabilitySection.tsx'

interface QualityWidgetProps {
  mode: ValidatedWorkMode
  onModeChange: (mode: ValidatedWorkMode) => void
  reviewRevision: number
  sessionId: string
  summary: ValidatedWorkSummaryV1 | null
}

interface QualityBenchmarkWindow extends Window {
  __PI_LIVECRAFT_QUALITY_BENCHMARK__?: {
    commits: Array<{
      actualDuration: number
      baseDuration: number
      commitTime: number
      phase: string
      startTime: number
    }>
  }
}

const recordQualityCommit: ProfilerOnRenderCallback = (
  _id,
  phase,
  actualDuration,
  baseDuration,
  startTime,
  commitTime,
) => {
  if (phase === 'mount') return
  const benchmark = (window as QualityBenchmarkWindow).__PI_LIVECRAFT_QUALITY_BENCHMARK__ ??= {
    commits: [],
  }
  benchmark.commits.push({ actualDuration, baseDuration, commitTime, phase, startTime })
}

function QualityWidgetContent({
  mode,
  onModeChange,
  reviewRevision,
  sessionId,
  summary,
}: QualityWidgetProps) {
  const [campaigns, setCampaigns] = useState<QualityCampaignListItem[]>([])
  const [campaignsError, setCampaignsError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'work' | 'campaigns'>('work')
  const [details, setDetails] = useState<
    {
      data: ValidatedWorkDetailsResponse
      etag: string | null
      sessionId: string
    } | null
  >(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const detailKey = `${sessionId}:${summary?.revision ?? 'standard'}`
  const activeDetails = details?.sessionId === sessionId ? details : null
  const activeEtag = activeDetails?.etag ?? null

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    void getValidatedWork(sessionId, activeEtag)
      .then((result) => {
        if (cancelled) return
        if (result.status === 'ok') {
          setDetails({ data: result.data, etag: result.etag, sessionId })
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
  }, [activeEtag, detailKey, sessionId])

  useEffect(() => {
    let cancelled = false
    void listQualityCampaigns()
      .then(({ campaigns: nextCampaigns }) => {
        if (cancelled) return
        setCampaigns(nextCampaigns)
        if (nextCampaigns.length === 0) setActiveTab('work')
      })
      .catch((cause) => {
        if (!cancelled) setCampaignsError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => {
      cancelled = true
    }
  }, [])

  const activeSummary = activeDetails?.data.summary ?? summary
  const state = activeDetails?.data.state ?? null
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
      {campaigns.length > 0 && (
        <div className='quality-tabs' role='tablist' aria-label='Quality sections'>
          <button
            aria-selected={activeTab === 'work'}
            onClick={() =>
              setActiveTab('work')}
            role='tab'
            type='button'
          >
            Work
          </button>
          <button
            aria-selected={activeTab === 'campaigns'}
            onClick={() =>
              setActiveTab('campaigns')}
            role='tab'
            type='button'
          >
            Campaigns
            <small>
              {campaigns
                .length}
            </small>
          </button>
        </div>
      )}
      {campaignsError && <p className='quality-error' role='alert'>{campaignsError}</p>}
      {activeTab === 'work'
        ? (
          <>
            <ReadinessCard state={state} summary={activeSummary} />
            <PlanSection state={state} />
            <TraceabilitySection state={state} />
            <ReviewSection revision={reviewRevision} sessionId={sessionId} />
          </>
        )
        : <CampaignsSection campaigns={campaigns} />}
    </div>
  )
}

function ProfiledQualityWidget(props: QualityWidgetProps) {
  return (
    <Profiler id='QualityWidget' onRender={recordQualityCommit}>
      <QualityWidgetContent {...props} />
    </Profiler>
  )
}

export const QualityWidget = import.meta.env.VITE_QUALITY_BENCHMARK === '1'
  ? ProfiledQualityWidget
  : QualityWidgetContent
