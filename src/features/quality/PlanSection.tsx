import type { ValidatedWorkStateV1 } from '../../../shared/validated-work.ts'

export function PlanSection({ state }: { state: ValidatedWorkStateV1 | null }) {
  if (!state) {
    return (
      <section className='quality-card'>
        <h3>Plan</h3>
        <p>No plan has been requested for this session.</p>
      </section>
    )
  }
  return (
    <section className='quality-card'>
      <h3>Plan</h3>
      {state.userIntent && <p className='quality-intent'>{state.userIntent}</p>}
      <div className='quality-plan-columns'>
        <div>
          <h4>Requirements</h4>
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
        </div>
        <div>
          <h4>Tasks</h4>
          <ul>
            {state.items.length === 0
              ? <li>No tasks recorded yet.</li>
              : state.items.slice(0, 50).map((item) => (
                <li key={item.id}>
                  <strong>{item.id}</strong> {item.text}
                  <small>{item.status} · {item.confidence}</small>
                </li>
              ))}
          </ul>
          {state.items.length > 50 && <p>Showing first 50 tasks.</p>}
        </div>
      </div>
      {state.assumptions.length > 0 && (
        <details>
          <summary>Risks and assumptions</summary>
          <ul>{state.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}</ul>
        </details>
      )}
    </section>
  )
}
