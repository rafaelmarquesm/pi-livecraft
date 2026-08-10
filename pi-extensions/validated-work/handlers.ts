import type { ValidatedWorkStateV1 } from '../../shared/validated-work.ts'
import { planningSystemPrompt } from './prompt.ts'

/** Hot handler path. Standard mode must return without adding prompt content. */
export function beforeValidatedWorkAgentStart(
  state: ValidatedWorkStateV1,
): { systemPrompt: string } | undefined {
  if (
    state.mode === 'standard'
    || (state.phase !== 'planning' && state.phase !== 'awaiting_approval')
  ) {
    return undefined
  }
  return { systemPrompt: planningSystemPrompt }
}
