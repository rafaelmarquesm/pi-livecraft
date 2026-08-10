import type { QualityTrial } from '../artifact-schema.ts'
import {
  defaultTokens,
  deterministicUnit,
  findQualityCell,
  type AgentRunResult,
} from '../driver-support.ts'
import { runGeneratedQualityTrial } from '../generated-runner.ts'
import type { QualityManifest } from '../manifest.ts'
import type { QualityDriver } from '../runner.ts'
import {
  applyGeneratedTaskFakeRepair,
  GENERATED_TASK_REVISION,
  isGeneratedTaskId,
} from '../tasks/generated.ts'

/** Offline deterministic driver. livecraft-validated is intentionally degraded to prove comparisons detect regressions. */
export function createFakeQualityDriver(): QualityDriver {
  return {
    name: 'fake',
    async runTrial(
      manifest: QualityManifest,
      cellId: string,
      attempt: number,
    ): Promise<QualityTrial> {
      const cell = findQualityCell(manifest, cellId)
      const taskId = cell.taskId
      if (!isGeneratedTaskId(taskId)) return legacyFakeTrial(manifest, cellId, attempt)
      return runGeneratedQualityTrial(
        manifest,
        cell,
        attempt,
        async (config): Promise<AgentRunResult> => {
          const unit = deterministicUnit(`${cell.taskId}:${cell.seed}:${cell.arm}:${attempt}`)
          const degraded = cell.arm === 'livecraft-validated'
          const shouldRepair = !degraded || unit < 0.35
          if (shouldRepair) {
            await applyGeneratedTaskFakeRepair({
              cleanup: async () => {},
              hiddenGradeCommand: ['npm', 'run', 'grade'],
              id: taskId,
              materializeHiddenGrader: async () => {},
              prompt: config.prompt,
              promptHash: cell.promptHash,
              publicSmokeCommand: ['npm', 'run', 'smoke'],
              revision: GENERATED_TASK_REVISION,
              seed: cell.seed,
              taskFingerprint: cell.taskFingerprint,
              workspace: config.workspace,
            })
          }
          return {
            costUsd: Number((0.005 + unit * 0.02 + (degraded ? 0.01 : 0)).toFixed(6)),
            durationMs: Math.round(500 + unit * 1_500),
            invalidReasons: [],
            observed: manifest.observed,
            settled: true,
            tokens: {
              cacheRead: 0,
              cacheWrite: 0,
              input: 800 + attempt * 10,
              output: Math.round(120 + unit * 80),
            },
          }
        },
      )
    },
  }
}

function legacyFakeTrial(manifest: QualityManifest, cellId: string, attempt: number): QualityTrial {
  const cell = findQualityCell(manifest, cellId)
  const degraded = cell.arm === 'livecraft-validated'
  const unit = deterministicUnit(`${cell.taskId}:${cell.seed}:${cell.arm}:${attempt}`)
  const passThreshold = degraded ? 0.35 : 0.72
  const passed = unit < passThreshold
  const score = passed ? 1 - unit / 2 : unit / 3
  const durationMs = Math.round(1_000 + unit * 4_000 + (degraded ? 1_000 : 0))
  const timeToPassMs = passed ? Math.round(durationMs * (0.4 + unit * 0.3)) : null
  const startedAt = new Date(Date.UTC(2026, 0, 1, 0, 0, attempt)).toISOString()
  const settledAt = new Date(Date.UTC(2026, 0, 1, 0, 0, attempt, durationMs)).toISOString()

  return {
    arm: cell.arm,
    attempt,
    campaignId: manifest.campaignId,
    cellId,
    costUsd: Number((0.01 + unit * 0.04 + (degraded ? 0.02 : 0)).toFixed(6)),
    durationMs,
    grader: {
      exitCode: 0,
      parsed: true,
      passed,
      summary: passed ? 'fake grader pass' : 'fake grader fail',
    },
    id: `${cell.id}-attempt-${attempt}`,
    invalidReasons: [],
    observed: manifest.observed,
    passed,
    progress: [
      { bestScore: score / 2, elapsedMs: Math.round(durationMs * 0.5), passed: false },
      { bestScore: score, elapsedMs: durationMs, passed },
    ],
    score: Number(score.toFixed(6)),
    seed: cell.seed,
    settledAt,
    startedAt,
    taskFingerprint: cell.taskFingerprint,
    taskId: cell.taskId,
    taskRevision: cell.taskRevision,
    timeToPassMs,
    tokens: defaultTokens(),
    valid: true,
  }
}
