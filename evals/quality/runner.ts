import {
  QUALITY_ARTIFACT_VERSION,
  type QualityArtifact,
  type QualityTrial,
} from './artifact-schema.ts'
import { fingerprintManifest, type QualityManifest } from './manifest.ts'
import { redactJson, type RedactableJson } from './redaction.ts'

export interface QualityDriver {
  name: string
  runTrial(manifest: QualityManifest, cellId: string, attempt: number): Promise<QualityTrial>
}

export interface QualityRunResult {
  artifact: QualityArtifact
}

/** Runs a manifest with a driver and returns a redacted, parseable artifact. */
export async function runQualityCampaign(
  manifest: QualityManifest,
  driver: QualityDriver,
): Promise<QualityRunResult> {
  const trials: QualityTrial[] = []
  for (const cell of manifest.cells) {
    for (let attempt = 1; attempt <= cell.attempts; attempt += 1) {
      trials.push(await driver.runTrial(manifest, cell.id, attempt))
    }
  }

  const artifact: QualityArtifact = {
    campaignId: manifest.campaignId,
    generatedAt: new Date().toISOString(),
    manifestFingerprint: fingerprintManifest(manifest),
    trials,
    version: QUALITY_ARTIFACT_VERSION,
  }
  return {
    artifact: redactJson(artifact as unknown as RedactableJson) as unknown as QualityArtifact,
  }
}
