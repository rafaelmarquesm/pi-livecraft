import { useEffect, useRef, useState } from 'react'
import type { ValidatedWorkStateV1 } from '../../../shared/validated-work.ts'

export function PlanApprovalDialog({
  loading,
  onApprove,
  onCancelMode,
  onKeepPlanning,
  onRequestChanges,
  state,
}: {
  loading?: boolean
  onApprove: () => Promise<void>
  onCancelMode: () => Promise<void>
  onKeepPlanning: () => void
  onRequestChanges: (message: string) => Promise<void>
  state: ValidatedWorkStateV1 | null
}) {
  const [changes, setChanges] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState<'approve' | 'cancel' | 'changes' | null>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  async function run(action: 'approve' | 'cancel' | 'changes'): Promise<void> {
    setSubmitting(action)
    setError(null)
    try {
      if (action === 'approve') await onApprove()
      else if (action === 'cancel') await onCancelMode()
      else await onRequestChanges(changes)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSubmitting(null)
    }
  }

  return (
    <div className='quality-dialog-backdrop' role='presentation'>
      <section
        aria-describedby='quality-plan-approval-description'
        aria-labelledby='quality-plan-approval-title'
        className='quality-plan-dialog'
        role='dialog'
      >
        <header>
          <span>Plan first</span>
          <h2 id='quality-plan-approval-title'>Approve plan before execution</h2>
          <p id='quality-plan-approval-description'>
            Review the read-only plan. Only this UI can approve execution.
          </p>
        </header>
        {loading && <p className='quality-muted'>Loading plan details…</p>}
        {state && (
          <div className='quality-plan-dialog-body'>
            <section>
              <h3>Interpreted intent</h3>
              <p>{state.userIntent || 'No intent recorded yet.'}</p>
            </section>
            <section>
              <h3>Requirements</h3>
              <ul>
                {state.requirements.length === 0
                  ? <li>No requirements recorded yet.</li>
                  : state.requirements.map((requirement) => (
                    <li key={requirement.id}>
                      <strong>{requirement.id}</strong> {requirement.text}
                      <small>{requirement.source}</small>
                    </li>
                  ))}
              </ul>
            </section>
            <section>
              <h3>Goals and tasks</h3>
              <ul>
                {state.items.length === 0
                  ? <li>No tasks recorded yet.</li>
                  : state.items.map((item) => (
                    <li key={item.id}>
                      <strong>{item.id}</strong> {item.text}
                      <small>{item.status}</small>
                    </li>
                  ))}
              </ul>
            </section>
            <section>
              <h3>Checks</h3>
              <ul>
                {state.checks.length === 0
                  ? <li>No checks recorded yet.</li>
                  : state.checks.map((check) => (
                    <li key={check.id}>
                      <strong>{check.id}</strong> {check.text}
                    </li>
                  ))}
              </ul>
            </section>
            {state.assumptions.length > 0 && (
              <section>
                <h3>Risks and assumptions</h3>
                <ul>
                  {state.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}
                </ul>
              </section>
            )}
          </div>
        )}
        <label className='quality-request-changes'>
          Request changes
          <textarea
            aria-label='Plan change request'
            onChange={(event) => setChanges(event.target.value)}
            placeholder='Ask the agent to adjust the plan while staying read-only.'
            value={changes}
          />
        </label>
        {error && <p className='quality-error' role='alert'>{error}</p>}
        <div className='quality-dialog-actions'>
          <button
            className='primary'
            disabled={submitting !== null}
            onClick={() => void run('approve')}
            type='button'
          >
            {submitting === 'approve' ? 'Approving…' : 'Approve and execute'}
          </button>
          <button
            disabled={changes.trim() === '' || submitting !== null}
            onClick={() => void run('changes')}
            type='button'
          >
            {submitting === 'changes' ? 'Sending…' : 'Request changes'}
          </button>
          <button onClick={onKeepPlanning} ref={closeRef} type='button'>Keep planning</button>
          <button
            className='danger'
            disabled={submitting !== null}
            onClick={() => void run('cancel')}
            type='button'
          >
            {submitting === 'cancel' ? 'Cancelling…' : 'Cancel mode'}
          </button>
        </div>
      </section>
    </div>
  )
}
