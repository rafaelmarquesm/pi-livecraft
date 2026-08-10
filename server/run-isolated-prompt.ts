import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { ISOLATED_AGENT_DIR, PiProcess } from './pi-process.ts'
import { assistantText, preferredAvailableModel } from './prompt-improvement.ts'
import type { JsonObject } from '../shared/types.ts'
import { isObject } from '../shared/is-object.ts'
import {
  AuxiliaryUsageLedger,
  type AuxiliaryUsagePurpose,
} from './features/usage/auxiliary-usage-ledger.ts'

/** Lazy-init promise so concurrent isolated prompts share a single directory setup. */
let isolatedDirReady: Promise<void> | undefined

/**
 * Creates the dedicated isolated Pi profile directory and copies auth/models from the
 * user's main config so the isolated process can authenticate and list models without
 * sharing the default-settings write target.
 */
async function ensureIsolatedAgentDir(): Promise<void> {
  if (isolatedDirReady) return isolatedDirReady
  isolatedDirReady = (async () => {
    await mkdir(ISOLATED_AGENT_DIR, { recursive: true })
    const mainDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi', 'agent')
    for (const file of ['auth.json', 'models.json']) {
      const dest = join(ISOLATED_AGENT_DIR, file)
      try {
        await stat(dest)
      } catch {
        try {
          await copyFile(join(mainDir, file), dest)
        } catch {
          // File may not exist (e.g. no custom models.json) — that's fine.
        }
      }
    }
  })()
  return isolatedDirReady
}

/** Configuration for an isolated, disposable Pi prompt execution. */
export interface RunIsolatedPromptOptions {
  /** Working directory for the Pi process. */
  cwd: string
  /** The prompt text to send (sent as-is to the model). */
  prompt: string
  /** System prompt for the disposable session (defaults to empty). */
  systemPrompt?: string
  /** Thinking level: 'off', 'low', 'medium', or 'high' (defaults to 'off'). */
  thinkingLevel?: string
  /** Model to use. When omitted, the cheapest available model is auto-selected. */
  model?: { provider: string; modelId: string }
  /** Extension paths to load. Omit to disable all extensions. */
  extensions?: string[]
  /** Tool names to load. Omit to disable all tools. */
  tools?: string[]
  /** Whether Pi loads AGENTS.md/CLAUDE.md from parent directories (default true). Set false to provide your own context. */
  includeContextFiles?: boolean
  /** Purpose used when persisting isolated operation usage outside the session ledger. */
  usagePurpose?: AuxiliaryUsagePurpose
}

export interface IsolatedPromptUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalTokens: number
  costUsd: number
}

export interface IsolatedPromptStats {
  operationId: string
  provider?: string
  model?: string
  thinking?: string
  durationMs: number
  usage: IsolatedPromptUsage
}

/** Result of running a prompt in an isolated Pi process. */
export interface IsolatedPromptResult {
  text: string
  /** USD cost of the isolated execution, if Pi exposes it. */
  cost?: number
  operationId: string
  stats: IsolatedPromptStats
  /** Structured tool result messages produced by the isolated process, if any. */
  toolDetails: JsonObject[]
}

/**
 * Runs a prompt in an isolated, disposable Pi process and returns the
 * assistant's text response with optional cost metadata.
 *
 * The process is terminated immediately after the response is extracted,
 * regardless of success or failure.
 */
