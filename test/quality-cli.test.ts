import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import test from 'node:test'
import { buildGeneratedCampaignManifest } from '../evals/quality/cli.ts'
import { readQualityArtifact } from '../evals/quality/artifact-schema.ts'
import { readQualityManifest } from '../evals/quality/manifest.ts'
import { runBoundedProcess } from '../evals/quality/process.ts'

test('buildGeneratedCampaignManifest creates one cell per arm and task with deterministic metadata', async () => {
  const manifest = await buildGeneratedCampaignManifest({
    arms: ['livecraft-standard', 'livecraft-validated'],
    attempts: 3,
    campaignId: 'quality-run',
    maxCostUsd: 2,
    maxTimeMs: 45_000,
    maxTurns: 4,
    requested: { model: 'fake-model', provider: 'fake', thinking: 'none' },
    tasks: ['parser-repair', 'state-cache'],
  })

  assert.equal(manifest.cells.length, 4)
  assert.deepEqual(
    manifest.cells.map((cell) => cell.id),
    [
      'livecraft-standard-parser-repair-seed1',
      'livecraft-validated-parser-repair-seed1',
      'livecraft-standard-state-cache-seed1',
      'livecraft-validated-state-cache-seed1',
    ],
  )
  assert.equal(manifest.limits.maxTimeMs, 45_000)
  assert.equal(manifest.requested.provider, 'fake')
  assert.equal(manifest.observed.model, 'fake-model')
})

test('quality CLI run writes manifest, artifact, and summary for a fake campaign', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quality-cli-run-'))
  try {
    const result = await runBoundedProcess(process.execPath, [
      'evals/quality/cli.ts',
      'run',
      '--driver',
      'fake',
      '--campaign-id',
      'cli-fake',
      '--results-root',
      root,
      '--provider',
      'fake',
      '--model',
      'fake-model',
      '--thinking',
      'none',
      '--arms',
      'livecraft-standard,livecraft-validated',
      '--tasks',
      'parser-repair',
      '--k',
      '2',
      '--budget-usd',
      '1',
      '--max-time-ms',
      '60000',
    ], {
      cwd: join(import.meta.dirname, '..'),
      timeoutMs: 120_000,
    })
    assert.equal(result.exitCode, 0, result.stderr || result.stdout)

    const artifactPath = join(root, 'cli-fake', 'artifact.json')
    const manifestPath = join(root, 'cli-fake', 'manifest.json')
    const summaryPath = join(root, 'cli-fake', 'summary.md')
    const artifact = await readQualityArtifact(artifactPath)
    const manifest = await readQualityManifest(manifestPath)
    const summary = await readFile(summaryPath, 'utf8')

    assert.equal(relative(root, artifactPath), 'cli-fake/artifact.json')
    assert.equal(manifest.campaignId, 'cli-fake')
    assert.equal(artifact.campaignId, 'cli-fake')
    assert.equal(artifact.trials.length, 4)
    assert.match(summary, /# Quality comparison/)
    assert.match(summary, /livecraft-standard/)
    assert.match(summary, /livecraft-validated/)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test('quality CLI run rejects unsafe campaign ids before writing results', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quality-cli-run-'))
  try {
    const result = await runBoundedProcess(process.execPath, [
      'evals/quality/cli.ts',
      'run',
      '--driver',
      'fake',
      '--campaign-id',
      '../bad',
      '--results-root',
      root,
      '--provider',
      'fake',
      '--model',
      'fake-model',
      '--thinking',
      'none',
      '--arms',
      'livecraft-standard',
      '--tasks',
      'parser-repair',
      '--k',
      '1',
    ], {
      cwd: join(import.meta.dirname, '..'),
      timeoutMs: 120_000,
    })
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr || result.stdout, /safe identifier|traversal/)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})
