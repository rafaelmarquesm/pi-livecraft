import {
  costFromStats,
  defaultTokens,
  parseObservedFromState,
  type AgentRunConfig,
  type AgentRunResult,
} from '../driver-support.ts'
import { runGeneratedQualityTrial } from '../generated-runner.ts'
import type { QualityManifest } from '../manifest.ts'
import type { QualityDriver } from '../runner.ts'

export interface LivecraftDriverOptions {
  baseUrl?: string
  fetchImpl?: typeof fetch
}

interface LivecraftSession {
  id: string
  status?: string
}

/** Drives generated tasks through Livecraft's local HTTP API and manager path. */
export function createLivecraftQualityDriver(options: LivecraftDriverOptions = {}): QualityDriver {
  return {
    name: 'livecraft-standard',
    async runTrial(manifest: QualityManifest, cellId: string, attempt: number) {
      const cell = manifest.cells.find((candidate) => candidate.id === cellId)
      if (cell === undefined) throw new Error(`Unknown livecraft campaign cell ${cellId}`)
      return runGeneratedQualityTrial(
        manifest,
        cell,
        attempt,
        (config) => runLivecraft(config, options),
      )
    },
  }
}

async function runLivecraft(
  config: AgentRunConfig,
  options: LivecraftDriverOptions,
): Promise<AgentRunResult> {
  const startedAt = Date.now()
  const client = new LivecraftHttpClient(
    options.baseUrl ?? 'http://127.0.0.1:5174',
    options.fetchImpl ?? fetch,
  )
  const session = await client.request<LivecraftSession>('/api/sessions', {
    body: JSON.stringify({ cwd: config.workspace }),
    method: 'POST',
  }, 30_000)
  try {
    await client.command(session.id, {
      modelId: config.manifest.requested.model,
      provider: config.manifest.requested.provider,
      type: 'set_model',
    }, 30_000)
    await client.command(session.id, {
      level: config.manifest.requested.thinking,
      type: 'set_thinking_level',
    }, 30_000)
    await client.command(session.id, { message: config.prompt, type: 'prompt' }, config.timeoutMs)
    const settled = await client.waitForSettled(session.id, config.timeoutMs)
    const snapshot = await client.request<{ state?: unknown; stats?: unknown }>(
      `/api/sessions/${encodeURIComponent(session.id)}/snapshot`,
      { method: 'GET' },
      30_000,
    )
    return {
      costUsd: costFromStats(snapshot.stats),
      durationMs: Date.now() - startedAt,
      invalidReasons: [],
      observed: parseObservedFromState(snapshot.state, config.manifest.observed),
      settled,
      tokens: tokensFromStats(snapshot.stats),
    }
  } finally {
    await client
      .request(`/api/sessions/${encodeURIComponent(session.id)}/close`, {
        body: '{}',
        method: 'POST',
      }, 30_000)
      .catch(() => undefined)
  }
}

class LivecraftHttpClient {
  readonly #baseUrl: string
  readonly #fetchImpl: typeof fetch

  constructor(baseUrl: string, fetchImpl: typeof fetch) {
    this.#baseUrl = baseUrl
    this.#fetchImpl = fetchImpl
  }

  async command(
    sessionId: string,
    command: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<unknown> {
    return this.request(`/api/sessions/${encodeURIComponent(sessionId)}/commands`, {
      body: JSON.stringify(command),
      method: 'POST',
    }, timeoutMs)
  }

  async request<T = unknown>(path: string, init: RequestInit, timeoutMs: number): Promise<T> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await this.#fetchImpl(new URL(path, this.#baseUrl), {
        ...init,
        headers: typeof init.body === 'string'
          ? { 'Content-Type': 'application/json', ...init.headers }
          : init.headers,
        signal: controller.signal,
      })
      const text = await response.text()
      const value = text ? JSON.parse(text) : null
      if (!response.ok) {
        const message = isRecord(value) && typeof value.error === 'string'
          ? value.error
          : response.statusText
        throw new Error(`Livecraft HTTP ${response.status}: ${message}`)
      }
      return value as T
    } finally {
      clearTimeout(timeout)
    }
  }

  async waitForSettled(sessionId: string, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const sessions = await this.request<LivecraftSession[]>(
        '/api/sessions',
        { method: 'GET' },
        30_000,
      )
      const session = sessions.find((candidate) => candidate.id === sessionId)
      if (session?.status === 'idle' || session?.status === 'closed') return true
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    return false
  }
}

function tokensFromStats(value: unknown): ReturnType<typeof defaultTokens> {
  if (!isRecord(value)) return defaultTokens()
  const usage = isRecord(value.usage) ? value.usage : value
  return {
    cacheRead: numeric(usage.cacheReadTokens),
    cacheWrite: numeric(usage.cacheWriteTokens),
    input: numeric(usage.inputTokens),
    output: numeric(usage.outputTokens),
  }
}

function numeric(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
