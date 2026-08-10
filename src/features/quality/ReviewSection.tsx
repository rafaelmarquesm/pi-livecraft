import { useEffect, useMemo, useState } from 'react'
import {
  estimateCodeReview,
  getCodeReviews,
  runCodeReview,
  sendReviewFindings,
  updateReviewFinding,
} from '../../api.ts'
import type { CodeReviewDetailsResponse, CodeReviewFinding } from '../../../shared/code-review.ts'

const severityRank = { P0: 0, P1: 1, P2: 2, P3: 3 } as const
const confidenceRank = { high: 0, medium: 1, low: 2 } as const

export function ReviewSection({ revision, sessionId }: { revision: number; sessionId: string }) {
  const [details, setDetails] = useState<CodeReviewDetailsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [running, setRunning] = useState(false)
  const [provider, setProvider] = useState('anthropic')
  const [modelId, setModelId] = useState('claude-sonnet-4-20250514')
  const [thinkingLevel, setThinkingLevel] = useState('low')
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [dismissFinding, setDismissFinding] = useState<string | null>(null)
  const [dismissReason, setDismissReason] = useState('')
  const [estimate, setEstimate] = useState<
    { estimatedInputTokens: number; diffHash: string } | null
  >(null)
  const [confirmSend, setConfirmSend] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise
      .all([getCodeReviews(sessionId), estimateCodeReview(sessionId).catch(() => null)])
      .then(([reviewDetails, nextEstimate]) => {
        if (cancelled) return
        setDetails(reviewDetails)
        setEstimate(nextEstimate)
      })
      .catch((cause) => {
        if (!cancelled) setError(messageOf(cause))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [revision, sessionId])

  const latest = details?.reports[0] ?? null
  const findings = useMemo(() => [...(latest?.findings ?? [])].sort(compareFinding), [latest])
  const selectedFindings = findings.filter((finding) => selected.has(finding.id))
  const selectedPreview = selectedFindings
    .map((finding) =>
      `${finding.id} ${finding.severity}/${finding.confidence}: ${finding.title}\n${
        finding.path ?? 'n/a'
      }${finding.line ? `:${finding.line}` : ''}\n${finding.evidence}`
    )
    .join('\n\n')

  async function refresh(next?: CodeReviewDetailsResponse): Promise<void> {
    setDetails(next ?? await getCodeReviews(sessionId))
  }

  async function startReview(): Promise<void> {
    setRunning(true)
    setError(null)
    try {
      await refresh(
        await runCodeReview(sessionId, {
          mode: 'manual',
          model: { provider, modelId },
          thinkingLevel,
        }),
      )
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setRunning(false)
    }
  }

  async function decide(
    finding: CodeReviewFinding,
    status: 'confirmed' | 'dismissed',
  ): Promise<void> {
    if (!latest) return
    setError(null)
    try {
      await refresh(
        await updateReviewFinding(sessionId, latest.id, finding.id, {
          status,
          ...(status === 'dismissed' ? { reason: dismissReason.trim() } : {}),
        }),
      )
      setDismissFinding(null)
      setDismissReason('')
    } catch (cause) {
      setError(messageOf(cause))
    }
  }

  async function sendSelected(): Promise<void> {
    setError(null)
    try {
      const result = await sendReviewFindings(sessionId, { findingIds: [...selected] })
      await refresh(result.details)
      setSelected(new Set())
      setConfirmSend(false)
    } catch (cause) {
      setError(messageOf(cause))
    }
  }

  return (
    <section className='quality-card review-section' aria-live='polite'>
      <header className='review-header'>
        <div>
          <h3>Review</h3>
          <p>Status: {details?.status.replaceAll('_', ' ') ?? 'never run'}</p>
        </div>
        <button disabled={running} onClick={startReview} type='button'>
          {running ? 'Running…' : 'Run review'}
        </button>
      </header>
      <div className='review-runner-controls'>
        <label>
          Provider<input value={provider} onChange={(event) => setProvider(event.target.value)} />
        </label>
        <label>
          Model<input value={modelId} onChange={(event) => setModelId(event.target.value)} />
        </label>
        <label>
          Thinking<input
            value={thinkingLevel}
            onChange={(event) => setThinkingLevel(event.target.value)}
          />
        </label>
      </div>
      {estimate && (
        <p className='quality-muted'>
          Estimated review input: ~{estimate
            .estimatedInputTokens
            .toLocaleString()} tokens. Cost is an estimate until Pi reports final usage. Diff{' '}
          {estimate.diffHash.slice(0, 18)}…
        </p>
      )}
      {latest && (
        <dl className='quality-metrics'>
          <div>
            <dt>Model</dt>
            <dd>{latest.provider}/{latest.model}</dd>
          </div>
          <div>
            <dt>Reasoning</dt>
            <dd>{latest.thinking}</dd>
          </div>
          <div>
            <dt>Duration</dt>
            <dd>{Math.round(latest.durationMs / 1000)}s</dd>
          </div>
          <div>
            <dt>Cost</dt>
            <dd>${latest.usage.costUsd.toFixed(4)}</dd>
          </div>
        </dl>
      )}
      {loading && <p className='quality-muted'>Loading review…</p>}
      {error && <p className='quality-error' role='alert'>{error}</p>}
      {!loading && findings.length === 0 && <p className='quality-muted'>No findings recorded.</p>}
      {findings.length > 0 && (
        <ul className='review-findings'>
          {findings.map((finding) => (
            <li key={finding.id}>
              <label className='review-select'>
                <input
                  checked={selected.has(finding.id)}
                  onChange={(event) => {
                    setSelected((current) => {
                      const next = new Set(current)
                      if (event.target.checked) next.add(finding.id)
                      else next.delete(finding.id)
                      return next
                    })
                  }}
                  type='checkbox'
                />
                Select
              </label>
              <strong>{finding.severity} · {finding.confidence} · {finding.title}</strong>
              <small>
                {finding.path ?? 'No path'}
                {finding.line
                  ? `:${finding.line}`
                  : ''} · {finding.status}
              </small>
              <p>{finding.evidence}</p>
              <p>{finding.recommendation}</p>
              <div className='review-actions'>
                <button
                  disabled={finding.status === 'confirmed'}
                  onClick={() => void decide(finding, 'confirmed')}
                  type='button'
                >
                  Confirm
                </button>
                <button onClick={() => setDismissFinding(finding.id)} type='button'>
                  Dismiss with reason
                </button>
              </div>
              {dismissFinding === finding.id && (
                <div className='review-dismiss'>
                  <label>
                    Dismissal reason<textarea
                      value={dismissReason}
                      onChange={(event) => setDismissReason(event.target.value)}
                    />
                  </label>
                  <button
                    disabled={!dismissReason.trim()}
                    onClick={() => void decide(finding, 'dismissed')}
                    type='button'
                  >
                    Dismiss
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {selectedFindings.length > 0 && (
        <div className='review-send'>
          <button onClick={() => setConfirmSend(true)} type='button'>Send selected to agent</button>
          {confirmSend && (
            <div
              className='review-send-confirm'
              role='dialog'
              aria-label='Confirm selected review findings'
            >
              <p>
                Estimated prompt input: ~{Math.ceil(selectedPreview.length / 4).toLocaleString()}
                {' '}
                tokens. The agent will verify before editing.
              </p>
              <pre>{selectedPreview}</pre>
              <button onClick={() => void sendSelected()} type='button'>
                Confirm send selected
              </button>
              <button onClick={() => setConfirmSend(false)} type='button'>Cancel</button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function compareFinding(left: CodeReviewFinding, right: CodeReviewFinding): number {
  return severityRank[left.severity] - severityRank[right.severity]
    || confidenceRank[left.confidence] - confidenceRank[right.confidence]
    || left.id.localeCompare(right.id)
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
