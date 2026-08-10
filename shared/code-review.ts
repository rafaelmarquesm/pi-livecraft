import { isObject } from './is-object.ts'
import {
  REVIEW_CONFIDENCES,
  REVIEW_SEVERITIES,
  type ReviewConfidence,
  type ReviewSeverity,
  VALIDATED_WORK_LIMITS,
} from './validated-work.ts'

export const CODE_REVIEW_PROTOCOL = 'pi-livecraft.code-review'
export const CODE_REVIEW_VERSION = 1

export const CODE_REVIEW_FINDING_LIMIT = 50

export const CODE_REVIEW_FINDING_STATUSES = [
  'open',
  'confirmed',
  'dismissed',
  'sent_to_agent',
  'resolved',
] as const
export type CodeReviewFindingStatus = typeof CODE_REVIEW_FINDING_STATUSES[number]

export const CODE_REVIEW_VALIDITY_STATUSES = ['valid', 'invalid', 'stale', 'failed'] as const
export type CodeReviewValidityStatus = typeof CODE_REVIEW_VALIDITY_STATUSES[number]

export const USAGE_PURPOSES = [
  'main',
  'automated_validation',
  'code_review',
  'prompt_improvement',
  'other_isolated',
] as const
export type UsagePurpose = typeof USAGE_PURPOSES[number]
export type NormalizedUsagePurpose = UsagePurpose | 'unknown'

export interface CodeReviewFinding {
  id: string
  severity: ReviewSeverity
  confidence: ReviewConfidence
  title: string
  path?: string
  line?: number
  requirementIds: string[]
  evidence: string
  recommendation: string
  fingerprint: string
  status: CodeReviewFindingStatus
  dismissalReason?: string
}

export interface CodeReviewUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  costUsd: number
}

export interface CodeReviewTruncationFlags {
  diff: boolean
  files: boolean
  findings: boolean
  output: boolean
}

export interface CodeReviewReportV1 {
  protocol: typeof CODE_REVIEW_PROTOCOL
  version: typeof CODE_REVIEW_VERSION
  id: string
  cycleId: string
  model: string
  provider: string
  thinking: string
  diffHash: string
  baseRevision: number
  createdAt: number
  completedAt: number
  durationMs: number
  usage: CodeReviewUsage
  truncation: CodeReviewTruncationFlags
  reviewedRequirementIds?: string[]
  findings: CodeReviewFinding[]
  validityStatus: CodeReviewValidityStatus
  validityReason?: string
}

export class CodeReviewParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CodeReviewParseError'
  }
}

export function parseCodeReviewReportV1(value: unknown): CodeReviewReportV1 {
  assertSerializedSize(value, '$')
  const root = objectWithKeys(value, '$', [
    'protocol',
    'version',
    'id',
    'cycleId',
    'model',
    'provider',
    'thinking',
    'diffHash',
    'baseRevision',
    'createdAt',
    'completedAt',
    'durationMs',
    'usage',
    'truncation',
    'findings',
    'validityStatus',
  ], ['reviewedRequirementIds', 'validityReason'])

  literal(root.protocol, CODE_REVIEW_PROTOCOL, '$.protocol')
  literal(root.version, CODE_REVIEW_VERSION, '$.version')

  const reviewedRequirementIds = Object.hasOwn(root, 'reviewedRequirementIds')
    ? idArray(root.reviewedRequirementIds, '$.reviewedRequirementIds')
    : undefined
  const findings = parseFindings(root.findings)
  validateFindings(findings, reviewedRequirementIds)

  const report: CodeReviewReportV1 = {
    protocol: CODE_REVIEW_PROTOCOL,
    version: CODE_REVIEW_VERSION,
    id: idField(root, 'id', '$'),
    cycleId: idField(root, 'cycleId', '$'),
    model: textField(root, 'model', '$'),
    provider: textField(root, 'provider', '$'),
    thinking: textField(root, 'thinking', '$'),
    diffHash: textField(root, 'diffHash', '$'),
    baseRevision: nonNegativeInteger(root.baseRevision, '$.baseRevision'),
    createdAt: nonNegativeNumber(root.createdAt, '$.createdAt'),
    completedAt: nonNegativeNumber(root.completedAt, '$.completedAt'),
    durationMs: nonNegativeNumber(root.durationMs, '$.durationMs'),
    usage: parseUsage(root.usage),
    truncation: parseTruncation(root.truncation),
    findings,
    validityStatus: enumValue(
      root.validityStatus,
      CODE_REVIEW_VALIDITY_STATUSES,
      '$.validityStatus',
    ),
  }
  if (reviewedRequirementIds) report.reviewedRequirementIds = reviewedRequirementIds
  if (Object.hasOwn(root, 'validityReason'))
    report.validityReason = textField(root, 'validityReason', '$')
  return report
}

