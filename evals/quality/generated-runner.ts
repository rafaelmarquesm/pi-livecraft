import type { QualityTrial } from './artifact-schema.ts'
import {
  createTrialFromAgentRun,
  type AgentRunConfig,
  type AgentRunResult,
} from './driver-support.ts'
import type { QualityCampaignCell, QualityManifest } from './manifest.ts'
import {
  createGeneratedTaskRepository,
  isGeneratedTaskId,
  runGeneratedTaskHiddenGrader,
} from './tasks/generated.ts'

export type GeneratedAgentRun = (config: AgentRunConfig) => Promise<AgentRunResult>

/** Creates a generated repo, lets the agent act, then materializes hidden grading only after the run. */
export async function runGeneratedQualityTrial(
  manifest: QualityManifest,
  cell: QualityCampaignCell,
  attempt: number,
  runAgent: GeneratedAgentRun,
): Promise<QualityTrial> {
  if (!isGeneratedTaskId(cell.taskId)) throw new Error(`Unsupported generated task ${cell.taskId}`)
  const instance = await createGeneratedTaskRepository(cell.taskId, cell.seed)
  const startedAt = new Date().toISOString()
  try {
    const run = await runAgent({
      cell,
      manifest,
      prompt: instance.prompt,
      timeoutMs: manifest.limits.maxTimeMs,
      workspace: instance.workspace,
    })
    const graderRun = await runGeneratedTaskHiddenGrader(instance)
    return createTrialFromAgentRun(manifest, cell, attempt, startedAt, run, {
      durationMs: graderRun.durationMs,
      exitCode: graderRun.exitCode,
      parsed: true,
      passed: graderRun.passed,
      summary: graderRun.summary,
    })
  } finally {
    await instance.cleanup()
  }
}
