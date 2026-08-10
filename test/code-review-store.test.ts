import assert from 'node:assert/strict'
import { mkdtemp, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { CodeReviewStore } from '../server/features/code-review/review-store.ts'
import {
  CODE_REVIEW_PROTOCOL,
  CODE_REVIEW_VERSION,
  type CodeReviewReportV1,
} from '../shared/code-review.ts'

test('persists reports and decisions append-only with 0600 files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'livecraft-review-store-'))
  const store = new CodeReviewStore(root)
  const key = store.sessionKey('/repo/session.jsonl')
  let snapshot = await store.appendReport(key, report('r1'))
  assert.equal(snapshot.reports.length, 1)

  snapshot = await store.appendDecision(key, {
    reviewId: 'r1',
    findingId: 'f1',
    status: 'dismissed',
    reason: 'False positive',
    createdAt: 20,
  })
  assert.equal(snapshot.reports[0]?.findings[0]?.status, 'dismissed')
  assert.equal(snapshot.reports[0]?.findings[0]?.dismissalReason, 'False positive')

  const file = await stat(join(root, `${key}.jsonl`))
  assert.equal(file.mode & 0o777, 0o600)
})

test('dedupes reports by diff, model, provider, and thinking and tolerates trailing partial JSONL', async () => {
  const root = await mkdtemp(join(tmpdir(), 'livecraft-review-store-dedupe-'))
  const store = new CodeReviewStore(root)
  const key = store.sessionKey('/repo/session.jsonl')
  await store.appendReport(key, report('r1'))
  await store.appendReport(key, report('r2'))
  let snapshot = await store.load(key)
  assert.equal(snapshot.reports.length, 1)

  await writeFile(
    join(root, `${key}.jsonl`),
    '{"type":"status","status":"running","createdAt":1}\n{"type"',
    { mode: 0o600 },
  )
  snapshot = await store.load(key)
  assert.equal(snapshot.status, 'running')
})

function report(id: string): CodeReviewReportV1 {
  return {
    protocol: CODE_REVIEW_PROTOCOL,
    version: CODE_REVIEW_VERSION,
    id,
    cycleId: 'cycle-1',
    model: 'claude',
    provider: 'anthropic',
    thinking: 'low',
    diffHash: 'sha256:diff',
    baseRevision: 1,
    createdAt: 1,
    completedAt: 2,
    durationMs: 1,
    usage: {
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0.01,
    },
    truncation: { diff: false, files: false, findings: false, output: false },
    findings: [{
      id: 'f1',
      severity: 'P1',
      confidence: 'high',
      title: 'Bug',
      path: 'src/api.ts',
      line: 1,
      requirementIds: [],
      evidence: 'Evidence',
      recommendation: 'Fix it',
      fingerprint: 'sha256:finding',
      status: 'open',
    }],
    validityStatus: 'valid',
  }
}