export function isCodeReviewReportV1(value: unknown): value is CodeReviewReportV1 {
  try {
    parseCodeReviewReportV1(value)
    return true
  } catch {
    return false
  }
}

export function parseUsagePurpose(value: unknown): UsagePurpose {
  return enumValue(value, USAGE_PURPOSES, '$.usagePurpose')
}

export function normalizeUsagePurpose(value: unknown): NormalizedUsagePurpose {
  return typeof value === 'string' && USAGE_PURPOSES.some((purpose) => purpose === value)
    ? value as UsagePurpose
    : 'unknown'
}

function parseFindings(value: unknown): CodeReviewFinding[] {
  return array(value, '$.findings', CODE_REVIEW_FINDING_LIMIT).map(
    (candidate, index) => {
      const path = `$.findings[${index}]`
      const item = objectWithKeys(candidate, path, [
        'id',
        'severity',
        'confidence',
        'title',
        'requirementIds',
        'evidence',
        'recommendation',
        'fingerprint',
        'status',
      ], ['path', 'line', 'dismissalReason'])
      const finding: CodeReviewFinding = {
        id: idField(item, 'id', path),
        severity: enumValue(item.severity, REVIEW_SEVERITIES, `${path}.severity`),
        confidence: enumValue(item.confidence, REVIEW_CONFIDENCES, `${path}.confidence`),
        title: textField(item, 'title', path),
        requirementIds: idArray(item.requirementIds, `${path}.requirementIds`),
        evidence: textField(item, 'evidence', path, VALIDATED_WORK_LIMITS.observationSummaryChars),
        recommendation: textField(item, 'recommendation', path),
        fingerprint: textField(item, 'fingerprint', path),
        status: enumValue(item.status, CODE_REVIEW_FINDING_STATUSES, `${path}.status`),
      }
      if (Object.hasOwn(item, 'path')) finding.path = textField(item, 'path', path)
      if (Object.hasOwn(item, 'line')) finding.line = positiveInteger(item.line, `${path}.line`)
      if (Object.hasOwn(item, 'dismissalReason')) {
        finding.dismissalReason = textField(item, 'dismissalReason', path)
      }
      return finding
    },
  )
}

function validateFindings(
  findings: readonly CodeReviewFinding[],
  reviewedRequirementIds: readonly string[] | undefined,
): void {
  uniqueIds(findings, '$.findings')
  if (!reviewedRequirementIds) return
  const allowed = new Set(reviewedRequirementIds)
  for (const finding of findings) {
    references(finding.requirementIds, allowed, `$.findings.${finding.id}.requirementIds`)
  }
}

function parseUsage(value: unknown): CodeReviewUsage {
  const item = objectWithKeys(value, '$.usage', [
    'inputTokens',
    'outputTokens',
    'cacheReadTokens',
    'cacheWriteTokens',
    'costUsd',
  ])
  return {
    inputTokens: nonNegativeInteger(item.inputTokens, '$.usage.inputTokens'),
    outputTokens: nonNegativeInteger(item.outputTokens, '$.usage.outputTokens'),
    cacheReadTokens: nonNegativeInteger(item.cacheReadTokens, '$.usage.cacheReadTokens'),
    cacheWriteTokens: nonNegativeInteger(item.cacheWriteTokens, '$.usage.cacheWriteTokens'),
    costUsd: nonNegativeNumber(item.costUsd, '$.usage.costUsd'),
  }
}

