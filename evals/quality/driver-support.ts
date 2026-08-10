import { EventEmitter } from 'node:events'
import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import type { JsonObject } from '../../shared/types.ts'
import type { InvalidReasonCode, QualityTrial } from './artifact-schema.ts'
import { sha256Text } from './fingerprint.ts'
import type { QualityCampaignCell, QualityManifest } from './manifest.ts'

export interface AgentRunResult {
  observed: QualityTrial['observed']
  costUsd: number
  tokens: QualityTrial['tokens']
  durationMs: number
  invalidReasons: InvalidReasonCode[]
  settled: boolean
  stderr?: string
}

export interface AgentRunConfig {
  manifest: QualityManifest
  cell: QualityCampaignCell
  prompt: string
  workspace: string
  timeoutMs: number
}

export function findQualityCell(manifest: QualityManifest, cellId: string): QualityCampaignCell {
  const cell = manifest.cells.find((candidate) => candidate.id === cellId)
  if (cell === undefined) throw new Error(`Unknown quality campaign cell ${cellId}`)
  return cell
}

export function defaultTokens(): QualityTrial['tokens'] {
  return { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 }
}

export function createTrialFromAgentRun(
  manifest: QualityManifest,
  cell: QualityCampaignCell,
  attempt: number,
  startedAt: string,
  run: AgentRunResult,
  grader: {
    exitCode: number | null
    parsed: boolean
    passed: boolean
    summary: string
    durationMs: number
  },
): QualityTrial {
  const invalidReasons = [...run.invalidReasons]
  if (!run.settled) invalidReasons.push('settle_missing')
  if (!grader.parsed)
    invalidReasons.push(grader.exitCode === 0 ? 'grader_parse_failure' : 'grader_missing')
  const valid = invalidReasons.length === 0
  const passed = valid && grader.passed
  const durationMs = run.durationMs + grader.durationMs
  return {
    arm: cell.arm,
    attempt,
    campaignId: manifest.campaignId,
    cellId: cell.id,
    costUsd: run.costUsd,
    durationMs,
    grader: {
      exitCode: grader.exitCode ?? -1,
      parsed: grader.parsed,
      passed: grader.passed,
      summary: grader.summary,
    },
    id: `${cell.id}-attempt-${attempt}`,
    invalidReasons: [...new Set(invalidReasons)].sort(),
    observed: run.observed,
    passed,
    progress: [{ bestScore: passed ? 1 : 0, elapsedMs: durationMs, passed }],
    score: passed ? 1 : 0,
    seed: cell.seed,
    settledAt: new Date(Date.now()).toISOString(),
    startedAt,
    taskFingerprint: cell.taskFingerprint,
    taskId: cell.taskId,
    taskRevision: cell.taskRevision,
    timeToPassMs: passed ? durationMs : null,
    tokens: run.tokens,
    valid,
  }
}

export function parseObservedFromState(
  state: unknown,
  fallback: QualityTrial['observed'],
): QualityTrial['observed'] {
  if (!isRecord(state)) return fallback
  const model = isRecord(state.model) ? state.model : null
  const provider = typeof model?.provider === 'string' ? model.provider : fallback.provider
  const modelId = typeof model?.id === 'string' ? model.id : fallback.model
  const thinking = typeof state.thinkingLevel === 'string' ? state.thinkingLevel : fallback.thinking
  return { model: modelId, provider, thinking }
}

export function tokensFromStats(value: unknown): QualityTrial['tokens'] {
  if (!isRecord(value)) return defaultTokens()
  const usage = isRecord(value.usage) ? value.usage : value
  return {
    cacheRead: numeric(usage.cacheReadTokens),
    cacheWrite: numeric(usage.cacheWriteTokens),
    input: numeric(usage.inputTokens),
    output: numeric(usage.outputTokens),
  }
}

export function costFromStats(value: unknown): number {
  return isRecord(value) && typeof value.cost === 'number' && Number.isFinite(value.cost)
    ? value.cost
    : 0
}

