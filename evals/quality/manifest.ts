import { readFile } from 'node:fs/promises'
import { assertSafeIdentifier, fingerprintJson, type FingerprintJson } from './fingerprint.ts'

export const QUALITY_MANIFEST_VERSION = 1

export type QualityArm =
  | 'pi-direct'
  | 'livecraft-standard'
  | 'livecraft-validated'
  | `git:${string}`

export interface QualityManifest {
  version: typeof QUALITY_MANIFEST_VERSION
  campaignId: string
  livecraftRevision: string
  pi: {
    version: string
    executableSha256: string
  }
  environment: {
    node: string
    os: string
    arch: string
  }
  requested: {
    provider: string
    model: string
    thinking: string
  }
  observed: {
    provider: string
    model: string
    thinking: string
  }
  cells: QualityCampaignCell[]
  limits: {
    maxTurns: number
    maxTimeMs: number
    maxCostUsd: number
  }
  resources: {
    concurrency: number
    cpu?: string
    memoryMb?: number
  }
  validatedWork: Record<string, FingerprintJson>
  review: Record<string, FingerprintJson>
  timestamps: {
    createdAt: string
    updatedAt: string
  }
}

export interface QualityCampaignCell {
  id: string
  arm: QualityArm
  taskId: string
  taskRevision: string
  seed: string
  promptHash: string
  attempts: number
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

function optionalNumberField(
  value: Record<string, unknown>,
  key: string,
  label: string,
): number | undefined {
  const field = value[key]
  if (field === undefined) return undefined
  if (typeof field !== 'number' || !Number.isFinite(field) || field < 0) {
    throw new Error(`${label}.${key} must be a non-negative finite number`)
  }
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

function parseNamedTriple(value: unknown, label: string): QualityManifest['requested'] {
  if (!isRecord(value)) throw new Error(`${label} must be an object`)
  assertKeys(value, ['provider', 'model', 'thinking'], label)
  return {
    model: stringField(value, 'model', label),
    provider: stringField(value, 'provider', label),
    thinking: stringField(value, 'thinking', label),
  }
}

function parseJsonObject(value: unknown, label: string): Record<string, FingerprintJson> {
  if (!isRecord(value)) throw new Error(`${label} must be an object`)
  JSON.stringify(value)
  return value as Record<string, FingerprintJson>
}

export function parseQualityArm(value: string): QualityArm {
  if (value === 'pi-direct' || value === 'livecraft-standard' || value === 'livecraft-validated')
    return value
  if (/^git:[A-Za-z0-9][A-Za-z0-9._/-]{0,79}$/.test(value) && !value.includes('..'))
    return value as QualityArm
  throw new Error(`Invalid quality arm ${value}`)
}

function parseCell(value: unknown, index: number): QualityCampaignCell {
  const label = `cells[${index}]`
  if (!isRecord(value)) throw new Error(`${label} must be an object`)
  assertKeys(
    value,
    ['id', 'arm', 'taskId', 'taskRevision', 'seed', 'promptHash', 'attempts'],
    label,
  )
  const id = assertSafeIdentifier(stringField(value, 'id', label), `${label}.id`)
  const arm = parseQualityArm(stringField(value, 'arm', label))
  const taskId = assertSafeIdentifier(stringField(value, 'taskId', label), `${label}.taskId`)
  const attempts = numberField(value, 'attempts', label)
  if (!Number.isInteger(attempts) || attempts < 1)
    throw new Error(`${label}.attempts must be a positive integer`)
  return {
    arm,
    attempts,
    id,
    promptHash: stringField(value, 'promptHash', label),
    seed: assertSafeIdentifier(stringField(value, 'seed', label), `${label}.seed`),
    taskId,
    taskRevision: stringField(value, 'taskRevision', label),
  }
}

export function parseQualityManifestJson(value: unknown): QualityManifest {
  if (!isRecord(value)) throw new Error('Quality manifest must be an object')
  assertKeys(
    value,
    [
      'version',
      'campaignId',
      'livecraftRevision',
      'pi',
      'environment',
      'requested',
      'observed',
      'cells',
      'limits',
      'resources',
      'validatedWork',
      'review',
      'timestamps',
    ],
    'manifest',
  )
  if (value.version !== QUALITY_MANIFEST_VERSION)
    throw new Error('Unsupported quality manifest version')

  const pi = objectField(value, 'pi', 'manifest')
  assertKeys(pi, ['version', 'executableSha256'], 'manifest.pi')
  const environment = objectField(value, 'environment', 'manifest')
  assertKeys(environment, ['node', 'os', 'arch'], 'manifest.environment')
  const limits = objectField(value, 'limits', 'manifest')
  assertKeys(limits, ['maxTurns', 'maxTimeMs', 'maxCostUsd'], 'manifest.limits')
  const resources = objectField(value, 'resources', 'manifest')
  for (const key of Object.keys(resources)) {
    if (!['concurrency', 'cpu', 'memoryMb'].includes(key))
      throw new Error(`manifest.resources contains unknown field ${key}`)
  }
  if (!('concurrency' in resources)) throw new Error('manifest.resources missing concurrency')
  const timestamps = objectField(value, 'timestamps', 'manifest')
  assertKeys(timestamps, ['createdAt', 'updatedAt'], 'manifest.timestamps')

  if (!Array.isArray(value.cells) || value.cells.length === 0)
    throw new Error('manifest.cells must be a non-empty array')
  const concurrency = numberField(resources, 'concurrency', 'manifest.resources')
  if (!Number.isInteger(concurrency) || concurrency < 1)
    throw new Error('manifest.resources.concurrency must be a positive integer')

  return {
    campaignId: assertSafeIdentifier(
      stringField(value, 'campaignId', 'manifest'),
      'manifest.campaignId',
    ),
    cells: value.cells.map(parseCell),
    environment: {
      arch: stringField(environment, 'arch', 'manifest.environment'),
      node: stringField(environment, 'node', 'manifest.environment'),
      os: stringField(environment, 'os', 'manifest.environment'),
    },
    limits: {
      maxCostUsd: numberField(limits, 'maxCostUsd', 'manifest.limits'),
      maxTimeMs: numberField(limits, 'maxTimeMs', 'manifest.limits'),
      maxTurns: numberField(limits, 'maxTurns', 'manifest.limits'),
    },
    livecraftRevision: stringField(value, 'livecraftRevision', 'manifest'),
    observed: parseNamedTriple(value.observed, 'manifest.observed'),
    pi: {
      executableSha256: stringField(pi, 'executableSha256', 'manifest.pi'),
      version: stringField(pi, 'version', 'manifest.pi'),
    },
    requested: parseNamedTriple(value.requested, 'manifest.requested'),
    resources: {
      concurrency,
      cpu: typeof resources.cpu === 'string' ? resources.cpu : undefined,
      memoryMb: optionalNumberField(resources, 'memoryMb', 'manifest.resources'),
    },
    review: parseJsonObject(value.review, 'manifest.review'),
    timestamps: {
      createdAt: stringField(timestamps, 'createdAt', 'manifest.timestamps'),
      updatedAt: stringField(timestamps, 'updatedAt', 'manifest.timestamps'),
    },
    validatedWork: parseJsonObject(value.validatedWork, 'manifest.validatedWork'),
    version: QUALITY_MANIFEST_VERSION,
  }
}

export function parseQualityManifestText(text: string): QualityManifest {
  return parseQualityManifestJson(JSON.parse(text))
}

export async function readQualityManifest(path: string): Promise<QualityManifest> {
  return parseQualityManifestText(await readFile(path, 'utf8'))
}

export function fingerprintManifest(manifest: QualityManifest): string {
  return fingerprintJson(manifest as unknown as FingerprintJson)
}
