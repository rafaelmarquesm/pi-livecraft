import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { JsonObject } from '../../../shared/types.ts'
import { isObject } from '../../../shared/is-object.ts'
import { advanceEntryCursor } from '../../session-entries.ts'

/**
 * Append-only usage ledger (Fase 4.1), following the M6 store pattern of
 * `server/features/todos/todo-store.ts`: `~/.pi-livecraft/usage.jsonl`,
 * `PI_LIVECRAFT_USAGE_STORE` override for tests, `mode: 0o600`, serialized
 * write queue, strict validation at the boundary.
 *
 * One JSON line per billable record. Each record is keyed by the session
 * entry id (`entryId`, stable 8-hex), which makes reprocessing idempotent
 * (T-LEDGER-2). Costs are taken verbatim from the Pi-reported
 * `usage.cost.total` — Livecraft never keeps a local price table (E8).
 */
export interface UsageRecord {
  /** Stable 8-hex session entry id — the idempotency key. */
  entryId: string
  /** Livecraft session id the entry belongs to. */
  sessionId: string
  /** Workspace the session ran in; scopes the GET /api/usage rollup. */
  cwd: string
  /** Entry timestamp in ISO 8601 (UTC); drives the by-day rollup. */
  timestamp: string
  /**
   * Approximate generation duration in ms: the delta between this entry's
   * timestamp and the previous entry's timestamp (Backlog B). Derived at
   * extraction from consecutive entries; absent for the first entry, for
   * records with unusable timestamps, or for records written before this
   * field existed — such records are simply excluded from tok/s averages.
   */
  turnMs?: number
  /** Model that produced the usage, when the entry reports one (assistant messages). */
  model?: string
  /** Billed cost in USD from `usage.cost.total`. */
  cost: number
  /** Total tokens from `usage.totalTokens` (0 when the entry omits it). */
  totalTokens: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

/** Usage extracted from an entry, before the ledger stamps session identity. */
export type UsageEntryUsage = Omit<UsageRecord, 'sessionId' | 'cwd'>

export interface UsageAggregate {
  cost: number
  totalTokens: number
  records: number
  /**
   * Cache hit rate `cacheRead / (input + cacheRead)` in 0..1. Always present
   * for a new rollup; 0 when the denominator is 0 (nothing billed).
   */
  cacheHitRate?: number
  /** Cost per 1k output tokens in USD; omitted when the bucket has no output. */
  costPer1kOutput?: number
  /** input:output token ratio; omitted when the bucket has no output. */
  inputOutputRatio?: number
  /**
   * Mean generation throughput in output tokens/s, averaged over records with
   * a `turnMs` and positive output; omitted when no such record exists.
   */
  tokensPerSecond?: number
}

/** Rollup served by GET /api/usage?cwd=… */
export interface UsageRollup {
  /** Workspace the rollup was requested for; only its records are counted. */
  cwd: string
  totals: UsageAggregate
  /** Aggregates bucketed by UTC day (ISO date), most recent first. */
  byDay: Array<{ day: string } & UsageAggregate>
  /** Aggregates bucketed by model, alphabetical; records without a model bucket as 'unknown'. */
  byModel: Array<{ model: string } & UsageAggregate>
}

const entryIdPattern = /^[0-9a-f]{8}$/

/**
 * Extracts billable usage from session entries (pure, deterministic).
 *
 * Mirrors exactly what the Pi counts in `get_session_stats` ("assistant
 * messages, usage reported by tools, and compaction/branch-summary
 * generation"):
 * - `message` entries with `role: 'assistant'` → `message.usage`
 * - `message` entries with `role: 'toolResult'` and `usage` → `message.usage`
 *   (nested LLM work such as subagents; the E9 gap in
 *   `src/features/conversation/message-usage.ts`, which only sums assistant
 *   messages, is deliberately NOT copied)
 * - `compaction` and `branchSummary` entries carrying top-level `usage`
 *   (compaction/branch-summary generation is part of `get_session_stats.cost`)
 *
 * Entries without billable usage, without a stable 8-hex id, or without a
 * usable timestamp are skipped. Costs always come from `usage.cost.total`.
 */
export function usageRecordsForEntries(entries: JsonObject[]): UsageEntryUsage[] {
  const records: UsageEntryUsage[] = []
  // Timestamp of the previous entry in the array (append order). The delta
  // between consecutive entries approximates the generation duration of the
  // current one; a break in the chain (unusable timestamp) drops turnMs for
  // this and the following record instead of guessing across the gap.
  let previousTimestampMs: number | null = null
  for (const entry of entries) {
    if (!isObject(entry)) continue
    const timestampMs = entryTimestampMs(entry)
    const usage = usageOfEntry(entry)
    if (
      typeof entry.id !== 'string' || !entryIdPattern.test(entry.id) || usage === null
      || timestampMs === null
    ) {
      previousTimestampMs = timestampMs
      continue
    }
    const turnMs = previousTimestampMs !== null && timestampMs > previousTimestampMs
      ? timestampMs - previousTimestampMs
      : undefined
    previousTimestampMs = timestampMs
    records.push({
      entryId: entry.id,
      timestamp: new Date(timestampMs).toISOString(),
      turnMs,
      model: usage.model,
      cost: usage.cost,
      totalTokens: usage.totalTokens,
      input: usage.input,
      output: usage.output,
      cacheRead: usage.cacheRead,
      cacheWrite: usage.cacheWrite,
    })
  }
  return records
}

/**
 * Aggregates ledger records for one workspace (pure, deterministic).
 * Buckets by UTC day (`timestamp.slice(0, 10)`) and by model, summing cost
 * and tokens and counting records. Floats are summed raw — consumers compare
 * against `get_session_stats` with the documented T-LEDGER-1 band instead of
 * exact equality.
 *
 * Each bucket also derives inference metrics (Backlog B): cache hit rate
 * (`cacheRead / (input + cacheRead)`, 0 on a zero denominator), cost per 1k
 * output tokens and the input:output ratio (both omitted when the bucket has
 * no output), and mean generation throughput in output tokens/s averaged over
 * records carrying a `turnMs` and positive output (omitted when none). All
 * derived fields are optional so older consumers keep working.
 */
export function rollupUsageRecords(records: UsageRecord[], cwd: string): UsageRollup {
  const scoped = records.filter((record) => record.cwd === cwd)
  const totals = emptyCounters()
  const byDay = new Map<string, AggregateCounters>()
  const byModel = new Map<string, AggregateCounters>()
  for (const record of scoped) {
    mergeRecord(totals, record)
    accumulate(byDay, record.timestamp.slice(0, 10), record)
    accumulate(byModel, record.model ?? 'unknown', record)
  }
  return {
    cwd,
    totals: toAggregate(totals),
    byDay: [...byDay.entries()]
      .map(([day, counters]) => ({ day, ...toAggregate(counters) }))
      .sort((a, b) => b.day.localeCompare(a.day)),
    byModel: [...byModel.entries()]
      .map(([model, counters]) => ({ model, ...toAggregate(counters) }))
      .sort((a, b) => a.model.localeCompare(b.model)),
  }
}

/**
 * Parses the append-only JSONL store. Every complete line must be a valid
 * UsageRecord. A single trailing partial line (a write interrupted midway)
 * is tolerated and dropped — that is what makes T-LEDGER-3's crash
 * simulation work. Any other malformed line is a corrupt store and throws.
 */
export function parseUsageStore(content: string): UsageRecord[] {
  if (content === '') return []
  const lines = content.split('\n')
  const records: UsageRecord[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim()
    if (line === '') continue
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      if (index === lines.length - 1) break // trailing partial line from an interrupted append
      throw new Error('Corrupt usage ledger: unparseable line')
    }
    if (!isUsageRecord(value)) throw new Error('Corrupt usage ledger: invalid record')
    records.push(value)
  }
  return records
}

