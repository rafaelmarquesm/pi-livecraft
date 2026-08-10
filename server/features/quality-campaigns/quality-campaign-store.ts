import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import {
  INVALID_REASON_CODES,
  type InvalidReasonCode,
  readQualityArtifact,
  type QualityArtifact,
  type QualityTrial,
} from '../../../evals/quality/artifact-schema.ts'
import { summarizeTrialsByArm } from '../../../evals/quality/compare.ts'
import {
  assertSafeIdentifier,
  fingerprintJson,
  type FingerprintJson,
  resolveInsideRoot,
} from '../../../evals/quality/fingerprint.ts'
import {
  parseQualityManifestText,
  type QualityArm,
  type QualityManifest,
} from '../../../evals/quality/manifest.ts'
import {
  invalidReasonCounts,
  pairedDeltas,
  progressCurve,
} from '../../../evals/quality/statistics.ts'
import type {
  QualityCampaignArmDetail,
  QualityCampaignDetailResponse,
  QualityCampaignListItem,
  QualityCampaignListResponse,
  QualityCampaignPairedDelta,
  QualityCampaignProgressSeries,
  QualityCampaignProvenance,
  QualityCampaignRawTrial,
} from '../../../shared/quality-campaigns.ts'

const DEFAULT_PASS_AT_K = 3

export class QualityCampaignNotFoundError extends Error {}
export class QualityCampaignPathError extends Error {}

export interface QualityCampaignStoreOptions {
  resultsRoot: string
  passAtK?: number
}

export class QualityCampaignStore {
  readonly #resultsRoot: string
  readonly #passAtK: number

  constructor(options: QualityCampaignStoreOptions) {
    this.#resultsRoot = options.resultsRoot
    this.#passAtK = options.passAtK ?? DEFAULT_PASS_AT_K
  }

  async list(): Promise<QualityCampaignListResponse> {
    let entries
    try {
      entries = await readdir(this.#resultsRoot, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { campaigns: [] }
      throw error
    }

    const campaigns: QualityCampaignListItem[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      try {
        assertSafeIdentifier(entry.name, 'campaign id')
        const artifact = await this.#readArtifact(entry.name)
        const arms = sortedArms(artifact.trials)
        const validTrials = artifact.trials.filter((trial) => trial.valid).length
        campaigns.push({
          arms,
          generatedAt: artifact.generatedAt,
          id: artifact.campaignId,
          invalidTrials: artifact.trials.length - validTrials,
          smallSample: hasSmallSample(artifact.trials),
          totalTrials: artifact.trials.length,
          validTrials,
        })
      } catch (error) {
        if (error instanceof QualityCampaignPathError) throw error
        // Incomplete or malformed campaign directories are ignored in the list;
        // opening a concrete id still reports the parse error to the caller.
      }
    }
    campaigns.sort((left, right) => right.generatedAt.localeCompare(left.generatedAt))
    return { campaigns }
  }

  async detail(campaignId: string): Promise<QualityCampaignDetailResponse> {
    let safeId: string
    try {
      safeId = assertSafeIdentifier(campaignId, 'campaign id')
    } catch (error) {
      throw new QualityCampaignPathError(errorMessage(error))
    }
    const artifact = await this.#readArtifact(safeId)
    const manifestRecord = await this.#readManifest(safeId)
    const manifest = manifestRecord?.manifest ?? null
    const arms = armDetails(artifact.trials, this.#passAtK)
    const winnerSuppressedReasons = noWinnerReasons(artifact, manifestRecord, arms)
    const winner = winnerSuppressedReasons.length === 0 ? winningArm(arms) : null
    return {
      arms,
      generatedAt: artifact.generatedAt,
      id: artifact.campaignId,
      invalidReasons: invalidReasonsObject(artifact.trials),
      pairedDeltas: campaignPairedDeltas(artifact.trials),
      progress: campaignProgress(artifact.trials),
      provenance: provenance(artifact, manifest),
      rawTrials: artifact.trials.map(rawTrial),
      winner,
      winnerSuppressedReasons,
    }
  }

  async #readArtifact(campaignId: string): Promise<QualityArtifact> {
    const path = this.#resolve(campaignId, 'artifact.json')
    try {
      const artifact = await readQualityArtifact(path)
      if (artifact.campaignId !== campaignId) throw new Error('artifact campaign id mismatch')
      return artifact
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new QualityCampaignNotFoundError(`Quality campaign ${campaignId} was not found`)
      }
      throw error
    }
  }

