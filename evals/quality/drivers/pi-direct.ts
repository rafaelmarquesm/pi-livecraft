import {
  costFromStats,
  defaultTokens,
  parseObservedFromState,
  RpcJsonLineProcess,
  tokensFromStats,
  type AgentRunConfig,
  type AgentRunResult,
} from '../driver-support.ts'
import { fileURLToPath } from 'node:url'
import { runGeneratedQualityTrial } from '../generated-runner.ts'
import type { QualityManifest } from '../manifest.ts'
import type { QualityDriver } from '../runner.ts'

export interface PiDirectDriverOptions {
  executable?: string
  executableArgs?: readonly string[]
  tools?: readonly string[]
}

const DEFAULT_TOOLS = ['read', 'grep', 'find', 'ls', 'bash', 'edit', 'write'] as const
const VALIDATED_WORK_EXTENSION = fileURLToPath(
  new URL('../../../pi-extensions/validated-work/index.ts', import.meta.url),
)
const VALIDATED_WORK_ACTIVATE_COMMAND = '/livecraft-validated-work {"mode":"validated"}'
const VALIDATED_WORK_APPROVE_COMMAND = '/livecraft-validated-work {"action":"approve"}'

/** Runs a generated coding task through a disposable `pi --mode rpc --no-session` process. */
export function createPiDirectQualityDriver(options: PiDirectDriverOptions = {}): QualityDriver {
  return {
    name: 'pi-direct',
    async runTrial(manifest: QualityManifest, cellId: string, attempt: number) {
      const cell = manifest.cells.find((candidate) => candidate.id === cellId)
      if (cell === undefined) throw new Error(`Unknown pi-direct campaign cell ${cellId}`)
      return runGeneratedQualityTrial(
        manifest,
        cell,
        attempt,
        (config) => runPiDirect(config, options),
      )
    },
  }
}

async function runPiDirect(
  config: AgentRunConfig,
  options: PiDirectDriverOptions,
): Promise<AgentRunResult> {
  const startedAt = Date.now()
  const validatedArm = config.cell.arm === 'livecraft-validated'
  const pi = new RpcJsonLineProcess(
    options.executable ?? 'pi',
    [
      ...(options.executableArgs ?? []),
      '--mode',
      'rpc',
      '--no-session',
      '--provider',
      config.manifest.requested.provider,
      '--model',
      config.manifest.requested.model,
      '--thinking',
      config.manifest.requested.thinking,
      '--tools',
      (options.tools ?? DEFAULT_TOOLS).join(','),
      ...(validatedArm ? ['--extension', VALIDATED_WORK_EXTENSION] : ['--no-extensions']),
    ],
    config.workspace,
  )
  try {
    let settled = true
    try {
      if (validatedArm) {
        await pi.request(
          { message: VALIDATED_WORK_ACTIVATE_COMMAND, type: 'prompt' },
          config.timeoutMs,
        )
        await pi.request(
          { message: VALIDATED_WORK_APPROVE_COMMAND, type: 'prompt' },
          config.timeoutMs,
        )
      }
      await Promise.all([
        pi.request({ message: config.prompt, type: 'prompt' }, config.timeoutMs),
        pi.waitForEvent('agent_settled', config.timeoutMs),
      ])
    } catch {
      settled = false
    }

    let observed = config.manifest.observed
    let costUsd = 0
    let tokens = defaultTokens()
    try {
      const state = await pi.request({ type: 'get_state' }, 30_000)
      observed = parseObservedFromState(state.data, config.manifest.observed)
    } catch {
      observed = config.manifest.observed
    }
    try {
      const stats = await pi.request({ type: 'get_session_stats' }, 30_000)
      costUsd = costFromStats(stats.data)
      tokens = tokensFromStats(stats.data)
    } catch {
      tokens = defaultTokens()
    }

    return {
      costUsd,
      durationMs: Date.now() - startedAt,
      invalidReasons: [],
      observed,
      settled,
      stderr: pi.stderr,
      tokens,
    }
  } finally {
    await pi.terminate()
  }
}
