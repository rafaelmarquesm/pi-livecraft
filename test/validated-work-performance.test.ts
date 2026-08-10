import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'
import { CodeReviewCoordinator } from '../server/features/code-review/review-coordinator.ts'
import { CodeReviewStore } from '../server/features/code-review/review-store.ts'
import {
  assertValidatedWorkPerformanceBudgets,
  configuredStateByteLimit,
  measureReviewPacketPerformance,
  measureValidatedWorkCorePerformance,
  representativeStateBytes,
  summaryStressBytes,
  validatedWorkPerformanceBudgets,
} from '../scripts/validated-work-performance.ts'

const exec = promisify(execFile)

test('validated-work deterministic performance matrix stays within section 12 budgets', () => {
  const measurements = measureValidatedWorkCorePerformance()
  assertValidatedWorkPerformanceBudgets(measurements)
  assert.equal(measurements.extractionEntries, 5_000)
  assert.ok(representativeStateBytes() > 100 * 1024)
  assert.ok(representativeStateBytes() <= configuredStateByteLimit())
  assert.ok(summaryStressBytes() <= validatedWorkPerformanceBudgets.summaryBytes)
})

test('review packet total payload stays within 96 KiB', async () => {
  const measurement = await measureReviewPacketPerformance()
  assert.ok(measurement.bytes <= measurement.limitBytes, JSON.stringify(measurement))
  assert.equal(measurement.limitBytes, validatedWorkPerformanceBudgets.reviewPacketBytes)
})

test('unchanged diff triggers zero additional review calls', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'livecraft-review-dedupe-performance-'))
  const storeRoot = await mkdtemp(join(tmpdir(), 'livecraft-review-store-performance-'))
  t.after(async () => {
    await Promise.all([
      rm(cwd, { recursive: true, force: true }),
      rm(storeRoot, { recursive: true, force: true }),
    ])
  })
  await git(cwd, ['init'])
  await git(cwd, ['config', 'user.email', 'performance@example.com'])
  await git(cwd, ['config', 'user.name', 'Performance'])
  await writeFile(join(cwd, 'README.md'), 'base\n')
  await git(cwd, ['add', 'README.md'])
  await git(cwd, ['commit', '-m', 'base'])
  await writeFile(join(cwd, 'README.md'), 'changed\n')

  let reviewCalls = 0
  const coordinator = new CodeReviewCoordinator({
    store: new CodeReviewStore(storeRoot),
    manager: {
      async runReview() {
        reviewCalls += 1
        return {
          text: 'No findings.',
          operationId: `review-${reviewCalls}`,
          stats: {
            provider: 'offline',
            model: 'deterministic',
            thinking: 'off',
            durationMs: 1,
            usage: {
              inputTokens: 0,
              outputTokens: 0,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              costUsd: 0,
            },
          },
          toolDetails: [],
        }
      },
      async sendSummary() {},
      async sendPrompt() {},
    },
    onUpdate() {},
  })
  const context = {
    sessionId: 'performance-session',
    sessionIdentity: 'performance-session-identity',
    cwd,
    details: { state: null, summary: null, review: null, stale: false } as const,
  }
  const options = {
    mode: 'manual' as const,
    model: { provider: 'offline', modelId: 'deterministic' },
    thinkingLevel: 'off',
  }

  const first = await coordinator.runManual(context, options)
  const second = await coordinator.runManual(context, options)
  assert.equal(reviewCalls, 1)
  assert.equal(first.reports.length, 1)
  assert.equal(second.reports.length, 1)
  assert.equal(second.reports[0]?.diffHash, first.reports[0]?.diffHash)
})

async function git(cwd: string, args: readonly string[]): Promise<void> {
  await exec('git', args, { cwd })
}
