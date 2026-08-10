import type { ValidatedWorkStateV1 } from '../../../shared/validated-work.ts'
import { checkStatusLabels } from './quality-display.ts'
import { requirementTraceability } from './quality-state.ts'

export function TraceabilitySection({ state }: { state: ValidatedWorkStateV1 | null }) {
  if (!state) {
    return (
      <section className='quality-card'>
        <h3>Traceability</h3>
        <p>Traceability appears after a plan records requirements and checks.</p>
      </section>
    )
  }
  const rows = requirementTraceability(state)
  return (
    <section className='quality-card'>
      <h3>Traceability</h3>
      {rows.length === 0
        ? <p>No requirements to trace yet.</p>
        : (
          <table className='quality-traceability-table'>
            <thead>
              <tr>
                <th>Requirement</th>
                <th>Checks</th>
                <th>Evidence</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.requirementId}>
                  <th scope='row'>
                    {row.requirementId}
                    <small>{row.requirement}</small>
                  </th>
                  <td>{row.checks.length > 0 ? row.checks.join(', ') : 'No mapped check'}</td>
                  <td>
                    {row.evidence.length > 0 ? row.evidence.join(', ') : 'No linked evidence'}
                  </td>
                  <td>{row.state}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      <h4>Checks</h4>
      <ul className='quality-checks'>
        {state.checks.length === 0
          ? <li>No checks recorded yet.</li>
          : state.checks.slice(0, 50).map((check) => (
            <li key={check.id}>
              <strong>{check.id}</strong> {check.text}
              <small>{checkStatusLabels[check.status]}</small>
            </li>
          ))}
      </ul>
    </section>
  )
}