function parseTruncation(value: unknown): CodeReviewTruncationFlags {
  const item = objectWithKeys(value, '$.truncation', ['diff', 'files', 'findings', 'output'])
  return {
    diff: booleanValue(item.diff, '$.truncation.diff'),
    files: booleanValue(item.files, '$.truncation.files'),
    findings: booleanValue(item.findings, '$.truncation.findings'),
    output: booleanValue(item.output, '$.truncation.output'),
  }
}

function objectWithKeys(
  value: unknown,
  path: string,
  required: string[],
  optional: string[] = [],
): Record<string, unknown> {
  if (!isObject(value)) throw new CodeReviewParseError(`${path} must be an object`)
  const allowed = new Set([...required, ...optional])
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new CodeReviewParseError(`${path}.${key} is not allowed`)
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) throw new CodeReviewParseError(`${path}.${key} is required`)
  }
  return value
}

function literal<T extends string | number>(value: unknown, expected: T, path: string): T {
  if (value !== expected) throw new CodeReviewParseError(`${path} must be ${String(expected)}`)
  return expected
}

function enumValue<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  path: string,
): T[number] {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new CodeReviewParseError(`${path} must be one of ${allowed.join(', ')}`)
  }
  return value
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new CodeReviewParseError(`${path} must be a boolean`)
  return value
}

function nonNegativeNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new CodeReviewParseError(`${path} must be a non-negative finite number`)
  }
  return value
}

function nonNegativeInteger(value: unknown, path: string): number {
  const parsed = nonNegativeNumber(value, path)
  if (!Number.isInteger(parsed)) throw new CodeReviewParseError(`${path} must be an integer`)
  return parsed
}

function positiveInteger(value: unknown, path: string): number {
  const parsed = nonNegativeInteger(value, path)
  if (parsed < 1) throw new CodeReviewParseError(`${path} must be positive`)
  return parsed
}

function array(value: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(value)) throw new CodeReviewParseError(`${path} must be an array`)
  if (value.length > max) throw new CodeReviewParseError(`${path} exceeds ${max} entries`)
  return value
}

function idArray(value: unknown, path: string): string[] {
  const values = array(value, path, Number.MAX_SAFE_INTEGER).map((candidate, index) =>
    idValue(candidate, `${path}[${index}]`)
  )
  const seen = new Set<string>()
  for (const id of values) {
    if (seen.has(id)) throw new CodeReviewParseError(`${path} contains duplicate reference ${id}`)
    seen.add(id)
  }
  return values
}

function idField(value: Record<string, unknown>, key: string, path: string): string {
  return idValue(value[key], `${path}.${key}`)
}

function idValue(value: unknown, path: string): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9._-]{1,80}$/.test(value)) {
    throw new CodeReviewParseError(`${path} must be an ASCII id of 1-80 chars`)
  }
  return value
}

function textField(
  value: Record<string, unknown>,
  key: string,
  path: string,
  max: number = VALIDATED_WORK_LIMITS.textChars,
): string {
  const raw = value[key]
  if (typeof raw !== 'string') throw new CodeReviewParseError(`${path}.${key} must be a string`)
  if (raw.length > max) throw new CodeReviewParseError(`${path}.${key} exceeds ${max} chars`)
  return raw
}

function uniqueIds(items: readonly { id: string }[], path: string): Set<string> {
  const ids = new Set<string>()
  for (const item of items) {
    if (ids.has(item.id)) throw new CodeReviewParseError(`${path} contains duplicate id ${item.id}`)
    ids.add(item.id)
  }
  return ids
}

function references(values: readonly string[], allowed: ReadonlySet<string>, path: string): void {
  for (const value of values) {
    if (!allowed.has(value))
      throw new CodeReviewParseError(`${path} references unknown id ${value}`)
  }
}

function assertSerializedSize(value: unknown, path: string): void {
  let serialized: string
  try {
    serialized = JSON.stringify(value)
  } catch (error) {
    throw new CodeReviewParseError(`${path} must be JSON serializable: ${String(error)}`)
  }
  const bytes = new TextEncoder().encode(serialized).length
  if (bytes > VALIDATED_WORK_LIMITS.serializedStateBytes) {
    throw new CodeReviewParseError(
      `${path} exceeds ${VALIDATED_WORK_LIMITS.serializedStateBytes} serialized bytes`,
    )
  }
}