/**
 * Append-only ledger with a durable per-session cursor. The cursor is the
 * last entry id recorded for the session, derived from the file itself, so a
 * freshly constructed ledger continues where a previous process stopped
 * (T-LEDGER-3). Only entries after the cursor are considered, and records are
 * additionally deduplicated by entry id so reprocessing never duplicates a
 * record (T-LEDGER-2).
 */
export class UsageLedger {
  readonly #path: string
  #queue: Promise<void> = Promise.resolve()
  #cursors = new Map<string, string | null>()

  constructor(
    path = process.env.PI_LIVECRAFT_USAGE_STORE
      ?? join(homedir(), '.pi-livecraft', 'usage.jsonl'),
  ) {
    this.#path = path
  }

  /** Appends records for entries not yet recorded for this session. */
  append(sessionId: string, cwd: string, entries: JsonObject[]): Promise<void> {
    if (typeof sessionId !== 'string' || sessionId.length === 0 || sessionId.length > 200)
      throw new Error('Invalid session id')
    if (typeof cwd !== 'string' || cwd.length === 0 || cwd.length > 2000)
      throw new Error('Invalid working directory')
    const operation = this.#queue.then(async () => {
      const content = await readStoreText(this.#path)
      const existing = parseUsageStore(content)
      const sessionRecords = existing.filter((record) => record.sessionId === sessionId)
      const seen = new Set(sessionRecords.map((record) => record.entryId))
      const cursor = this.#cursors.get(sessionId) ?? lastEntryIdOf(sessionRecords)
      const fresh = entriesAfterCursor(entries, cursor)
      const records = usageRecordsForEntries(fresh).filter((record) => !seen.has(record.entryId))
      if (records.length === 0) {
        this.#cursors.set(sessionId, cursor)
        return
      }
      const lines = records.map((record) => JSON.stringify({ ...record, sessionId, cwd }))
      const temporaryPath = `${this.#path}.${process.pid}.tmp`
      await mkdir(dirname(this.#path), { recursive: true })
      await writeFile(
        temporaryPath,
        stripPartialTrailingLine(content) + lines.join('\n') + '\n',
        { mode: 0o600 },
      )
      await rename(temporaryPath, this.#path)
      const advanced = advanceEntryCursor({ lastEntryId: cursor, leafId: null }, fresh, null)
      this.#cursors.set(sessionId, advanced.lastEntryId)
    })
    this.#queue = operation.catch(() => undefined)
    return operation
  }

  /** Returns every record in the ledger, in append order ([] when the store does not exist). */
  async load(): Promise<UsageRecord[]> {
    return parseUsageStore(await readStoreText(this.#path))
  }
}

interface UsageCounters {
  cost: number
  totalTokens: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  model?: string
}

function usageOfEntry(entry: JsonObject): UsageCounters | null {
  if (entry.type === 'message' && isObject(entry.message)) {
    if (entry.message.role === 'assistant') {
      const usage = usageCounters(entry.message.usage)
      if (usage === null) return null
      const model = typeof entry.message.model === 'string' && entry.message.model.length > 0
        ? entry.message.model
        : undefined
      return model === undefined ? usage : { ...usage, model }
    }
    if (entry.message.role === 'toolResult') return usageCounters(entry.message.usage)
    return null
  }
  if (entry.type === 'compaction' || entry.type === 'branchSummary')
    return usageCounters(entry.usage)
  return null
}

function usageCounters(value: unknown): UsageCounters | null {
  if (
    !isObject(value) || !isObject(value.cost) || !isFiniteNumber(value.cost.total)
    || value.cost.total < 0
  ) return null
  return {
    cost: value.cost.total,
    totalTokens: nonNegativeNumber(value.totalTokens),
    input: nonNegativeNumber(value.input),
    output: nonNegativeNumber(value.output),
    cacheRead: nonNegativeNumber(value.cacheRead),
    cacheWrite: nonNegativeNumber(value.cacheWrite),
  }
}

/** Entry timestamp as epoch ms, resolving `entry.timestamp` or the message timestamp. */
function entryTimestampMs(entry: JsonObject): number | null {
  const entryTime = typeof entry.timestamp === 'string' ? Date.parse(entry.timestamp) : NaN
  if (Number.isFinite(entryTime)) return entryTime
  if (
    isObject(entry.message) && typeof entry.message.timestamp === 'number'
    && Number.isFinite(entry.message.timestamp)
  ) return entry.message.timestamp
  return null
}

function isUsageRecord(value: unknown): value is UsageRecord {
  if (!isObject(value)) return false
  if (typeof value.entryId !== 'string' || !entryIdPattern.test(value.entryId)) return false
  if (
    typeof value.sessionId !== 'string' || value.sessionId.length === 0
    || value.sessionId.length > 200
  ) return false
  if (typeof value.cwd !== 'string' || value.cwd.length === 0 || value.cwd.length > 2000)
    return false
  if (typeof value.timestamp !== 'string' || Number.isNaN(Date.parse(value.timestamp))) return false
  if (
    value.model !== undefined && (typeof value.model !== 'string' || value.model.length === 0
      || value.model.length > 200)
  ) return false
  if (value.turnMs !== undefined && (!isFiniteNumber(value.turnMs) || value.turnMs < 0))
    return false
  return ['cost', 'totalTokens', 'input', 'output', 'cacheRead', 'cacheWrite']
    .every((key) => isFiniteNumber(value[key]) && value[key] >= 0)
}

/** Entries strictly after the session cursor; the whole list when the cursor is unknown. */
function entriesAfterCursor(entries: JsonObject[], lastEntryId: string | null): JsonObject[] {
  if (lastEntryId === null) return entries
  const index = entries.findIndex((entry) => entry.id === lastEntryId)
  return index >= 0 ? entries.slice(index + 1) : entries
}

function lastEntryIdOf(records: UsageRecord[]): string | null {
  return records.length === 0 ? null : records[records.length - 1].entryId
}

/** Drops a trailing partial line (interrupted append) so the next write continues cleanly. */
function stripPartialTrailingLine(content: string): string {
  if (content.endsWith('\n')) return content
  const lastNewline = content.lastIndexOf('\n')
  return lastNewline >= 0 ? content.slice(0, lastNewline + 1) : ''
}

/** Running sums behind one aggregate; derived metrics are computed on output. */
interface AggregateCounters {
  cost: number
  totalTokens: number
  records: number
  input: number
  output: number
  cacheRead: number
  /** Sum of per-record generation rates (output tokens/s) for records with a turnMs. */
  rateSum: number
  /** Number of records contributing to rateSum. */
  rateRecords: number
}

function emptyCounters(): AggregateCounters {
  return {
    cost: 0,
    totalTokens: 0,
    records: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    rateSum: 0,
    rateRecords: 0,
  }
}

function mergeRecord(counters: AggregateCounters, record: UsageRecord): void {
  counters.cost += record.cost
  counters.totalTokens += record.totalTokens
  counters.records += 1
  counters.input += record.input
  counters.output += record.output
  counters.cacheRead += record.cacheRead
  if (isFiniteNumber(record.turnMs) && record.turnMs > 0 && record.output > 0) {
    counters.rateSum += record.output / (record.turnMs / 1000)
    counters.rateRecords += 1
  }
}

function toAggregate(counters: AggregateCounters): UsageAggregate {
  const aggregate: UsageAggregate = {
    cost: counters.cost,
    totalTokens: counters.totalTokens,
    records: counters.records,
  }
  const billedInput = counters.input + counters.cacheRead
  aggregate.cacheHitRate = billedInput > 0 ? counters.cacheRead / billedInput : 0
  if (counters.output > 0) {
    aggregate.costPer1kOutput = counters.cost / (counters.output / 1000)
    aggregate.inputOutputRatio = counters.input / counters.output
  }
  if (counters.rateRecords > 0) aggregate.tokensPerSecond = counters.rateSum / counters.rateRecords
  return aggregate
}

function accumulate(
  buckets: Map<string, AggregateCounters>,
  key: string,
  record: UsageRecord,
): void {
  const counters = buckets.get(key) ?? emptyCounters()
  mergeRecord(counters, record)
  buckets.set(key, counters)
}

async function readStoreText(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (isNotFound(error)) return ''
    throw error
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function nonNegativeNumber(value: unknown): number {
  return isFiniteNumber(value) && value >= 0 ? value : 0
}

function isNotFound(error: unknown): boolean {
  return isObject(error) && error.code === 'ENOENT'
}
