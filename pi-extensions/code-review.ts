import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { CODE_REVIEW_PROTOCOL, CODE_REVIEW_VERSION } from '../shared/code-review.ts'

export default function registerCodeReview(pi: ExtensionAPI): void {
  pi.on('session_start', () => {
    pi.registerTool({
      name: 'submit_code_review',
      label: 'Submit Code Review',
      description: 'Submit the final structured independent code review findings.',
      promptSnippet:
        'Submit code review findings with severity, confidence, evidence, and recommendations.',
      promptGuidelines: [
        'Call exactly once as the final answer.',
        'Submit zero findings when there is no concrete issue.',
        'Do not include pure style opinions or invented test results.',
      ],
      parameters: Type.Object({
        reviewedRequirementIds: Type.Optional(Type.Array(Type.String())),
        validityStatus: Type.Optional(Type.Union([
          Type.Literal('valid'),
          Type.Literal('invalid'),
          Type.Literal('stale'),
          Type.Literal('failed'),
        ])),
        validityReason: Type.Optional(Type.String()),
        findings: Type.Array(Type.Object({
          severity: Type.Union([
            Type.Literal('P0'),
            Type.Literal('P1'),
            Type.Literal('P2'),
            Type.Literal('P3'),
          ]),
          confidence: Type.Union([
            Type.Literal('low'),
            Type.Literal('medium'),
            Type.Literal('high'),
          ]),
          title: Type.String(),
          path: Type.Optional(Type.String()),
          line: Type.Optional(Type.Number()),
          requirementIds: Type.Array(Type.String()),
          evidence: Type.String(),
          recommendation: Type.String(),
        })),
      }),
      async execute(_toolCallId, params) {
        const details = normalizeSubmission(params)
        return {
          content: [{
            type: 'text' as const,
            text: `Submitted ${details.findings.length} review findings.`,
          }],
          details,
        }
      },
    })
  })
}

function normalizeSubmission(params: {
  reviewedRequirementIds?: unknown
  validityStatus?: unknown
  validityReason?: unknown
  findings?: unknown
}) {
  const findings = Array.isArray(params.findings)
    ? params.findings.slice(0, 50).flatMap(normalizeFinding)
    : []
  return {
    protocol: CODE_REVIEW_PROTOCOL,
    version: CODE_REVIEW_VERSION,
    reviewedRequirementIds: Array.isArray(params.reviewedRequirementIds)
      ? params.reviewedRequirementIds.filter(isId).slice(0, 50)
      : [],
    validityStatus: isValidity(params.validityStatus) ? params.validityStatus : 'valid',
    ...(typeof params.validityReason === 'string'
      ? { validityReason: params.validityReason.slice(0, 2_000) }
      : {}),
    findings,
  }
}

function normalizeFinding(value: unknown) {
  if (!value || typeof value !== 'object') return []
  const item = value as Record<string, unknown>
  if (!isSeverity(item.severity) || !isConfidence(item.confidence)) return []
  if (typeof item.title !== 'string' || typeof item.evidence !== 'string') return []
  if (typeof item.recommendation !== 'string') return []
  return [{
    severity: item.severity,
    confidence: item.confidence,
    title: item.title.slice(0, 2_000),
    ...(typeof item.path === 'string' ? { path: item.path.slice(0, 2_000) } : {}),
    ...(typeof item.line === 'number' && Number.isSafeInteger(item.line) && item.line > 0
      ? { line: item.line }
      : {}),
    requirementIds: Array.isArray(item.requirementIds) ? item.requirementIds.filter(isId) : [],
    evidence: item.evidence.slice(0, 4_000),
    recommendation: item.recommendation.slice(0, 2_000),
  }]
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9._-]{1,80}$/.test(value)
}

function isSeverity(value: unknown): value is 'P0' | 'P1' | 'P2' | 'P3' {
  return value === 'P0' || value === 'P1' || value === 'P2' || value === 'P3'
}

function isConfidence(value: unknown): value is 'low' | 'medium' | 'high' {
  return value === 'low' || value === 'medium' || value === 'high'
}

function isValidity(value: unknown): value is 'valid' | 'invalid' | 'stale' | 'failed' {
  return value === 'valid' || value === 'invalid' || value === 'stale' || value === 'failed'
}
