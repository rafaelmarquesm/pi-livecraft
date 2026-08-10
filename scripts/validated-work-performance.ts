import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { beforeValidatedWorkAgentStart } from '../pi-extensions/validated-work/handlers.ts'
import {
  buildSummary,
  createInitialState,
  defaultConfig,
  maxSummaryBytes,
  summaryJson,
  validatedWorkConfigType,
  validatedWorkToolName,
} from '../pi-extensions/validated-work/state.ts'
import { extractValidatedWorkDetails } from '../server/features/validated-work/validated-work-state.ts'
import {
  buildCodeReviewPacket,
  maxReviewPacketBytes,
} from '../server/features/code-review/packet-builder.ts'
import {
  parseValidatedWorkStateV1,
  VALIDATED_WORK_LIMITS,
  type ValidatedWorkStateV1,
} from '../shared/validated-work.ts'
import type { JsonObject } from '../shared/types.ts'
import { RpcProcess } from '../test/support/rpc-process.ts'

const execFileAsync = promisify(execFile)
const encoder = new TextEncoder()
const extractionEntryCount = 5_000

export const validatedWorkPerformanceBudgets = {
  noopHandlerP95Ms: 1,
  coldExtractionMs: 25,
  incrementalExtractionP95Ms: 10,
  summaryBytes: maxSummaryBytes,
  fullStatePayloadBytes: 128 * 1024,
  qualityStateHeapBytes: 1024 * 1024,
  reviewPacketBytes: 96 * 1024,
} as const

export const unsupportedValidatedWorkMeasurements = [
  'mode standard token delta: requires a paired provider-backed prompt run; no provider data is fabricated',
  'manager ready, backend ready, browser interactive, first session snapshot, and quality detail open: require a running full Livecraft stack',
  'provider-backed review latency, tokens, and cost: require an explicitly configured provider run',
] as const

export interface ValidatedWorkCorePerformance {
  noopHandlerP95Ms: number
  coldExtractionMs: number
  incrementalExtractionP95Ms: number
  summaryBytes: number
  fullStatePayloadBytes: number
  extractionEntries: number
  qualityStateHeapBytes: number | null
}

export interface RealPiResourceMeasurement {
  sessions: number
  readyP95Ms: number
  rssMiB: number
  rssPerSessionMiB: number
  pssMiB: number | null
  pssPerSessionMiB: number | null
}

export interface ReviewPacketPerformance {
  bytes: number
  buildMs: number
  limitBytes: number
}

export type RealPiResourceMatrix =
  | { supported: true; pssSupported: boolean; measurements: RealPiResourceMeasurement[] }
  | { supported: false; reason: string; measurements: [] }

/** Runs the deterministic, provider-independent section 12 microbenchmarks. */
export function measureValidatedWorkCorePerformance(): ValidatedWorkCorePerformance {
  const state = representativeFullState()
  const entries = extractionEntries(state)
  const noopHandlerP95Ms = measureNoopHandlerP95()

  // Prime module/JIT paths with a small input, without warming the 5k-entry fixture.
  extractValidatedWorkDetails('warmup', [], 0)
  const coldSamples = Array.from({ length: 7 }, () => {
    const freshEntries = [...entries]
    const startedAt = performance.now()
    extractValidatedWorkDetails('cold', freshEntries, 0)
    return performance.now() - startedAt
  })
  const coldExtractionMs = percentile(coldSamples, 0.5)

  const incrementalState = parseValidatedWorkStateV1({
    ...state,
    revision: state.revision + 1,
    updatedAt: state.updatedAt + 1,
  })
  const incrementalEntries = [
    ...entries,
    toolResultEntry(incrementalState),
  ] as unknown as JsonObject[]
  for (let index = 0; index < 10; index += 1) {
    extractValidatedWorkDetails('incremental-warmup', incrementalEntries, 0)
  }
  const incrementalSamples = Array.from({ length: 40 }, () => {
    const startedAt = performance.now()
    extractValidatedWorkDetails('incremental', incrementalEntries, 0)
    return performance.now() - startedAt
  })

  const summaryBytes = byteLength(summaryJson(summaryStressState()))
  const fullStatePayloadBytes = byteLength(
    JSON.stringify(extractValidatedWorkDetails('payload', entries, 0).response),
  )
  const qualityStateHeapBytes = measureAggregateQualityStateHeapBytes()

  return {
    noopHandlerP95Ms,
    coldExtractionMs,
    incrementalExtractionP95Ms: percentile(incrementalSamples, 0.95),
    summaryBytes,
    fullStatePayloadBytes,
    extractionEntries: entries.length,
    qualityStateHeapBytes,
  }
}

