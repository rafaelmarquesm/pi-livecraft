import assert from 'node:assert/strict'
import test from 'node:test'
import { buildCodeReviewPacket } from '../server/features/code-review/packet-builder.ts'
import { reportFromReviewerOutput } from '../server/features/code-review/review-output.ts'

const packet = {
  promptVersion: 'code-review-v1',
  cwd: '/repo',
  repositoryRoot: '/repo',
  baseSha: 'abc',
  currentSha: 'def',
  dirty: true,
  changedPaths: ['src/api.ts'],
  diffHash: 'sha256:diff',
  packet: 'packet',
  estimatedInputTokens: 2,
  truncation: {
    diffBytes: 10,
    diffBytesLimit: 96 * 1024,
    pathsLimit: 200,
    includedPaths: ['src/api.ts'],
    omittedPaths: [],
    secretExcludedPaths: [],
    gitErrors: [],
  },
} satisfies Awaited<ReturnType<typeof buildCodeReviewPacket>>

test('converts submit_code_review details into canonical report and derives fingerprints', () => {
  const report = reportFromReviewerOutput(
    {
      text: 'done',
      operationId: 'op1',
      stats: {
        provider: 'anthropic',
        model: 'claude',
        thinking: 'low',
        durationMs: 123,
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 1,
          cacheWriteTokens: 0,
          costUsd: 0.01,
        },
      },
      toolDetails: [{
        details: {
          protocol: 'pi-livecraft.code-review',
          version: 1,
          reviewedRequirementIds: ['r1'],
          findings: [{
            severity: 'P1',
            confidence: 'high',
            title: 'Route accepts invalid state',
            path: 'src/api.ts',
            line: 42,
            requirementIds: ['r1'],
            evidence: 'The parser accepts unknown values.',
            recommendation: 'Reject unknown values.',
          }],
        },
      }],
    },
    packet,
    'cycle-1',
    100,
  )

  assert.equal(report.provider, 'anthropic')
  assert.equal(report.model, 'claude')
  assert.equal(report.findings[0]?.status, 'open')
  assert.match(report.findings[0]?.fingerprint ?? '', /^sha256:/)
  assert.equal(report.reviewedRequirementIds?.[0], 'r1')
})

test('returns a valid empty report when reviewer submits no structured findings', () => {
  const report = reportFromReviewerOutput(
    {
      text: 'No concrete findings.',
      operationId: 'op1',
      stats: {
        provider: 'anthropic',
        model: 'claude',
        thinking: 'low',
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
    },
    packet,
    'cycle-1',
    100,
  )
  assert.equal(report.findings.length, 0)
  assert.equal(report.validityStatus, 'valid')
})
