import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CODE_REVIEW_PROTOCOL,
  CODE_REVIEW_VERSION,
  isCodeReviewReportV1,
  normalizeUsagePurpose,
  parseCodeReviewReportV1,
  parseUsagePurpose,
  type CodeReviewFinding,
  type CodeReviewReportV1,
} from '../shared/code-review.ts'

test('parses a strict code-review v1 report', () => {
  const report = validReport()
  assert.deepEqual(parseCodeReviewReportV1(report), report)
  assert.equal(isCodeReviewReportV1(report), true)
})

test('rejects malformed root protocol, version, required, and unknown fields', () => {
  assertInvalid((report) => setRoot(report, 'protocol', 'pi-livecraft.other'), /protocol/)
  assertInvalid((report) => setRoot(report, 'version', 2), /version/)
  assertInvalid((report) => delete setRoot(report, 'model', undefined).model, /model.*required/)
  assertInvalid((report) => setRoot(report, 'extra', true), /extra.*not allowed/)
  assert.equal(isCodeReviewReportV1({}), false)
})

test('rejects invalid review scalar values and enums without coercion', () => {
  assertInvalid((report) => setRoot(report, 'id', 'bad id'), /ASCII id/)
  assertInvalid((report) => setRoot(report, 'baseRevision', 1.2), /integer/)
  assertInvalid((report) => setRoot(report, 'createdAt', -1), /non-negative/)
  assertInvalid((report) => setRoot(report, 'durationMs', Number.NaN), /finite/)
  assertInvalid((report) => report.truncation.diff = 'false' as unknown as boolean, /boolean/)
  assertInvalid((report) => report.usage.inputTokens = 0.5, /integer/)
  assertInvalid((report) => report.usage.costUsd = -0.01, /non-negative/)
  assertInvalid(
    (report) => report.validityStatus = 'maybe' as CodeReviewReportV1['validityStatus'],
    /validityStatus/,
  )
})

test('enforces finding shape, status, severity, confidence, and location bounds', () => {
  assertInvalid(
    (report) => report.findings[0]!.severity = 'P4' as CodeReviewFinding['severity'],
    /severity/,
  )
  assertInvalid(
    (report) => report.findings[0]!.confidence = 'certain' as CodeReviewFinding['confidence'],
    /confidence/,
  )
  assertInvalid(
    (report) => report.findings[0]!.status = 'ignored' as CodeReviewFinding['status'],
    /status/,
  )
  assertInvalid((report) => report.findings[0]!.line = 0, /line.*positive/)
  assertInvalid((report) => report.findings[0]!.title = 'x'.repeat(2_001), /title exceeds 2000/)
  assertInvalid(
    (report) => report.findings[0]!.evidence = 'x'.repeat(4_001),
    /evidence exceeds 4000/,
  )
  assertInvalid((report) => {
    Object.assign(report.findings[0]!, { styleOnly: true })
  }, /styleOnly.*not allowed/)
})

test('enforces finding id uniqueness and reviewed requirement references', () => {
  assertInvalid((report) => report.findings.push({ ...report.findings[0]! }), /duplicate id f1/)
  assertInvalid((report) => report.reviewedRequirementIds = ['r1', 'r1'], /duplicate reference r1/)
  assertInvalid(
    (report) => report.findings[0]!.requirementIds = ['r1', 'r1'],
    /duplicate reference r1/,
  )
  assertInvalid((report) => report.findings[0]!.requirementIds = ['missing'], /unknown id missing/)

  const report = validReport()
  delete report.reviewedRequirementIds
  report.findings[0]!.requirementIds = ['external-r1']
  assert.equal(parseCodeReviewReportV1(report).findings[0]!.requirementIds[0], 'external-r1')
})

test('enforces finding count and serialized report size while accepting bounded fields', () => {
  assertInvalid(
    (report) =>
      report.findings = Array.from(
        { length: 51 },
        (_, index) => finding(`f${index}`, 'evidence'),
      ),
    /exceeds 50 entries/,
  )

  const report = validReport()
  report.reviewedRequirementIds = ['r1']
  report.findings = Array.from(
    { length: 50 },
    (_, index) => finding(`f${index}`, 'x'.repeat(3_000)),
  )
  assert.throws(() => parseCodeReviewReportV1(report), /serialized bytes/)
})

test('parses usage purpose strictly and normalizes legacy records to unknown', () => {
  assert.equal(parseUsagePurpose('main'), 'main')
  assert.equal(parseUsagePurpose('automated_validation'), 'automated_validation')
  assert.equal(parseUsagePurpose('code_review'), 'code_review')
  assert.equal(parseUsagePurpose('prompt_improvement'), 'prompt_improvement')
  assert.equal(parseUsagePurpose('other_isolated'), 'other_isolated')
  assert.throws(() => parseUsagePurpose('legacy'), /usagePurpose/)
  assert.equal(normalizeUsagePurpose('code_review'), 'code_review')
  assert.equal(normalizeUsagePurpose(undefined), 'unknown')
  assert.equal(normalizeUsagePurpose('legacy'), 'unknown')
})

function validReport(): CodeReviewReportV1 {
  return {
    protocol: CODE_REVIEW_PROTOCOL,
    version: CODE_REVIEW_VERSION,
    id: 'review-1',
    cycleId: 'cycle-1',
    model: 'fable',
    provider: 'anthropic',
    thinking: 'medium',
    diffHash: 'sha256:abc',
    baseRevision: 3,
    createdAt: 10,
    completedAt: 20,
    durationMs: 10,
    usage: {
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 10,
      cacheWriteTokens: 5,
      costUsd: 0.02,
    },
    truncation: { diff: false, files: false, findings: false, output: false },
    reviewedRequirementIds: ['r1'],
    findings: [finding('f1', 'The changed parser accepts an invalid enum.')],
    validityStatus: 'valid',
    validityReason: 'Complete review packet',
  }
}

function finding(id: string, evidence: string): CodeReviewFinding {
  return {
    id,
    severity: 'P1',
    confidence: 'high',
    title: 'Parser accepts invalid enum',
    path: 'shared/validated-work.ts',
    line: 42,
    requirementIds: ['r1'],
    evidence,
    recommendation: 'Reject unknown enum values at the parser boundary.',
    fingerprint: `parser-enum-${id}`,
    status: 'open',
  }
}

function assertInvalid(mutator: (report: CodeReviewReportV1) => void, pattern: RegExp): void {
  const report = structuredClone(validReport())
  mutator(report)
  assert.throws(() => parseCodeReviewReportV1(report), pattern)
}

function setRoot(
  report: CodeReviewReportV1,
  key: string,
  value: unknown,
): Record<string, unknown> {
  const root = report as unknown as Record<string, unknown>
  root[key] = value
  return root
}