function measureAggregateQualityStateHeapBytes(): number | null {
  const gc = (globalThis as { gc?: () => void }).gc
  if (!gc) return null
  gc()
  const before = process.memoryUsage().heapUsed
  const retained = Array.from({ length: 200 }, () => representativeFullState())
  gc()
  const after = process.memoryUsage().heapUsed
  if (retained.length !== 200) throw new Error('Quality state memory fixture was not retained.')
  return Math.max(0, after - before) / retained.length
}

/** Builds a deterministic oversized Git diff and verifies the bounded packet path without a model. */
export async function measureReviewPacketPerformance(): Promise<ReviewPacketPerformance> {
  const cwd = await mkdtemp(join(tmpdir(), 'pi-livecraft-review-performance-'))
  try {
    await runGit(cwd, ['init'])
    await runGit(cwd, ['config', 'user.email', 'performance@example.com'])
    await runGit(cwd, ['config', 'user.name', 'Performance'])
    await writeFile(join(cwd, 'large.ts'), 'export const baseline = true\n')
    await runGit(cwd, ['add', 'large.ts'])
    await runGit(cwd, ['commit', '-m', 'baseline'])
    await writeFile(
      join(cwd, 'large.ts'),
      `export const payload = ${JSON.stringify('x'.repeat(maxReviewPacketBytes * 2))}\n`,
    )
    const startedAt = performance.now()
    const packet = await buildCodeReviewPacket({
      cwd,
      sessionId: 'performance',
      details: { state: null, summary: null, review: null, stale: false },
    })
    return {
      bytes: byteLength(packet.packet),
      buildMs: performance.now() - startedAt,
      limitBytes: maxReviewPacketBytes,
    }
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
}

/** Spawns real offline Pi RPC children and measures aggregate RSS plus Linux PSS at 1/3/10. */
export async function measureRealPiResources(
  counts: readonly number[] = [1, 3, 10],
): Promise<RealPiResourceMatrix> {
  const targets = [...new Set(counts)].sort((left, right) => left - right)
  if (targets.length === 0 || targets.some((count) => !Number.isInteger(count) || count <= 0)) {
    return {
      supported: false,
      reason: 'Session counts must be positive integers.',
      measurements: [],
    }
  }
  const root = await mkdtemp(join(tmpdir(), 'pi-livecraft-performance-'))
  const processes: RpcProcess[] = []
  const readySamples: number[] = []
  const measurements: RealPiResourceMeasurement[] = []
  try {
    for (const target of targets) {
      while (processes.length < target) {
        const directory = join(root, `session-${processes.length + 1}`)
        await mkdir(directory, { recursive: true })
        const startedAt = performance.now()
        const pi = new RpcProcess({
          args: ['--offline', '--no-extensions', '--session-dir', directory],
          cwd: directory,
        })
        processes.push(pi)
        const response = await pi.request({ type: 'get_state' }, 30_000)
        if (response.type !== 'response' || response.success !== true) {
          throw new Error(`Pi get_state did not become ready: ${JSON.stringify(response)}`)
        }
        readySamples.push(performance.now() - startedAt)
      }
      const pids = processes.map((process) => process.pid)
      if (pids.some((pid) => pid === undefined))
        throw new Error('A Pi child process did not expose a pid.')
      const numericPids = pids as number[]
      const rssKiB = sum(await Promise.all(numericPids.map(readRssKiB)))
      const pssValues = await Promise.all(numericPids.map(readPssKiB))
      const pssKiB = pssValues.every((value) => value !== null)
        ? sum(pssValues as number[])
        : null
      measurements.push({
        sessions: target,
        readyP95Ms: percentile(readySamples, 0.95),
        rssMiB: rssKiB / 1024,
        rssPerSessionMiB: rssKiB / 1024 / target,
        pssMiB: pssKiB === null ? null : pssKiB / 1024,
        pssPerSessionMiB: pssKiB === null ? null : pssKiB / 1024 / target,
      })
    }
    return {
      supported: true,
      pssSupported: measurements.every((measurement) => measurement.pssMiB !== null),
      measurements,
    }
  } catch (error) {
    return {
      supported: false,
      reason: error instanceof Error ? error.message : String(error),
      measurements: [],
    }
  } finally {
    await Promise.allSettled(processes.map((process) => process.terminate()))
    await rm(root, { recursive: true, force: true })
  }
}

function measureNoopHandlerP95(): number {
  const inactiveState = {
    ...createInitialState('plan', 1),
    mode: 'standard' as const,
    phase: 'idle' as const,
  }
  let unexpectedResults = 0
  for (let index = 0; index < 20_000; index += 1) {
    if (beforeValidatedWorkAgentStart(inactiveState) !== undefined) unexpectedResults += 1
  }
  const iterationsPerSample = 10_000
  const samples = Array.from({ length: 40 }, () => {
    const startedAt = performance.now()
    for (let index = 0; index < iterationsPerSample; index += 1) {
      if (beforeValidatedWorkAgentStart(inactiveState) !== undefined) unexpectedResults += 1
    }
    return (performance.now() - startedAt) / iterationsPerSample
  })
  if (unexpectedResults !== 0) throw new Error('Standard mode added an unexpected prompt override.')
  return percentile(samples, 0.95)
}

function representativeFullState(): ValidatedWorkStateV1 {
  const base = createInitialState('validated', 1)
  const requirements = Array.from({ length: 40 }, (_, index) => ({
    id: `r${index}`,
    text: `Requirement ${index} ${'x'.repeat(180)}`,
    source: 'explicit' as const,
  }))
  const goals = Array.from({ length: 12 }, (_, index) => ({
    id: `g${index}`,
    title: `Goal ${index} ${'x'.repeat(120)}`,
    requirementIds: [`r${index % requirements.length}`],
    status: 'pending' as const,
  }))
  const items = Array.from({ length: 80 }, (_, index) => ({
    id: `t${index}`,
    goalId: `g${index % goals.length}`,
    requirementIds: [`r${index % requirements.length}`],
    text: `Task ${index} ${'x'.repeat(220)}`,
    status: 'pending' as const,
    confidence: 'plausible' as const,
  }))
  const evidence = Array.from({ length: 160 }, (_, index) => ({
    id: `e${index}`,
    kind: 'observed_check' as const,
    summary: `Evidence ${index} ${'x'.repeat(280)}`,
    observedAt: index + 1,
    checkIds: [`c${index % items.length}`],
  }))
  const checks = Array.from({ length: 80 }, (_, index) => ({
    id: `c${index}`,
    requirementIds: [`r${index % requirements.length}`],
    itemIds: [`t${index}`],
    text: `Check ${index} ${'x'.repeat(180)}`,
    status: 'passed' as const,
    evidenceIds: [`e${index}`, `e${index + items.length}`],
  }))
  return parseValidatedWorkStateV1({
    ...base,
    userIntent: `Intent ${'x'.repeat(500)}`,
    requirements,
    goals,
    items,
    checks,
    evidence,
  })
}

function summaryStressState(): ValidatedWorkStateV1 {
  return parseValidatedWorkStateV1({
    ...createInitialState('validated', 1),
    readinessReasons: Array.from({ length: 12 }, (_, index) => ({
      code: `blocked-${index}`,
      text: `Blocking reason ${index} ${'x'.repeat(220)}`,
      requirementIds: [],
      itemIds: [],
      checkIds: [],
      findingIds: [],
    })),
  })
}

function extractionEntries(state: ValidatedWorkStateV1): JsonObject[] {
  const entries: unknown[] = Array.from({ length: extractionEntryCount - 2 }, (_, index) => ({
    type: 'message',
    message: { role: 'user', content: `Unrelated entry ${index}` },
  }))
  entries.push({
    type: 'custom',
    customType: validatedWorkConfigType,
    data: { ...defaultConfig(1), mode: 'validated' },
  })
  entries.push(toolResultEntry(state))
  return entries as JsonObject[]
}

function toolResultEntry(state: ValidatedWorkStateV1): unknown {
  return {
    type: 'message',
    message: { role: 'toolResult', toolName: validatedWorkToolName, details: state },
  }
}

function percentile(values: readonly number[], percentileValue: number): number {
  if (values.length === 0) throw new Error('Cannot calculate a percentile without samples.')
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * percentileValue) - 1)
  return sorted[index]
}

