import type {
  CheckStatus,
  Readiness,
  ValidatedWorkMode,
  WorkPhase,
} from '../../../shared/validated-work.ts'

export const qualityModes: Record<
  ValidatedWorkMode,
  { label: string; shortLabel: string; description: string }
> = {
  standard: {
    label: 'Standard',
    shortLabel: 'Std',
    description: 'Current behavior with zero additional validation tokens.',
  },
  plan: {
    label: 'Plan first',
    shortLabel: 'Plan',
    description: 'Read-only planning, then approval before writes.',
  },
  validated: {
    label: 'Validated',
    shortLabel: 'Val',
    description: 'Plan first plus experimental evidence tracking. Experimental.',
  },
}

export const phaseLabels: Record<WorkPhase, string> = {
  idle: 'Idle',
  planning: 'Planning',
  awaiting_approval: 'Awaiting approval',
  executing: 'Executing',
  reviewing: 'Reviewing',
  blocked: 'Blocked',
  complete: 'Complete',
}

export const readinessLabels: Record<Readiness, string> = {
  not_ready: 'Not ready',
  needs_evidence: 'Needs evidence',
  needs_review: 'Needs review',
  ready: 'Ready',
  budget_stopped: 'Budget stopped',
}

export const checkStatusLabels: Record<CheckStatus, string> = {
  pending: 'Pending',
  passed: 'Passed',
  failed: 'Failed',
  blocked: 'Blocked',
}

export function formatCheckCounts(counts: Record<CheckStatus, number>): string {
  return `${counts.passed} passed, ${counts.failed} failed, ${counts.blocked} blocked, ${counts.pending} pending`
}
