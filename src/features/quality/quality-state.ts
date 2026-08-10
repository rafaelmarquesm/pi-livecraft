import {
  parseValidatedWorkSummaryV1,
  type ValidatedWorkMode,
  type ValidatedWorkStateV1,
  type ValidatedWorkSummaryV1,
} from '../../../shared/validated-work.ts'

export const qualityAcknowledgementKey = 'pi-livecraft.quality.first-use-acknowledged'

export function parseQualitySummaryStatus(statusText: unknown): ValidatedWorkSummaryV1 | null {
  if (typeof statusText !== 'string' || statusText.trim() === '') return null
  try {
    return parseValidatedWorkSummaryV1(JSON.parse(statusText))
  } catch {
    return null
  }
}

export function modeFromSummary(
  summary: ValidatedWorkSummaryV1 | null | undefined,
): ValidatedWorkMode {
  return summary?.mode ?? 'standard'
}

export function requirementTraceability(state: ValidatedWorkStateV1): Array<{
  requirementId: string
  requirement: string
  checks: number
  evidence: number
}> {
  return state.requirements.map((requirement) => {
    const checks = state.checks.filter((check) => check.requirementIds.includes(requirement.id))
    const evidence = new Set(checks.flatMap((check) => check.evidenceIds))
    return {
      requirementId: requirement.id,
      requirement: requirement.text,
      checks: checks.length,
      evidence: evidence.size,
    }
  })
}
