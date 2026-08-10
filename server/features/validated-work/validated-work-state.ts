import type { JsonObject } from '../../../shared/types.ts'
import {
  buildSummary,
  reconstructValidatedWork,
  type BranchEntryLike,
} from '../../../pi-extensions/validated-work/state.ts'
import type {
  ValidatedWorkDetailsResponse,
  ValidatedWorkStateV1,
} from '../../../shared/validated-work.ts'

export interface ValidatedWorkExtraction {
  response: ValidatedWorkDetailsResponse
  revision: number
  etag: string
  ignoredSnapshots: number
}

/** Reconstructs the active-branch validated-work state from cached Pi session entries. */
export function extractValidatedWorkDetails(
  sessionId: string,
  entries: readonly JsonObject[],
  reviewRevision = 0,
): ValidatedWorkExtraction {
  const reconstructed = reconstructValidatedWork(entries as BranchEntryLike[])
  const active = reconstructed.state.mode === 'standard' ? null : reconstructed.state
  const summary = active ? buildSummary(active) : null
  const revision = active?.revision ?? 0
  return {
    response: {
      state: active,
      summary,
      review: null,
      stale: false,
    },
    revision,
    etag: validatedWorkEtag(sessionId, revision, reviewRevision),
    ignoredSnapshots: reconstructed.ignoredSnapshots,
  }
}

export function validatedWorkEtag(sessionId: string, revision: number, reviewRevision = 0): string {
  return `W/"validated-work:${encodeURIComponent(sessionId)}:${revision}:${reviewRevision}"`
}

export function traceabilityRows(state: ValidatedWorkStateV1): Array<{
  requirementId: string
  requirement: string
  checks: string[]
  evidence: string[]
}> {
  return state.requirements.map((requirement) => {
    const checks = state.checks.filter((check) => check.requirementIds.includes(requirement.id))
    const evidenceIds = new Set(checks.flatMap((check) => check.evidenceIds))
    return {
      requirementId: requirement.id,
      requirement: requirement.text,
      checks: checks.map((check) => check.id),
      evidence: state.evidence.filter((item) => evidenceIds.has(item.id)).map((item) => item.id),
    }
  })
}