  async #readManifest(
    campaignId: string,
  ): Promise<{ fingerprint: string; manifest: QualityManifest } | null> {
    try {
      const text = await readFile(this.#resolve(campaignId, 'campaign.json'), 'utf8')
      return {
        fingerprint: fingerprintJson(JSON.parse(text) as FingerprintJson),
        manifest: parseQualityManifestText(text),
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  #resolve(campaignId: string, fileName: string): string {
    try {
      return resolveInsideRoot(this.#resultsRoot, join(campaignId, fileName))
    } catch (error) {
      throw new QualityCampaignPathError(errorMessage(error))
    }
  }
}

export function defaultQualityResultsRoot(): string {
  return process.env.PI_LIVECRAFT_QUALITY_RESULTS_ROOT ?? 'evals/quality/results'
}

function armDetails(trials: readonly QualityTrial[], k: number): QualityCampaignArmDetail[] {
  const byArm = new Map(summarizeTrialsByArm(trials, k).map((summary) => [summary.arm, summary]))
  return sortedArms(trials).map((arm) => {
    const armTrials = trials.filter((trial) => trial.arm === arm)
    const summary = byArm.get(arm)
    if (summary === undefined) throw new Error(`Missing quality arm summary ${arm}`)
    return {
      ...summary,
      costUsd: armTrials.reduce((sum, trial) => sum + trial.costUsd, 0),
      durationMs: armTrials.reduce((sum, trial) => sum + trial.durationMs, 0),
      tokens: armTrials.reduce(
        (tokens, trial) => ({
          cacheRead: tokens.cacheRead + trial.tokens.cacheRead,
          cacheWrite: tokens.cacheWrite + trial.tokens.cacheWrite,
          input: tokens.input + trial.tokens.input,
          output: tokens.output + trial.tokens.output,
        }),
        { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
      ),
    }
  })
}

function sortedArms(trials: readonly QualityTrial[]): QualityArm[] {
  return [...new Set(trials.map((trial) => trial.arm))].sort((left, right) =>
    left.localeCompare(right)
  )
}

function hasSmallSample(trials: readonly QualityTrial[]): boolean {
  return sortedArms(trials).some((arm) =>
    trials.filter((trial) => trial.arm === arm && trial.valid).length < DEFAULT_PASS_AT_K
  )
}

function invalidReasonsObject(trials: readonly QualityTrial[]): Record<InvalidReasonCode, number> {
  const counts = invalidReasonCounts(trials)
  return Object.fromEntries(
    INVALID_REASON_CODES.map((reason) => [reason, counts.get(reason) ?? 0]),
  ) as Record<InvalidReasonCode, number>
}

function campaignPairedDeltas(trials: readonly QualityTrial[]): QualityCampaignPairedDelta[] {
  const [leftArm, rightArm] = sortedArms(trials)
  if (leftArm === undefined || rightArm === undefined) return []
  return pairedDeltas(
    trials.filter((trial) => trial.arm === leftArm),
    trials.filter((trial) => trial.arm === rightArm),
    (trial) => trial.score,
  )
    .map((delta) => ({ ...delta, leftArm, rightArm }))
}

function campaignProgress(trials: readonly QualityTrial[]): QualityCampaignProgressSeries[] {
  return sortedArms(trials).map((arm) => ({
    arm,
    points: progressCurve(trials.filter((trial) => trial.arm === arm)),
  }))
}

function provenance(
  artifact: QualityArtifact,
  manifest: QualityManifest | null,
): QualityCampaignProvenance {
  return {
    campaignUpdatedAt: manifest?.timestamps.updatedAt ?? null,
    environment: manifest?.environment ?? null,
    livecraftRevision: manifest?.livecraftRevision ?? null,
    manifestFingerprint: artifact.manifestFingerprint,
    observed: manifest?.observed ?? null,
    piExecutableSha256: manifest?.pi.executableSha256 ?? null,
    piVersion: manifest?.pi.version ?? null,
    requested: manifest?.requested ?? null,
  }
}

function noWinnerReasons(
  artifact: QualityArtifact,
  manifestRecord: { fingerprint: string; manifest: QualityManifest } | null,
  arms: readonly QualityCampaignArmDetail[],
): string[] {
  const reasons: string[] = []
  if (artifact.trials.every((trial) => !trial.valid)) reasons.push('zero valid trials')
  if (arms.some((arm) => arm.validTrials < 3)) reasons.push('fewer than 3 valid trials per cell')
  if (artifact.trials.some((trial) => trial.invalidReasons.includes('settings_drift'))) {
    reasons.push('settings drift invalidated at least one trial')
  }
  if (manifestRecord !== null && manifestRecord.fingerprint !== artifact.manifestFingerprint) {
    reasons.push('campaign manifest fingerprint diverged')
  }
  if (arms.length < 2) reasons.push('fewer than two arms compared')
  if (arms.length >= 2 && intervalsOverlap(arms))
    reasons.push('confidence intervals are inconclusive')
  return [...new Set(reasons)]
}

function intervalsOverlap(arms: readonly QualityCampaignArmDetail[]): boolean {
  const comparable = arms.filter((arm) => arm.wilson !== null && arm.passAt1 !== null)
  if (comparable.length < 2) return true
  comparable.sort((left, right) => (right.passAt1 ?? 0) - (left.passAt1 ?? 0))
  const [best, runnerUp] = comparable
  if (best?.wilson === null || runnerUp?.wilson === null) return true
  return best.wilson.lower <= runnerUp.wilson.upper
}

function winningArm(
  arms: readonly QualityCampaignArmDetail[],
): { arm: QualityArm; reason: string } | null {
  const ordered = [...arms].sort((left, right) => (right.passAt1 ?? -1) - (left.passAt1 ?? -1))
  const best = ordered[0]
  if (best === undefined) return null
  return { arm: best.arm, reason: 'highest non-overlapping pass@1 interval with valid sample size' }
}

function rawTrial(trial: QualityTrial): QualityCampaignRawTrial {
  return {
    arm: trial.arm,
    attempt: trial.attempt,
    costUsd: trial.costUsd,
    durationMs: trial.durationMs,
    id: trial.id,
    invalidReasons: trial.invalidReasons,
    passed: trial.passed,
    score: trial.score,
    seed: trial.seed,
    taskId: trial.taskId,
    valid: trial.valid,
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
