import { createHash, randomUUID } from 'node:crypto'
import { isObject } from '../../../shared/is-object.ts'
import {
  CODE_REVIEW_PROTOCOL,
  CODE_REVIEW_VERSION,
  type CodeReviewFinding,
  type CodeReviewReportV1,
  type CodeReviewUsage,
  type CodeReviewValidityStatus,
} from '../../../shared/code-review.ts'
import type { CodeReviewPacket } from './packet-builder.ts'

export interface ReviewerRunResult {
  text: string
  operationId: string
  stats: {
    provider?: string
    model?: string
    thinking?: string
    durationMs: number
    usage: CodeReviewUsage & { totalTokens?: number }
  }
  toolDetails: unknown[]
}

interface SubmittedFinding {
  severity: CodeReviewFinding['severity']
  confidence: CodeReviewFinding['confidence']
  title: string
  path?: string
  line?: number
  requirementIds: string[]
  evidence: string
  recommendation: string
}

interface SubmittedReview {
  reviewedRequirementIds?: string[]
  findings: SubmittedFinding[]
  validityStatus?: CodeReviewValidityStatus
  validityReason?: string
}

export function reportFromReviewerOutput(
  result: ReviewerRunResult,
  packet: CodeReviewPacket,
  cycleId: string,
  startedAt: number,
): CodeReviewReportV1 {
  const submitted = findSubmittedReview(result.toolDetails) ?? emptySubmittedReview(result.text)
  const completedAt = Date.now()
  const reviewedRequirementIds = submitted.reviewedRequirementIds?.length
    ? [...new Set(submitted.reviewedRequirementIds)]
    : undefined
  const findings = submitted.findings.slice(0, 50).map((finding, index): CodeReviewFinding => {
    const id = `f${index + 1}`
    return {
      id,
      severity: finding.severity,
      confidence: finding.confidence,
      title: limit(finding.title, 2_000),
      ...(finding.path ? { path: limit(finding.path, 2_000) } : {}),
      ...(finding.line ? { line: finding.line } : {}),
      requirementIds: finding.requirementIds,
      evidence: limit(finding.evidence, 4_000),
      recommendation: limit(finding.recommendation, 2_000),
      fingerprint: findingFingerprint(packet.diffHash, finding),
      status: 'open',
    }
  })
  return {
    protocol: CODE_REVIEW_PROTOCOL,
    version: CODE_REVIEW_VERSION,
    id: `review-${randomUUID()}`,
    cycleId,
    model: result.stats.model ?? 'unknown',
    provider: result.stats.provider ?? 'unknown',
    thinking: result.stats.thinking ?? 'unknown',
    diffHash: packet.diffHash,
    baseRevision: revisionFromSha(packet.baseSha),
    createdAt: startedAt,
    completedAt,
    durationMs: result.stats.durationMs,
    usage: {
      inputTokens: result.stats.usage.inputTokens,
      outputTokens: result.stats.usage.outputTokens,
      cacheReadTokens: result.stats.usage.cacheReadTokens,
      cacheWriteTokens: result.stats.usage.cacheWriteTokens,
      costUsd: result.stats.usage.costUsd,
    },
    truncation: {
      diff: packet.truncation.diffBytes >= packet.truncation.diffBytesLimit,
      files: packet.truncation.omittedPaths.some((path) => path.reason === 'path_limit'),
      findings: submitted.findings.length > findings.length,
      output: false,
    },
    ...(reviewedRequirementIds ? { reviewedRequirementIds } : {}),
    findings,
    validityStatus: submitted.validityStatus ?? 'valid',
    ...(submitted.validityReason ? { validityReason: limit(submitted.validityReason, 2_000) } : {}),
  }
}

function findSubmittedReview(toolDetails: readonly unknown[]): SubmittedReview | undefined {
  for (const detail of toolDetails) {
    const candidate = findDetailsObject(detail)
    if (candidate) return candidate
  }
  return undefined
}

function findDetailsObject(value: unknown): SubmittedReview | undefined {
  if (!isObject(value)) return undefined
  if (value.protocol === CODE_REVIEW_PROTOCOL && value.version === CODE_REVIEW_VERSION) {
    return parseSubmittedReview(value)
  }
  for (const key of ['details', 'data', 'result']) {
    const found = findDetailsObject(value[key])
    if (found) return found
  }
  return undefined
}

function parseSubmittedReview(value: Record<string, unknown>): SubmittedReview | undefined {
  if (!Array.isArray(value.findings)) return undefined
  const findings = value.findings.flatMap((item): SubmittedFinding[] => {
    if (!isObject(item)) return []
    if (!isSeverity(item.severity) || !isConfidence(item.confidence)) return []
    if (typeof item.title !== 'string' || typeof item.evidence !== 'string') return []
    if (typeof item.recommendation !== 'string') return []
    const line = Number.isSafeInteger(item.line) && typeof item.line === 'number' && item.line > 0
      ? item.line
      : undefined
    const requirementIds = Array.isArray(item.requirementIds)
      ? item.requirementIds.filter((id): id is string =>
        typeof id === 'string' && /^[a-zA-Z0-9._-]{1,80}$/.test(id)
      )
      : []
    return [{
      severity: item.severity,
      confidence: item.confidence,
      title: item.title,
      ...(typeof item.path === 'string' ? { path: item.path } : {}),
      ...(line ? { line } : {}),
      requirementIds,
      evidence: item.evidence,
      recommendation: item.recommendation,
    }]
  })
  return {
    findings,
    reviewedRequirementIds: Array.isArray(value.reviewedRequirementIds)
      ? value.reviewedRequirementIds.filter((id): id is string => typeof id === 'string')
      : undefined,
    validityStatus: isValidity(value.validityStatus) ? value.validityStatus : 'valid',
    validityReason: typeof value.validityReason === 'string' ? value.validityReason : undefined,
  }
}

function emptySubmittedReview(text: string): SubmittedReview {
  return {
    findings: [],
    validityStatus: text.trim() ? 'valid' : 'failed',
    validityReason: text.trim()
      ? 'Reviewer returned text without structured findings.'
      : 'Reviewer returned no structured output.',
  }
}

function findingFingerprint(diffHash: string, finding: SubmittedFinding): string {
  const canonical = JSON.stringify({
    diffHash,
    severity: finding.severity,
    title: finding.title.trim(),
    path: finding.path ?? '',
    line: finding.line ?? 0,
    evidence: finding.evidence.trim(),
    recommendation: finding.recommendation.trim(),
  })
  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`
}

function revisionFromSha(value: string): number {
  const digest = createHash('sha256').update(value).digest().readUInt32BE(0)
  return Number.isSafeInteger(digest) ? digest : 0
}

function limit(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value
}

function isSeverity(value: unknown): value is CodeReviewFinding['severity'] {
  return value === 'P0' || value === 'P1' || value === 'P2' || value === 'P3'
}

function isConfidence(value: unknown): value is CodeReviewFinding['confidence'] {
  return value === 'low' || value === 'medium' || value === 'high'
}

function isValidity(value: unknown): value is CodeReviewValidityStatus {
  return value === 'valid' || value === 'invalid' || value === 'stale' || value === 'failed'
}
