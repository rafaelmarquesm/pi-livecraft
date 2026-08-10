import type { QualityTrial } from '../artifact-schema.ts'
import { sha256Text } from '../fingerprint.ts'
import type { QualityManifest } from '../manifest.ts'
import type { QualityDriver } from '../runner.ts'

function deterministicUnit(seed: string): number {
  const digest = sha256Text(seed)
  return Number.parseInt(digest.slice(0, 8), 16) / 0xffffffff
}

/** Offline deterministic driver. livecraft-validated is intentionally degraded to prove comparisons detect regressions. */
export function createFakeQualityDriver(): QualityDriver {
  return {
    name: 'fake',
    async runTrial(
      manifest: QualityManifest,
      cellId: string,
      attempt: number,
    ): Promise<QualityTrial> {
      const cell = manifest.cells.find((candidate) => candidate.id === cellId)
      if (cell === undefined) throw new Error(`Unknown fake campaign cell ${cellId}`)

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
        taskId: cell.taskId,
        taskRevision: cell.taskRevision,
        timeToPassMs,
        tokens: {
          cacheRead: 0,
          cacheWrite: 0,
          input: 1_000 + attempt * 10,
          output: Math.round(200 + unit * 100),
        },
        valid: true,
      }
    },
  }
}
