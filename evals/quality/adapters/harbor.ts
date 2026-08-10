import { resolve } from 'node:path'
import { assertSafeIdentifier, resolveInsideRoot } from '../fingerprint.ts'

export interface HarborAdapterOptions {
  enabled: boolean
  harborRoot: string
  resultsRoot: string
  campaignId: string
  taskNames: string[]
  maxCostUsd: number
  timeoutMs: number
  maxTasks: number
}

export interface HarborAdapterPlan {
  kind: 'harbor-terminal-bench'
  harborRoot: string
  outputDirectory: string
  taskNames: string[]
  maxCostUsd: number
  timeoutMs: number
  maxTasks: number
  attribution: string
}

/**
 * Builds a bounded Harbor pilot plan without executing Terminal-Bench or providers.
 * The adapter is intentionally small until campaign artifacts prove the suite is useful.
 */
export function createHarborAdapterPlan(options: HarborAdapterOptions): HarborAdapterPlan {
  if (!options.enabled) throw new Error('Harbor adapter is opt-in and disabled')
  if (!Number.isFinite(options.maxCostUsd) || options.maxCostUsd <= 0) {
    throw new Error('Harbor adapter requires a positive USD budget')
  }
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1) {
    throw new Error('Harbor adapter requires a positive timeout')
  }
  if (!Number.isInteger(options.maxTasks) || options.maxTasks < 1) {
    throw new Error('Harbor adapter requires a positive task cap')
  }
  if (options.taskNames.length === 0) throw new Error('At least one Harbor task is required')
  if (options.taskNames.length > options.maxTasks)
    throw new Error('Harbor task list exceeds the cap')
  const campaignId = assertSafeIdentifier(options.campaignId, 'campaign id')
  return {
    attribution:
      'Harbor Terminal-Bench adapter scaffold; respect upstream Terminal-Bench task licenses.',
    harborRoot: resolve(options.harborRoot),
    kind: 'harbor-terminal-bench',
    maxCostUsd: options.maxCostUsd,
    maxTasks: options.maxTasks,
    outputDirectory: resolveInsideRoot(options.resultsRoot, `${campaignId}/external/harbor`),
    taskNames: options.taskNames.map((taskName) => assertSafeIdentifier(taskName, 'task name')),
    timeoutMs: options.timeoutMs,
  }
}