export class RpcJsonLineProcess {
  readonly #child: ChildProcessWithoutNullStreams
  readonly #events = new EventEmitter()
  readonly #pending = new Map<
    string,
    {
      reject: (error: Error) => void
      resolve: (value: JsonObject) => void
      timeout: NodeJS.Timeout
    }
  >()
  readonly #exited: Promise<void>
  #nextRequestId = 0
  #stderr = ''

  constructor(
    command: string,
    args: readonly string[],
    cwd: string,
    env: NodeJS.ProcessEnv = process.env,
  ) {
    this.#child = spawn(command, [...args], {
      cwd,
      env,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.#exited = new Promise((resolveExit) => this.#child.once('close', () => resolveExit()))
    const decoder = new JsonLineDecoder((value) => this.#receive(value))
    this.#child.stdout.on('data', (chunk: Buffer) => decoder.push(chunk))
    this.#child.stdout.on('end', () => decoder.end())
    this.#child.stderr.on('data', (chunk: Buffer) => {
      this.#stderr = `${this.#stderr}${chunk.toString('utf8')}`.slice(-16_384)
    })
    this.#child.on('error', (error) => this.#fail(error))
    this.#child.on('close', (code, signal) => {
      this.#fail(
        new Error(`RPC process exited (${signal ?? code ?? 'unknown'}): ${this.#stderr.trim()}`),
      )
    })
  }

  get stderr(): string {
    return this.#stderr
  }

  request(command: JsonObject, timeoutMs: number): Promise<JsonObject> {
    const id = `quality-${this.#nextRequestId += 1}`
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(id)
        reject(new Error(`RPC command timed out: ${String(command.type)}`))
      }, timeoutMs)
      this.#pending.set(id, { reject, resolve, timeout })
      this.#child.stdin.write(`${JSON.stringify({ ...command, id })}\n`)
    })
  }

  waitForEvent(type: string, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => finish(new Error(`RPC event timed out: ${type}`)), timeoutMs)
      const onEvent = (event: JsonObject): void => {
        if (event.type === type) finish()
      }
      const finish = (error?: Error): void => {
        clearTimeout(timeout)
        this.#events.off('event', onEvent)
        if (error) reject(error)
        else resolve()
      }
      this.#events.on('event', onEvent)
    })
  }

  async terminate(): Promise<void> {
    if (this.#child.exitCode !== null || this.#child.signalCode !== null) return
    this.#child.kill('SIGTERM')
    await Promise.race([this.#exited, new Promise<void>((resolve) => setTimeout(resolve, 2_000))])
    if (this.#child.exitCode === null && this.#child.signalCode === null) {
      this.#child.kill('SIGKILL')
      await this.#exited
    }
  }

  #receive(value: unknown): void {
    if (!isRecord(value)) return
    if (value.type === 'response' && typeof value.id === 'string') {
      const pending = this.#pending.get(value.id)
      if (!pending) return
      clearTimeout(pending.timeout)
      this.#pending.delete(value.id)
      if (value.success === false)
        pending.reject(new Error(String(value.error ?? 'RPC command failed')))
      else pending.resolve(value)
      return
    }
    this.#events.emit('event', value)
  }

  #fail(cause: unknown): void {
    const error = cause instanceof Error ? cause : new Error(String(cause))
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
    this.#pending.clear()
  }
}

class JsonLineDecoder {
  #buffer = ''
  readonly #onValue: (value: unknown) => void

  constructor(onValue: (value: unknown) => void) {
    this.#onValue = onValue
  }

  push(chunk: Buffer): void {
    this.#buffer += chunk.toString('utf8')
    let newline = this.#buffer.indexOf('\n')
    while (newline !== -1) {
      const line = this.#buffer.slice(0, newline).trim()
      this.#buffer = this.#buffer.slice(newline + 1)
      if (line) this.#onValue(JSON.parse(line))
      newline = this.#buffer.indexOf('\n')
    }
  }

  end(): void {
    const line = this.#buffer.trim()
    this.#buffer = ''
    if (line) this.#onValue(JSON.parse(line))
  }
}

function numeric(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function deterministicUnit(seed: string): number {
  const digest = sha256Text(seed)
  return Number.parseInt(digest.slice(0, 8), 16) / 0xffffffff
}
