import { readFile } from 'node:fs/promises'
import { parseQualityArm, type QualityArm } from './manifest.ts'

export const QUALITY_ARTIFACT_VERSION = 1

export const INVALID_REASON_CODES = [
  'model_mismatch',
  'thinking_mismatch',
  'provider_mismatch',
  'auth_failure',
  'quota_failure',
  'rate_limited',
  'network_failure',
  'output_truncated',
  'workspace_dirty',
  'outside_workspace_mutation',
  'settle_missing',
  'grader_missing',
  'grader_parse_failure',
  'artifact_incomplete',
  'settings_drift',
] as const

export type InvalidReasonCode = typeof INVALID_REASON_CODES[number]

export interface QualityArtifact {
  version: typeof QUALITY_ARTIFACT_VERSION
  campaignId: string
  manifestFingerprint: string
  generatedAt: string
  trials: QualityTrial[]
}

export interface QualityTrial {
  id: string
  campaignId: string
  cellId: string
  arm: QualityArm
  taskId: string
  taskRevision: string
  taskFingerprint: string
  seed: string
  attempt: number
  valid: boolean
  invalidReasons: InvalidReasonCode[]
  passed: boolean
  score: number | null
  costUsd: number
  startedAt: string
  settledAt: string
  durationMs: number
  timeToPassMs: number | null
  tokens: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
  }
  observed: {
    provider: string
    model: string
    thinking: string
  }
  grader: {
    exitCode: number
    parsed: boolean
    passed: boolean
    summary: string
  }
  progress: QualityProgressPoint[]
}

