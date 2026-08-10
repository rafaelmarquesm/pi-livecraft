import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { isObject } from '../../../shared/is-object.ts'
import {
  isUsagePurpose,
  type AuxiliaryUsageRollupRecord,
  type UsagePurpose,
} from './usage-ledger.ts'

export type AuxiliaryUsagePurpose = Extract<
  UsagePurpose,
  'code_review' | 'prompt_improvement' | 'other_isolated'
>

export interface AuxiliaryUsageRecord extends AuxiliaryUsageRollupRecord {
  purpose: AuxiliaryUsagePurpose
}

const auxiliaryPurposes = new Set<AuxiliaryUsagePurpose>([
  'code_review',
  'prompt_improvement',
  'other_isolated',
])

/**
 * Append-only ledger for isolated model operations that never appear as session entries.
 * It uses the same 0600 tmp+rename serialized persistence contract as the session ledger.
 */
export class AuxiliaryUsageLedger {
  readonly #path: string
  #queue: Promise<void> = Promise.resolve()

  constructor(
    path = process.env.PI_LIVECRAFT_AUXILIARY_USAGE_STORE
      ?? join(homedir(), '.pi-livecraft', 'auxiliary-usage.jsonl'),
  ) {
    this.#path = path
  }

  append(record: AuxiliaryUsageRecord): Promise<void> {
    assertAuxiliaryUsageRecord(record)
    const operation = this.#queue.then(async () => {
      const existing = parseAuxiliaryUsageStore(await readStoreText(this.#path))
      if (existing.some((item) => item.operationId === record.operationId)) return
      const lines = [...existing, record].map((item) => JSON.stringify(item))
      const temporaryPath = `${this.#path}.${process.pid}.tmp`
      await mkdir(dirname(this.#path), { recursive: true })
      await writeFile(temporaryPath, lines.join('\n') + '\n', { mode: 0o600 })
      await rename(temporaryPath, this.#path)
    })
    this.#queue = operation.catch(() => undefined)
    return operation
  }

  async load(): Promise<AuxiliaryUsageRecord[]> {
    return parseAuxiliaryUsageStore(await readStoreText(this.#path))
  }
}

export function parseAuxiliaryUsageStore(content: string): AuxiliaryUsageRecord[] {
  if (content === '') return []
  const lines = content.split('\n')
  const records: AuxiliaryUsageRecord[] = []
  const seen = new Set<string>()
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim()
    if (!line) continue
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      if (index === lines.length - 1) break
      throw new Error('Corrupt auxiliary usage ledger: unparseable line')
    }
    if (!isAuxiliaryUsageRecord(value)) {
      throw new Error('Corrupt auxiliary usage ledger: invalid record')
    }
    if (seen.has(value.operationId)) continue
    seen.add(value.operationId)
    records.push(value)
  }
  return records
}

export function isAuxiliaryUsagePurpose(value: unknown): value is AuxiliaryUsagePurpose {
  return isUsagePurpose(value) && auxiliaryPurposes.has(value as AuxiliaryUsagePurpose)
}

function assertAuxiliaryUsageRecord(record: AuxiliaryUsageRecord): void {
  if (!isAuxiliaryUsageRecord(record)) throw new Error('Invalid auxiliary usage record')
}

function isAuxiliaryUsageRecord(value: unknown): value is AuxiliaryUsageRecord {
  if (!isObject(value)) return false
  if (
    typeof value.operationId !== 'string' || value.operationId.length === 0
    || value.operationId.length > 200
  ) return false
  if (typeof value.cwd !== 'string' || value.cwd.length === 0 || value.cwd.length > 2000) {
    return false
  }
  if (typeof value.timestamp !== 'string' || Number.isNaN(Date.parse(value.timestamp))) return false
  if (!isAuxiliaryUsagePurpose(value.purpose)) return false
  if (!isOptionalIdentifier(value.provider) || !isOptionalIdentifier(value.model)) return false
  if (!isOptionalIdentifier(value.thinking)) return false
  if (
    value.durationMs !== undefined && (!isFiniteNumber(value.durationMs) || value.durationMs < 0)
  ) {
    return false
  }
  return ['cost', 'totalTokens', 'input', 'output', 'cacheRead', 'cacheWrite']
    .every((key) => isFiniteNumber(value[key]) && value[key] >= 0)
}

async function readStoreText(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (isObject(error) && error.code === 'ENOENT') return ''
    throw error
  }
}

function isOptionalIdentifier(value: unknown): boolean {
  return value === undefined
    || (typeof value === 'string' && value.length > 0 && value.length <= 200)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}
