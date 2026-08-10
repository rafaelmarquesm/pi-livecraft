import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  QUALITY_ARTIFACT_VERSION,
  type QualityArtifact,
  type QualityTrial,
} from '../evals/quality/artifact-schema.ts'
import { fingerprintManifest, type QualityManifest } from '../evals/quality/manifest.ts'
import {
  QualityCampaignPathError,
  QualityCampaignStore,
} from '../server/features/quality-campaigns/quality-campaign-store.ts'

const startedAt = '2026-01-01T00:00:00.000Z'
const settledAt = '2026-01-01T00:00:01.000Z'

function trial(overrides: Partial<QualityTrial> & Pick<QualityTrial, 'arm' | 'id'>): QualityTrial {
  return {
    attempt: 1,
    campaignId: 'fixture-campaign',
    cellId: `${overrides.arm}-cell`,
    costUsd: 0.01,
    durationMs: 1000,
    grader: { exitCode: 0, parsed: true, passed: overrides.passed ?? true, summary: 'graded' },
    invalidReasons: [],
    observed: { model: 'fixture-model', provider: 'fixture', thinking: 'none' },
    passed: true,
    progress: [{ bestScore: 1, elapsedMs: 1000, passed: true }],
    score: 1,
    seed: 'seed1',
    settledAt,
    startedAt,
    taskFingerprint: 'sha256:task',
    taskId: 'parser-repair',
    taskRevision: 'v1',
    timeToPassMs: 1000,
    tokens: { cacheRead: 0, cacheWrite: 0, input: 10, output: 5 },
    valid: true,
    ...overrides,
  }
}

function manifest(): QualityManifest {
  return {
    campaignId: 'fixture-campaign',
    cells: [
      {
        arm: 'livecraft-standard',
        attempts: 1,
        id: 'standard-cell',
        promptHash: 'sha256:prompt',
        seed: 'seed1',
        taskFingerprint: 'sha256:task',
        taskId: 'parser-repair',
        taskRevision: 'v1',
      },
      {
        arm: 'livecraft-validated',
        attempts: 1,
        id: 'validated-cell',
        promptHash: 'sha256:prompt',
        seed: 'seed1',
        taskFingerprint: 'sha256:task',
        taskId: 'parser-repair',
        taskRevision: 'v1',
      },
    ],
    environment: { arch: 'arm64', node: 'v24.0.0', os: 'darwin' },
    limits: { maxCostUsd: 1, maxTimeMs: 60_000, maxTurns: 4 },
    livecraftRevision: 'fixture-revision',
    observed: { model: 'fixture-model', provider: 'fixture', thinking: 'none' },
    pi: { executableSha256: 'sha256:pi', version: '0.84.1' },
    requested: { model: 'fixture-model', provider: 'fixture', thinking: 'none' },
    resources: { concurrency: 1 },
    review: {},
    timestamps: { createdAt: startedAt, updatedAt: settledAt },
    validatedWork: { mode: 'validated' },
    version: 1,
  }
}

async function writeCampaign(trials: QualityTrial[], manifestValue = manifest()): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'quality-campaign-store-'))
  const directory = join(root, 'fixture-campaign')
  await mkdir(directory, { recursive: true })
  const artifact: QualityArtifact = {
    campaignId: 'fixture-campaign',
    generatedAt: settledAt,
    manifestFingerprint: fingerprintManifest(manifestValue),
    trials,
    version: QUALITY_ARTIFACT_VERSION,
  }
  await writeFile(join(directory, 'artifact.json'), `${JSON.stringify(artifact)}\n`)
  await writeFile(join(directory, 'campaign.json'), `${JSON.stringify(manifestValue)}\n`)
  return root
}

test('quality campaign store lists only artifacts and marks small samples', async () => {
  const root = await writeCampaign([
    trial({ arm: 'livecraft-standard', id: 'standard-1' }),
    trial({
      arm: 'livecraft-validated',
      id: 'validated-1',
      valid: false,
      invalidReasons: ['settings_drift'],
      passed: false,
    }),
  ])
  await mkdir(join(root, 'not-a-campaign'))
  await writeFile(join(root, 'not-a-campaign', 'artifact.json'), '{"bad":true}\n')

  const list = await new QualityCampaignStore({ resultsRoot: root }).list()

  assert.equal(list.campaigns.length, 1)
  assert.equal(list.campaigns[0]?.id, 'fixture-campaign')
  assert.equal(list.campaigns[0]?.validTrials, 1)
  assert.equal(list.campaigns[0]?.invalidTrials, 1)
  assert.equal(list.campaigns[0]?.smallSample, true)
})

test('quality campaign detail reports provenance metrics deltas progress and no winner reasons', async () => {
  const root = await writeCampaign([
    trial({
      arm: 'livecraft-standard',
      id: 'standard-1',
      score: 0,
      passed: false,
      timeToPassMs: null,
    }),
    trial({ arm: 'livecraft-validated', id: 'validated-1', score: 1, passed: true }),
    trial({
      arm: 'livecraft-validated',
      id: 'validated-2',
      valid: false,
      invalidReasons: ['settings_drift'],
      passed: false,
    }),
  ])

  const detail = await new QualityCampaignStore({ resultsRoot: root }).detail('fixture-campaign')

  assert.equal(detail.provenance.livecraftRevision, 'fixture-revision')
  assert.deepEqual(detail.arms.map((arm) => arm.arm), ['livecraft-standard', 'livecraft-validated'])
  assert.equal(detail.arms[0]?.validTrials, 1)
  assert.equal(detail.arms[1]?.invalidTrials, 1)
  assert.equal(detail.arms[1]?.passAt1, 1)
  assert.equal(detail.arms[1]?.passAtK, null)
  assert.equal(detail.arms[1]?.tokens.input, 20)
  assert.equal(detail.pairedDeltas.length, 1)
  assert.equal(detail.progress.length, 2)
  assert.equal(detail.invalidReasons.settings_drift, 1)
  assert.equal(detail.winner, null)
  assert.match(detail.winnerSuppressedReasons.join('\n'), /fewer than 3 valid trials/)
  assert.match(detail.winnerSuppressedReasons.join('\n'), /settings drift/)
})

test('quality campaign detail rejects traversal ids before reading results root', async () => {
  const store = new QualityCampaignStore({
    resultsRoot: await mkdtemp(join(tmpdir(), 'quality-campaign-store-')),
  })
  await assert.rejects(() => store.detail('../fixture-campaign'), QualityCampaignPathError)
})
