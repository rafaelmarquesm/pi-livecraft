import assert from 'node:assert/strict'
import test from 'node:test'
import { createInitialState, buildSummary } from '../pi-extensions/validated-work/state.ts'
import {
  parseQualitySummaryStatus,
  requirementTraceability,
} from '../src/features/quality/quality-state.ts'
import { formatCheckCounts, qualityModes } from '../src/features/quality/quality-display.ts'

test('quality summary status parses reserved extension status JSON', () => {
  const state = createInitialState('plan', 1)
  const summary = buildSummary(state)
  assert.deepEqual(parseQualitySummaryStatus(JSON.stringify(summary)), summary)
  assert.equal(parseQualitySummaryStatus('not json'), null)
  assert.equal(parseQualitySummaryStatus(undefined), null)
})

test('quality display reports modes and observable check counts without a score', () => {
  assert.equal(qualityModes.standard.label, 'Standard')
  assert.equal(qualityModes.plan.label, 'Plan first')
  assert.match(qualityModes.validated.description, /Experimental/)
  assert.equal(
    formatCheckCounts({ passed: 1, failed: 2, blocked: 3, pending: 4 }),
    '1 passed, 2 failed, 3 blocked, 4 pending',
  )
})

test('requirement traceability counts checks and linked evidence per requirement', () => {
  const state = {
    ...createInitialState('plan', 1),
    requirements: [{ id: 'r1', text: 'Do the thing', source: 'explicit' as const }],
    checks: [{
      id: 'c1',
      requirementIds: ['r1'],
      itemIds: [],
      text: 'Run focused test',
      status: 'pending' as const,
      evidenceIds: ['e1'],
    }],
    evidence: [{
      id: 'e1',
      kind: 'observed_check' as const,
      summary: 'test passed',
      observedAt: 2,
      checkIds: ['c1'],
    }],
  }
  assert.deepEqual(requirementTraceability(state), [{
    requirementId: 'r1',
    requirement: 'Do the thing',
    checks: 1,
    evidence: 1,
  }])
})
