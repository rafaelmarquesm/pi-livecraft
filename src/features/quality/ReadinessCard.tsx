import type {
  ValidatedWorkStateV1,
  ValidatedWorkSummaryV1,
} from '../../../shared/validated-work.ts'
import { formatCheckCounts, phaseLabels, readinessLabels } from './quality-display.ts'

export function ReadinessCard({
  state,
  summary,
}: {
  state: ValidatedWorkStateV1 | null
  summary: ValidatedWorkSummaryV1 | null
}) {
  if (!summary) {
    return (
      <section className='quality-card empty'>
        <h3>Readiness</h3>
        <p>Standard mode is active. No validation state or extra token overhead is added.</p>
      </section>
    )
  }
  return (
    <section className='quality-card'>
      <h3>Readiness</h3>
      <div className='quality-readiness-row'>
        <strong>{readinessLabels[summary.readiness]}</strong>
        <span>{phaseLabels[summary.phase]}</span>
      </div>
      <dl className='quality-metrics'>
        <div>
          <dt>Intent</dt>
          <dd>{state?.intentState ?? 'uncertain'}</dd>
        </div>
        <div>
          <dt>Requirements</dt>
          <dd>{summary.counts.requirements}</dd>
        </div>
        <div>
          <dt>Tasks with evidence</dt>
          <dd>{summary.counts.completedItems}/{summary.counts.items}</dd>
        </div>
        <div>
          <dt>Checks</dt>
          <dd>{formatCheckCounts(summary.counts.checks)}</dd>
        </div>
        <div>
          <dt>Automation turns</dt>
          <dd>{summary.automation.extraTurns}/{summary.automation.maxExtraTurns}</dd>
        </div>
        <div>
          <dt>Budget status</dt>
          <dd>
            {summary.readiness === 'budget_stopped'
              ? 'Stopped at the configured budget'
              : 'Within preflight limits'}
          </dd>
        </div>
      </dl>
      {summary.blockers.length > 0 && (
        <ul className='quality-blockers'>
          {summary.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
        </ul>
      )}
    </section>
  )
}