export async function runIsolatedPrompt(
  options: RunIsolatedPromptOptions,
): Promise<IsolatedPromptResult> {
  await ensureIsolatedAgentDir()
  const operationId = randomUUID()
  const startedAt = Date.now()
  const pi = new PiProcess(options.cwd, randomUUID(), undefined, {
    isolated: true,
    systemPrompt: options.systemPrompt,
    thinkingLevel: options.thinkingLevel,
    extensions: options.extensions,
    tools: options.tools,
    includeContextFiles: options.includeContextFiles,
  })

  try {
    let observedModel: { provider?: string; model?: string } | undefined
    if (options.model) {
      await pi.request({
        type: 'set_model',
        provider: options.model.provider,
        modelId: options.model.modelId,
      })
      observedModel = { provider: options.model.provider, model: options.model.modelId }
    } else {
      const available = await pi.request({ type: 'get_available_models' })
      const selected = await preferredAvailableModel(available, ISOLATED_AGENT_DIR)
      if (!selected) throw new Error('No model is available to run the prompt')
      await pi.request({ type: 'set_model', provider: selected.provider, modelId: selected.id })
      observedModel = { provider: selected.provider, model: selected.id }
    }
    observedModel = modelFromState(await pi.request({ type: 'get_state' }).catch(() => ({})))
      ?? observedModel

    const settled = waitForPiEvent(pi, 'agent_settled')
    await Promise.all([
      pi.request({ type: 'prompt', message: options.prompt }),
      settled,
    ])

    const messages = await pi.request({ type: 'get_messages' })
    const text = assistantText(messages)
    if (!text) throw new Error('The model returned no text')

    const usage = usageFromStats(await pi.request({ type: 'get_session_stats' }).catch(() => ({})))
    const durationMs = Date.now() - startedAt
    const stats: IsolatedPromptStats = {
      operationId,
      ...(observedModel?.provider ? { provider: observedModel.provider } : {}),
      ...(observedModel?.model ? { model: observedModel.model } : {}),
      ...(options.thinkingLevel ? { thinking: options.thinkingLevel } : {}),
      durationMs,
      usage,
    }
    if (options.usagePurpose) {
      await new AuxiliaryUsageLedger().append({
        operationId,
        cwd: options.cwd,
        timestamp: new Date(startedAt).toISOString(),
        durationMs,
        ...(stats.provider ? { provider: stats.provider } : {}),
        ...(stats.model ? { model: stats.model } : {}),
        ...(stats.thinking ? { thinking: stats.thinking } : {}),
        purpose: options.usagePurpose,
        cost: usage.costUsd,
        totalTokens: usage.totalTokens,
        input: usage.inputTokens,
        output: usage.outputTokens,
        cacheRead: usage.cacheReadTokens,
        cacheWrite: usage.cacheWriteTokens,
      })
    }

    return {
      text,
      cost: usage.costUsd,
      operationId,
      stats,
      toolDetails: toolDetailsFromMessages(messages),
    }
  } finally {
    await pi.terminate()
  }
}

function usageFromStats(response: unknown): IsolatedPromptUsage {
  const data = isObject(response) && isObject(response.data) ? response.data : undefined
  const tokens = data && isObject(data.tokens) ? data.tokens : undefined
  const inputTokens = nonNegativeNumber(tokens?.input)
  const outputTokens = nonNegativeNumber(tokens?.output)
  const cacheReadTokens = nonNegativeNumber(tokens?.cacheRead)
  const cacheWriteTokens = nonNegativeNumber(tokens?.cacheWrite)
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens: nonNegativeNumber(tokens?.total)
      || inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens,
    costUsd: nonNegativeNumber(data?.cost),
  }
}

function modelFromState(response: unknown): { provider?: string; model?: string } | undefined {
  const data = isObject(response) && isObject(response.data) ? response.data : undefined
  if (!data) return undefined
  const provider = optionalString(data.provider ?? data.currentProvider ?? data.modelProvider)
  const model = optionalString(data.model ?? data.currentModel ?? data.modelId)
  return provider || model ? { provider, model } : undefined
}

function toolDetailsFromMessages(response: unknown): JsonObject[] {
  if (!isObject(response) || !isObject(response.data) || !Array.isArray(response.data.messages))
    return []
  return response.data.messages.flatMap((message): JsonObject[] => {
    if (!isObject(message) || message.role !== 'toolResult') return []
    return [message]
  })
}

function nonNegativeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= 200 ? value : undefined
}
/** Waits for a terminal Pi event while bounding failures from a stalled disposable process. */
function waitForPiEvent(pi: PiProcess, type: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error(`Pi event timed out: ${type}`)), 2 * 60_000)
    const onEvent = (event: JsonObject): void => {
      if (event.type === type) finish()
    }
    const onExit = (): void => finish(new Error('Pi exited before completing the prompt'))
    function finish(error?: Error): void {
      clearTimeout(timeout)
      pi.off('event', onEvent)
      pi.off('exit', onExit)
      if (error) reject(error)
      else resolve()
    }
    pi.on('event', onEvent)
    pi.once('exit', onExit)
  })
}
