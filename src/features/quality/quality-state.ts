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
  checks: string[]
  evidence: string[]
  state: string
}> {
  return state
    .requirements
    .map((requirement) => {
      const checks = state.checks.filter((check) => check.requirementIds.includes(requirement.id))
      const evidence = new Set(checks.flatMap((check) => check.evidenceIds))
      const stateText = checks.length === 0
        ? 'Missing check'
        : checks.some((check) => check.status === 'passed' && check.evidenceIds.length > 0)
        ? 'Passed with evidence'
        : checks.some((check) => check.status === 'failed')
        ? 'Failed'
        : checks.some((check) => check.status === 'blocked')
        ? 'Blocked'
        : 'Pending evidence'
      return {
        requirementId: requirement.id,
        requirement: requirement.text,
        checks: checks.map((check) => check.id),
        evidence: [...evidence],
        state: stateText,
      }
    })
    .sort((left, right) => Number(left.checks.length > 0) - Number(right.checks.length > 0))
}
