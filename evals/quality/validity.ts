import type { InvalidReasonCode, QualityTrial } from './artifact-schema.ts'
import type { QualityManifest } from './manifest.ts'

export interface TrialValidityResult {
  valid: boolean
  reasons: InvalidReasonCode[]
}

function addReason(
  reasons: Set<InvalidReasonCode>,
  condition: boolean,
  reason: InvalidReasonCode,
): void {
  if (condition) reasons.add(reason)
}

/** Evaluates reproducibility gates that can be checked from the manifest and trial artifact. */
export function evaluateTrialValidity(
  manifest: QualityManifest,
  trial: QualityTrial,
): TrialValidityResult {
  const reasons = new Set<InvalidReasonCode>(trial.invalidReasons)
  addReason(reasons, trial.observed.provider !== manifest.requested.provider, 'provider_mismatch')
  addReason(reasons, trial.observed.model !== manifest.requested.model, 'model_mismatch')
  addReason(reasons, trial.observed.thinking !== manifest.requested.thinking, 'thinking_mismatch')
  addReason(reasons, !trial.grader.parsed && trial.grader.exitCode === 0, 'grader_parse_failure')
  addReason(reasons, !trial.grader.parsed && trial.grader.exitCode !== 0, 'grader_missing')
  addReason(reasons, trial.campaignId !== manifest.campaignId, 'artifact_incomplete')

  const matchingCell = manifest.cells.find((cell) => cell.id === trial.cellId)
  addReason(reasons, matchingCell === undefined, 'artifact_incomplete')
  if (matchingCell !== undefined) {
    addReason(reasons, matchingCell.arm !== trial.arm, 'settings_drift')
    addReason(reasons, matchingCell.taskId !== trial.taskId, 'settings_drift')
    addReason(reasons, matchingCell.taskRevision !== trial.taskRevision, 'settings_drift')
    addReason(reasons, matchingCell.seed !== trial.seed, 'settings_drift')
  }

  return { reasons: [...reasons].sort(), valid: reasons.size === 0 }
}

/** Returns only trials that pass validity gates. */
export function validTrials(
  manifest: QualityManifest,
  trials: readonly QualityTrial[],
): QualityTrial[] {
  return trials.filter((trial) => evaluateTrialValidity(manifest, trial).valid)
}

/** Fails if a cell has too few valid attempts for winner claims. */
export function assertComparableCells(
  manifest: QualityManifest,
  trials: readonly QualityTrial[],
  minimumValid = 3,
): void {
  for (const cell of manifest.cells) {
    const count = trials
      .filter((trial) => trial.cellId === cell.id && evaluateTrialValidity(manifest, trial).valid)
      .length
    if (count < minimumValid)
      throw new Error(
        `Cell ${cell.id} has ${count} valid trials, expected at least ${minimumValid}`,
      )
  }
}
