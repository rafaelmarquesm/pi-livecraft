import assert from 'node:assert/strict'
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { createFakeQualityDriver } from '../evals/quality/drivers/fake.ts'
import { runQualityCampaign } from '../evals/quality/runner.ts'
import {
  applyGeneratedTaskFakeRepair,
  createGeneratedTaskRepository,
  GENERATED_TASK_IDS,
  GENERATED_TASK_REVISION,
  generatedTaskFingerprint,
  generatedTaskPrompt,
  runGeneratedTaskHiddenGrader,
  runGeneratedTaskPublicSmoke,
  type GeneratedTaskId,
} from '../evals/quality/tasks/generated.ts'
import type { QualityManifest } from '../evals/quality/manifest.ts'
import { sha256Text } from '../evals/quality/fingerprint.ts'
import { evaluateTrialValidity } from '../evals/quality/validity.ts'

function manifest(taskId: GeneratedTaskId = 'parser-repair'): QualityManifest {
  const seed = 'seed1'
  const prompt = generatedTaskPrompt(taskId, seed)
  const taskFingerprint = generatedTaskFingerprint(taskId, seed)
  return {
    campaignId: 'generated-smoke',
    cells: [
      {
        arm: 'livecraft-standard',
        attempts: 1,
        id: `standard-${taskId}`,
        promptHash: sha256Text(prompt),
        seed,
        taskFingerprint,
        taskId,
        taskRevision: GENERATED_TASK_REVISION,
      },
    ],
    environment: { arch: 'arm64', node: 'v24.0.0', os: 'darwin' },
    limits: { maxCostUsd: 1, maxTimeMs: 60_000, maxTurns: 4 },
    livecraftRevision: 'offline-fake',
    observed: { model: 'fake-model', provider: 'fake', thinking: 'none' },
    pi: { executableSha256: sha256Text('fake-pi'), version: 'fake' },
    requested: { model: 'fake-model', provider: 'fake', thinking: 'none' },
    resources: { concurrency: 1 },
    review: {},
    timestamps: { createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    validatedWork: { mode: 'fake' },
    version: 1,
  }
}

test('generated tasks create isolated Git repos with public smoke and delayed hidden graders', async () => {
  for (const taskId of GENERATED_TASK_IDS) {
    const instance = await createGeneratedTaskRepository(taskId, 'seed1')
    try {
      await assert.rejects(access(join(instance.workspace, '.hidden', 'grader.js')))
      assert.equal(instance.revision, GENERATED_TASK_REVISION)
      assert.equal(instance.promptHash, sha256Text(instance.prompt))
      assert.equal(instance.taskFingerprint, generatedTaskFingerprint(taskId, 'seed1'))

      const publicBeforeFix = await runGeneratedTaskPublicSmoke(instance)
      assert.equal(publicBeforeFix.passed, false)

      await applyGeneratedTaskFakeRepair(instance)
      assert.equal((await runGeneratedTaskPublicSmoke(instance)).passed, true)
      const hidden = await runGeneratedTaskHiddenGrader(instance)
      assert.equal(hidden.passed, true)
      assert.match(hidden.summary, /parser|cache|API/)
    } finally {
      await instance.cleanup()
    }
  }
})

test('fake driver runs generated tasks and records task fingerprints for validity gates', async () => {
  const qualityManifest = manifest('parser-repair')
  const result = await runQualityCampaign(qualityManifest, createFakeQualityDriver())
  assert.equal(result.artifact.trials.length, 1)
  const trial = result.artifact.trials[0]
  assert.equal(trial.taskRevision, GENERATED_TASK_REVISION)
  assert.equal(trial.taskFingerprint, qualityManifest.cells[0].taskFingerprint)
  assert.equal(trial.valid, true)
  assert.deepEqual(evaluateTrialValidity(qualityManifest, trial).reasons, [])
  assert.equal(trial.grader.parsed, true)
  assert.equal(trial.passed, true)
})
