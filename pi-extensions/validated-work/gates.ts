import type { ValidatedWorkStateV1 } from '../../shared/validated-work.ts'
import { validatedWorkToolName, type ValidatedWorkConfigEntry } from './state.ts'

export interface ToolGateResult {
  block?: boolean
  reason?: string
  terminate?: boolean
}

export const planningToolAllowlist = [
  'read',
  'grep',
  'find',
  'ls',
  'ask_user_question',
  validatedWorkToolName,
] as const

export interface ToolController {
  getActiveTools(): string[]
  getAllTools(): { name: string }[]
  setActiveTools(toolNames: string[]): void
}

export function isActiveMode(state: Pick<ValidatedWorkStateV1, 'mode'>): boolean {
  return state.mode === 'plan' || state.mode === 'validated'
}

export function isPlanningPhase(state: Pick<ValidatedWorkStateV1, 'mode' | 'phase'>): boolean {
  return isActiveMode(state) && (state.phase === 'planning' || state.phase === 'awaiting_approval')
}

export function captureToolsBeforePlanning(pi: ToolController): string[] {
  return pi.getActiveTools().filter((name) => name !== validatedWorkToolName)
}

export function activatePlanningTools(pi: ToolController): void {
  const available = new Set(pi.getAllTools().map((tool) => tool.name))
  const active = planningToolAllowlist.filter((name) => available.has(name))
  pi.setActiveTools(active)
}

export function restorePlanningTools(
  pi: ToolController,
  config: Pick<ValidatedWorkConfigEntry, 'toolsBeforePlanning'>,
): boolean {
  if (!config.toolsBeforePlanning) return false
  pi.setActiveTools([...config.toolsBeforePlanning])
  return true
}

export function enforcePlanningToolGate(
  state: Pick<ValidatedWorkStateV1, 'mode' | 'phase'>,
  toolName: string | undefined,
): ToolGateResult | undefined {
  if (!isPlanningPhase(state)) return undefined
  if (toolName && (planningToolAllowlist as readonly string[]).includes(toolName)) return undefined
  return {
    block: true,
    terminate: true,
    reason: `Validated Work planning mode allows only read-only tools: ${
      planningToolAllowlist.join(', ')
    }.`,
  }
}
