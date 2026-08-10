import assert from 'node:assert/strict'
import test from 'node:test'
import type { QualityTrial } from '../evals/quality/artifact-schema.ts'
import { parseQualityArtifactJson } from '../evals/quality/artifact-schema.ts'
import { fingerprintJson, resolveInsideRoot } from '../evals/quality/fingerprint.ts'
import type { QualityManifest } from '../evals/quality/manifest.ts'
import { parseQualityManifestJson } from '../evals/quality/manifest.ts'
import { evaluateTrialValidity } from '../evals/quality/validity.ts'

function manifest(): QualityManifest {
  return {
    campaignId: 'campaign1',
    cells: [{
      arm: 'livecraft-standard',
      attempts: 3,
      id: 'cell1',
      promptHash: 'hash',
      seed: 'seed1',
      taskFingerprint: 'task-fingerprint',
      taskId: 'parser-repair',
      taskRevision: 'rev1',
    }],
    environment: { arch: 'arm64', node: 'v24.0.0', os: 'darwin' },
    limits: { maxCostUsd: 1, maxTimeMs: 1000, maxTurns: 3 },
    livecraftRevision: 'abcdef0',
    observed: { model: 'model-a', provider: 'provider-a', thinking: 'low' },
    pi: { executableSha256: 'abc123', version: '0.1.0' },
    requested: { model: 'model-a', provider: 'provider-a', thinking: 'low' },
    resources: { concurrency: 1 },
    review: {},
    timestamps: { createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    validatedWork: { mode: 'standard' },
    version: 1,
  }
}

function trial(partial: Partial<QualityTrial> = {}): QualityTrial {
  return {
    arm: 'livecraft-standard',
    attempt: 1,
    campaignId: 'campaign1',
    cellId: 'cell1',
    costUsd: 0.1,
    durationMs: 1000,
    grader: { exitCode: 0, parsed: true, passed: true, summary: 'ok' },
    id: 'trial1',
    invalidReasons: [],
    observed: { model: 'model-a', provider: 'provider-a', thinking: 'low' },
    passed: true,
    progress: [{ bestScore: 1, elapsedMs: 1000, passed: true }],
    score: 1,
    seed: 'seed1',
    settledAt: '2026-01-01T00:00:01.000Z',
    startedAt: '2026-01-01T00:00:00.000Z',
    taskFingerprint: 'task-fingerprint',
    taskId: 'parser-repair',
    taskRevision: 'rev1',
    timeToPassMs: 900,
    tokens: { cacheRead: 0, cacheWrite: 0, input: 10, output: 5 },
    valid: true,
    ...partial,
  }
}

test('strictly parses versioned manifests and rejects unknown fields', () => {
  const parsed = parseQualityManifestJson(manifest())
  assert.equal(parsed.campaignId, 'campaign1')
  assert.throws(
    () => parseQualityManifestJson({ ...manifest(), surprise: true }),
    /unknown field surprise/,
  )
  assert.throws(
    () => parseQualityManifestJson({ ...manifest(), campaignId: '../bad' }),
    /safe identifier|traversal/,
  )
})

test('strictly parses artifacts and rejects invalid reasons or arms', () => {
  const artifact = {
    campaignId: 'campaign1',
    generatedAt: '2026-01-01T00:00:02.000Z',
    manifestFingerprint: fingerprintJson({ manifest: 'fixture' }),
    trials: [trial()],
    version: 1,
  }
  assert.equal(parseQualityArtifactJson(artifact).trials[0].id, 'trial1')
  assert.throws(
    () => parseQualityArtifactJson({ ...artifact, trials: [{ ...trial(), arm: 'fake-arm' }] }),
    /Invalid quality arm/,
  )
  assert.throws(
    () =>
      parseQualityArtifactJson({
        ...artifact,
        trials: [{ ...trial(), invalidReasons: ['unknown'] }],
      }),
    /unknown invalid reason/,
  )
})

test('evaluates validity gates separately from failed-but-valid solutions', () => {
  const base = manifest()
  assert.deepEqual(evaluateTrialValidity(base, trial()).reasons, [])
  assert.deepEqual(evaluateTrialValidity(base, trial({ passed: false, score: 0 })).reasons, [])
  assert.deepEqual(
    evaluateTrialValidity(
      base,
      trial({
        grader: { exitCode: 0, parsed: false, passed: false, summary: 'bad json' },
        observed: { model: 'fallback', provider: 'provider-a', thinking: 'high' },
      }),
    )
      .reasons,
    ['grader_parse_failure', 'model_mismatch', 'thinking_mismatch'],
  )
  assert.deepEqual(
    evaluateTrialValidity(base, trial({ seed: 'other-seed' })).reasons,
    ['settings_drift'],
  )
})

test('confines artifact paths to the results root', () => {
  assert.match(
    resolveInsideRoot('/safe/root', 'campaign/artifact.json'),
    /\/safe\/root\/campaign\/artifact\.json$/,
  )
  assert.throws(() => resolveInsideRoot('/safe/root', '../artifact.json'), /escapes/)
  assert.throws(() => resolveInsideRoot('/safe/root', '/tmp/artifact.json'), /relative/)
})