function byteLength(value: string): number {
  return encoder.encode(value).length
}

async function readRssKiB(pid: number): Promise<number> {
  const { stdout } = await execFileAsync('ps', ['-o', 'rss=', '-p', String(pid)], {
    encoding: 'utf8',
  })
  const value = Number(stdout.trim())
  if (!Number.isFinite(value)) throw new Error(`ps returned an invalid RSS value for pid ${pid}.`)
  return value
}

async function runGit(cwd: string, args: readonly string[]): Promise<void> {
  await execFileAsync('git', args, { cwd })
}

async function readPssKiB(pid: number): Promise<number | null> {
  try {
    const content = await readFile(`/proc/${pid}/smaps_rollup`, 'utf8')
    const match = /^Pss:\s+(\d+)\s+kB$/m.exec(content)
    return match ? Number(match[1]) : null
  } catch {
    return null
  }
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

export function assertValidatedWorkPerformanceBudgets(
  measurements: ValidatedWorkCorePerformance,
): void {
  const failures: string[] = []
  if (measurements.noopHandlerP95Ms >= validatedWorkPerformanceBudgets.noopHandlerP95Ms) {
    failures.push(
      `no-op handler p95 ${
        measurements.noopHandlerP95Ms.toFixed(3)
      } ms >= ${validatedWorkPerformanceBudgets.noopHandlerP95Ms} ms`,
    )
  }
  if (measurements.coldExtractionMs >= validatedWorkPerformanceBudgets.coldExtractionMs) {
    failures.push(
      `cold extraction ${
        measurements.coldExtractionMs.toFixed(3)
      } ms >= ${validatedWorkPerformanceBudgets.coldExtractionMs} ms`,
    )
  }
  if (
    measurements.incrementalExtractionP95Ms
      >= validatedWorkPerformanceBudgets.incrementalExtractionP95Ms
  ) {
    failures.push(
      `incremental extraction p95 ${
        measurements.incrementalExtractionP95Ms.toFixed(3)
      } ms >= ${validatedWorkPerformanceBudgets.incrementalExtractionP95Ms} ms`,
    )
  }
  if (measurements.summaryBytes > validatedWorkPerformanceBudgets.summaryBytes) {
    failures.push(
      `summary ${measurements.summaryBytes} bytes > ${validatedWorkPerformanceBudgets.summaryBytes} bytes`,
    )
  }
  if (measurements.fullStatePayloadBytes > validatedWorkPerformanceBudgets.fullStatePayloadBytes) {
    failures.push(
      `full state ${measurements.fullStatePayloadBytes} bytes > ${validatedWorkPerformanceBudgets.fullStatePayloadBytes} bytes`,
    )
  }
  if (
    measurements.qualityStateHeapBytes !== null
    && measurements.qualityStateHeapBytes > validatedWorkPerformanceBudgets.qualityStateHeapBytes
  ) {
    failures.push(
      `quality state aggregate heap ${
        measurements.qualityStateHeapBytes.toFixed(0)
      } bytes > ${validatedWorkPerformanceBudgets.qualityStateHeapBytes} bytes`,
    )
  }
  if (measurements.extractionEntries !== extractionEntryCount) {
    failures.push(
      `extraction fixture has ${measurements.extractionEntries} entries, expected ${extractionEntryCount}`,
    )
  }
  if (failures.length > 0) throw new Error(failures.join('\n'))
}

export function representativeStateBytes(): number {
  return byteLength(JSON.stringify(representativeFullState()))
}

export function configuredStateByteLimit(): number {
  return VALIDATED_WORK_LIMITS.serializedStateBytes
}

export function summaryStressBytes(): number {
  return byteLength(JSON.stringify(buildSummary(summaryStressState())))
}