export interface QualityProgressPoint {
  elapsedMs: number
  bestScore: number | null
  passed: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const allowed = new Set(keys)
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${label} contains unknown field ${key}`)
  }
  for (const key of keys) {
    if (!(key in value)) throw new Error(`${label} missing ${key}`)
  }
}

function stringField(value: Record<string, unknown>, key: string, label: string): string {
  const field = value[key]
  if (typeof field !== 'string' || field.length === 0)
    throw new Error(`${label}.${key} must be a non-empty string`)
  return field
}

function numberField(value: Record<string, unknown>, key: string, label: string): number {
  const field = value[key]
  if (typeof field !== 'number' || !Number.isFinite(field) || field < 0) {
    throw new Error(`${label}.${key} must be a non-negative finite number`)
  }
  return field
}

function nullableNumberField(
  value: Record<string, unknown>,
  key: string,
  label: string,
): number | null {
  const field = value[key]
  if (field === null) return null
  if (typeof field !== 'number' || !Number.isFinite(field))
    throw new Error(`${label}.${key} must be a finite number or null`)
  return field
}

function booleanField(value: Record<string, unknown>, key: string, label: string): boolean {
  const field = value[key]
  if (typeof field !== 'boolean') throw new Error(`${label}.${key} must be boolean`)
  return field
}

function objectField(
  value: Record<string, unknown>,
  key: string,
  label: string,
): Record<string, unknown> {
  const field = value[key]
  if (!isRecord(field)) throw new Error(`${label}.${key} must be an object`)
  return field
}

function parseInvalidReason(value: unknown, label: string): InvalidReasonCode {
  if (typeof value !== 'string' || !INVALID_REASON_CODES.includes(value as InvalidReasonCode)) {
    throw new Error(`${label} has an unknown invalid reason`)
  }
  return value as InvalidReasonCode
}

function parseProgressPoint(value: unknown, index: number, label: string): QualityProgressPoint {
  const pointLabel = `${label}.progress[${index}]`
  if (!isRecord(value)) throw new Error(`${pointLabel} must be an object`)
  assertKeys(value, ['elapsedMs', 'bestScore', 'passed'], pointLabel)
  return {
    bestScore: nullableNumberField(value, 'bestScore', pointLabel),
    elapsedMs: numberField(value, 'elapsedMs', pointLabel),
    passed: booleanField(value, 'passed', pointLabel),
  }
}

function parseTrial(value: unknown, index: number): QualityTrial {
  const label = `trials[${index}]`
  if (!isRecord(value)) throw new Error(`${label} must be an object`)
  assertKeys(
    value,
    [
      'id',
      'campaignId',
      'cellId',
      'arm',
      'taskId',
      'taskRevision',
      'taskFingerprint',
      'seed',
      'attempt',
      'valid',
      'invalidReasons',
      'passed',
      'score',
      'costUsd',
      'startedAt',
      'settledAt',
      'durationMs',
      'timeToPassMs',
      'tokens',
      'observed',
      'grader',
      'progress',
    ],
    label,
  )
  if (!Array.isArray(value.invalidReasons))
    throw new Error(`${label}.invalidReasons must be an array`)
  if (!Array.isArray(value.progress)) throw new Error(`${label}.progress must be an array`)

  const tokens = objectField(value, 'tokens', label)
  assertKeys(tokens, ['input', 'output', 'cacheRead', 'cacheWrite'], `${label}.tokens`)
  const observed = objectField(value, 'observed', label)
  assertKeys(observed, ['provider', 'model', 'thinking'], `${label}.observed`)
  const grader = objectField(value, 'grader', label)
  assertKeys(grader, ['exitCode', 'parsed', 'passed', 'summary'], `${label}.grader`)
  const attempt = numberField(value, 'attempt', label)
  if (!Number.isInteger(attempt) || attempt < 1)
    throw new Error(`${label}.attempt must be a positive integer`)

  return {
    arm: parseQualityArm(stringField(value, 'arm', label)),
    attempt,
    campaignId: stringField(value, 'campaignId', label),
    cellId: stringField(value, 'cellId', label),
    costUsd: numberField(value, 'costUsd', label),
    durationMs: numberField(value, 'durationMs', label),
    grader: {
      exitCode: numberField(grader, 'exitCode', `${label}.grader`),
      parsed: booleanField(grader, 'parsed', `${label}.grader`),
      passed: booleanField(grader, 'passed', `${label}.grader`),
      summary: stringField(grader, 'summary', `${label}.grader`),
    },
    id: stringField(value, 'id', label),
    invalidReasons: value.invalidReasons.map((reason, reasonIndex) =>
      parseInvalidReason(reason, `${label}.invalidReasons[${reasonIndex}]`)
    ),
    observed: {
      model: stringField(observed, 'model', `${label}.observed`),
      provider: stringField(observed, 'provider', `${label}.observed`),
      thinking: stringField(observed, 'thinking', `${label}.observed`),
    },
    passed: booleanField(value, 'passed', label),
    progress: value.progress.map((point, pointIndex) =>
      parseProgressPoint(point, pointIndex, label)
    ),
    score: nullableNumberField(value, 'score', label),
    seed: stringField(value, 'seed', label),
    settledAt: stringField(value, 'settledAt', label),
    startedAt: stringField(value, 'startedAt', label),
    taskId: stringField(value, 'taskId', label),
    taskFingerprint: stringField(value, 'taskFingerprint', label),
    taskRevision: stringField(value, 'taskRevision', label),
    timeToPassMs: nullableNumberField(value, 'timeToPassMs', label),
    tokens: {
      cacheRead: numberField(tokens, 'cacheRead', `${label}.tokens`),
      cacheWrite: numberField(tokens, 'cacheWrite', `${label}.tokens`),
      input: numberField(tokens, 'input', `${label}.tokens`),
      output: numberField(tokens, 'output', `${label}.tokens`),
    },
    valid: booleanField(value, 'valid', label),
  }
}

export function parseQualityArtifactJson(value: unknown): QualityArtifact {
  if (!isRecord(value)) throw new Error('Quality artifact must be an object')
  assertKeys(
    value,
    ['version', 'campaignId', 'manifestFingerprint', 'generatedAt', 'trials'],
    'artifact',
  )
  if (value.version !== QUALITY_ARTIFACT_VERSION)
    throw new Error('Unsupported quality artifact version')
  if (!Array.isArray(value.trials)) throw new Error('artifact.trials must be an array')
  return {
    campaignId: stringField(value, 'campaignId', 'artifact'),
    generatedAt: stringField(value, 'generatedAt', 'artifact'),
    manifestFingerprint: stringField(value, 'manifestFingerprint', 'artifact'),
    trials: value.trials.map(parseTrial),
    version: QUALITY_ARTIFACT_VERSION,
  }
}

export function parseQualityArtifactText(text: string): QualityArtifact {
  return parseQualityArtifactJson(JSON.parse(text))
}

export async function readQualityArtifact(path: string): Promise<QualityArtifact> {
  return parseQualityArtifactText(await readFile(path, 'utf8'))
}
