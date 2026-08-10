import {
  applyValidatedWorkAction,
  approveState,
  buildSummary,
  createInitialState,
} from '../pi-extensions/validated-work/state.ts'
import type { ValidatedWorkDetailsResponse } from '../shared/validated-work.ts'

export function awaitingPlanDetails(): ValidatedWorkDetailsResponse {
  let state = createInitialState('plan', 1)
  state = applyValidatedWorkAction(state, {
    action: 'replace_plan',
    userIntent: 'Implement the requested workflow safely.',
    intentState: 'clear',
    requirements: [
      { id: 'r1', text: 'Add plan-first approval before execution.', source: 'explicit' },
      { id: 'r2', text: 'Keep standard mode zero-overhead.', source: 'explicit' },
    ],
    goals: [{ id: 'g1', title: 'Planning UI', requirementIds: ['r1'], status: 'pending' }],
    items: [{
      id: 't1',
      goalId: 'g1',
      requirementIds: ['r1'],
      text: 'Wire approval dialog actions.',
      status: 'pending',
      confidence: 'plausible',
    }],
    checks: [{
      id: 'c1',
      requirementIds: ['r1'],
      itemIds: ['t1'],
      text: 'Playwright covers approve/request changes/cancel.',
      status: 'pending',
      evidenceIds: [],
    }],
    assumptions: ['Approval should restore write tools only after the user approves.'],
  }, 2)
  state = applyValidatedWorkAction(state, { action: 'submit_for_approval' }, 3)
  return { state, summary: buildSummary(state), review: null, stale: false }
}

export function executingPlanDetails(): ValidatedWorkDetailsResponse {
  const awaiting = awaitingPlanDetails().state
  const state = awaiting ? approveState(awaiting, 4) : null
  return { state, summary: state ? buildSummary(state) : null, review: null, stale: false }
}

export const standardDetails: ValidatedWorkDetailsResponse = {
  state: null,
  summary: null,
  review: null,
  stale: false,
}
