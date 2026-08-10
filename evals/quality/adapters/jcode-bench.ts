import { platform } from 'node:os'
import { resolve } from 'node:path'
import { assertSafeIdentifier, resolveInsideRoot } from '../fingerprint.ts'

export interface JcodeBenchAdapterOptions {
  enabled: boolean
  benchmarkRoot: string
  resultsRoot: string
  campaignId: string
  taskIds: string[]
  maxCostUsd: number
  timeoutMs: number
}

export interface JcodeBenchAdapterPlan {
  kind: 'jcode-bench'
  benchmarkRoot: string
  outputDirectory: string
  taskIds: string[]
  maxCostUsd: number
  timeoutMs: number
  linuxOnly: true
  attribution: string
}

/**
 * Builds a bounded, opt-in Jcode Bench plan without starting providers.
 * The caller must perform explicit approval and execute the returned plan in a Linux sandbox.
 */
export function createJcodeBenchAdapterPlan(
  options: JcodeBenchAdapterOptions,
): JcodeBenchAdapterPlan {
  if (!options.enabled) throw new Error('Jcode Bench adapter is opt-in and disabled')
  if (platform() !== 'linux') throw new Error('Jcode Bench adapter is Linux-only')
  if (!Number.isFinite(options.maxCostUsd) || options.maxCostUsd <= 0) {
    throw new Error('Jcode Bench adapter requires a positive USD budget')
  }
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1) {
    throw new Error('Jcode Bench adapter requires a positive timeout')
  }
  if (options.taskIds.length === 0) throw new Error('At least one Jcode Bench task is required')
  const campaignId = assertSafeIdentifier(options.campaignId, 'campaign id')
  return {
    attribution:
      'Jcode Bench by 1jehuang/jcode-bench; use the upstream license and pinned revision.',
    benchmarkRoot: resolve(options.benchmarkRoot),
    kind: 'jcode-bench',
    linuxOnly: true,
    maxCostUsd: options.maxCostUsd,
    outputDirectory: resolveInsideRoot(options.resultsRoot, `${campaignId}/external/jcode-bench`),
    taskIds: options.taskIds.map((taskId) => assertSafeIdentifier(taskId, 'task id')),
    timeoutMs: options.timeoutMs,
  }
}
