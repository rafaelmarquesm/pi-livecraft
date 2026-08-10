import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isValidatedWorkStateV1,
  parseValidatedWorkStateV1,
  VALIDATED_WORK_PROTOCOL,
  VALIDATED_WORK_VERSION,
  type ValidatedWorkStateV1,
} from '../shared/validated-work.ts'

test('parses a strict validated-work v1 state', () => {
  const state = validState()
  assert.deepEqual(parseValidatedWorkStateV1(state), state)
  assert.equal(isValidatedWorkStateV1(state), true)
})

test('rejects malformed root protocol, version, required, and unknown fields', () => {
  assertInvalid((state) => setRoot(state, 'protocol', 'pi-livecraft.other'), /protocol/)
  assertInvalid((state) => setRoot(state, 'version', 2), /version/)
  assertInvalid((state) => delete setRoot(state, 'mode', undefined).mode, /mode.*required/)
  assertInvalid((state) => setRoot(state, 'extra', true), /extra.*not allowed/)
  assert.equal(isValidatedWorkStateV1({}), false)
})

test('rejects invalid scalar values and enums without coercion', () => {
  assertInvalid((state) => setRoot(state, 'cycleId', 'bad id'), /ASCII id/)
  assertInvalid((state) => setRoot(state, 'revision', 1.5), /integer/)
  assertInvalid((state) => setRoot(state, 'paused', 'false'), /boolean/)
  assertInvalid((state) => setRoot(state, 'createdAt', Number.NaN), /finite/)
  assertInvalid((state) => setRoot(state, 'mode', 'thorough'), /standard, plan, validated/)
  assertInvalid((state) => setRoot(state, 'phase', 'done'), /phase/)
  assertInvalid((state) => setRoot(state, 'intentState', 'certain'), /intentState/)
  assertInvalid((state) => setRoot(state, 'readiness', 'green'), /readiness/)
})

test('enforces section 5 collection and text limits', () => {
  assertInvalid((state) => state.assumptions.push(...strings(21)), /assumptions exceeds 20/)
  assertInvalid((state) => state.goals = goals(13), /goals exceeds 12/)
  assertInvalid((state) => state.requirements = requirements(51), /requirements exceeds 50/)
  assertInvalid((state) => state.items = items(101), /items exceeds 100/)
  assertInvalid((state) => state.checks = checks(101), /checks exceeds 100/)
  assertInvalid((state) => state.evidence = evidence(201), /evidence exceeds 200/)
  assertInvalid((state) => state.events.timeline = timeline(201), /timeline exceeds 200/)
  assertInvalid((state) => state.userIntent = 'x'.repeat(2_001), /userIntent exceeds 2000/)
  assertInvalid((state) => state.evidence[0]!.summary = 'x'.repeat(4_001), /summary exceeds 4000/)
  assertInvalid((state) => {
    state.confidenceHistory = Array.from({ length: 17 }, () => ({
      itemId: 't1',
      state: 'plausible',
      observedAt: 1,
      evidenceIds: ['e1'],
    }))
  }, /exceeds 16 observations/)
})

test('enforces serialized state size before accepting otherwise bounded text', () => {
  const state = validState()
  state.requirements = requirements(50, 'x'.repeat(2_000))
  state.goals = goals(12, 'x'.repeat(2_000))
  state.items = items(100, 'x'.repeat(2_000))
  state.checks = checks(100, 'x'.repeat(2_000))
  assert.throws(() => parseValidatedWorkStateV1(state), /serialized bytes/)
})

test('enforces id uniqueness per namespace and duplicate reference rejection', () => {
  assertInvalid(
    (state) => state.requirements.push({ ...state.requirements[0]! }),
    /duplicate id r1/,
  )
  assertInvalid((state) => state.goals.push({ ...state.goals[0]! }), /duplicate id g1/)
  assertInvalid((state) => state.items.push({ ...state.items[0]! }), /duplicate id t1/)
  assertInvalid((state) => state.checks.push({ ...state.checks[0]! }), /duplicate id c1/)
  assertInvalid((state) => state.evidence.push({ ...state.evidence[0]! }), /duplicate id e1/)
  assertInvalid(
    (state) => state.events.timeline.push({ ...state.events.timeline[0]! }),
    /duplicate id ev1/,
  )
  assertInvalid((state) => state.goals[0]!.requirementIds = ['r1', 'r1'], /duplicate reference r1/)
})

test('allows the same id in different namespaces but rejects dangling references', () => {
  const state = validState()
  state.goals[0]!.id = 'r1'
  state.items[0]!.goalId = 'r1'
  assert.equal(parseValidatedWorkStateV1(state).goals[0]!.id, 'r1')

  assertInvalid(
    (candidate) => candidate.goals[0]!.requirementIds = ['missing'],
    /unknown id missing/,
  )
  assertInvalid((candidate) => candidate.items[0]!.goalId = 'missing', /unknown id missing/)
  assertInvalid(
    (candidate) => candidate.items[0]!.requirementIds = ['missing'],
    /unknown id missing/,
  )
  assertInvalid(
    (candidate) => candidate.checks[0]!.requirementIds = ['missing'],
    /unknown id missing/,
  )
  assertInvalid((candidate) => candidate.checks[0]!.itemIds = ['missing'], /unknown id missing/)
  assertInvalid((candidate) => candidate.checks[0]!.evidenceIds = ['missing'], /unknown id missing/)
  assertInvalid((candidate) => candidate.evidence[0]!.checkIds = ['missing'], /unknown id missing/)
  assertInvalid(
    (candidate) => candidate.confidenceHistory[0]!.itemId = 'missing',
    /unknown id missing/,
  )
  assertInvalid(
    (candidate) => candidate.confidenceHistory[0]!.evidenceIds = ['missing'],
    /unknown id missing/,
  )
  assertInvalid(
    (candidate) => candidate.readinessReasons[0]!.requirementIds = ['missing'],
    /unknown id missing/,
  )
})

test('parses optional review summary and rejects strict nested shape violations', () => {
  const state = validState()
  state.latestReview = { reportId: 'review1', status: 'complete', openBlockers: 1, diffHash: 'abc' }
  assert.deepEqual(parseValidatedWorkStateV1(state).latestReview, state.latestReview)
  assertInvalid((candidate) => {
    candidate.latestReview = { reportId: 'review1', status: 'complete', openBlockers: -1 }
  }, /openBlockers/)
  assertInvalid((candidate) => {
    Object.assign(candidate.requirements[0]!, { extra: true })
  }, /extra.*not allowed/)
})

function validState(): ValidatedWorkStateV1 {
  return {
    protocol: VALIDATED_WORK_PROTOCOL,
    version: VALIDATED_WORK_VERSION,
    cycleId: 'cycle-1',
    revision: 1,
    mode: 'validated',
    phase: 'executing',
    paused: false,
    createdAt: 1,
    updatedAt: 2,
    userIntent: 'Implement validated work protocols',
    intentState: 'complete',
    assumptions: ['No UI in this step'],
    requirements: [{ id: 'r1', text: 'Define strict shared contracts', source: 'explicit' }],
    goals: [{
      id: 'g1',
      title: 'Protocol contracts',
      requirementIds: ['r1'],
      status: 'in_progress',
    }],
    items: [{
      id: 't1',
      goalId: 'g1',
      requirementIds: ['r1'],
      text: 'Add parser',
      status: 'completed',
      confidence: 'validated',
      completionConfidence: 'validated',
    }],
    checks: [{
      id: 'c1',
      requirementIds: ['r1'],
      itemIds: ['t1'],
      text: 'Focused protocol test passes',
      status: 'passed',
      evidenceIds: ['e1'],
    }],
    evidence: [{
      id: 'e1',
      kind: 'observed_check',
      summary: 'node --test test/validated-work-protocol.test.ts passed',
      observedAt: 3,
      toolCallId: 'tool-1',
      entryId: 'entry-1',
      checkIds: ['c1'],
    }],
    confidenceHistory: [{
      itemId: 't1',
      state: 'validated',
      observedAt: 4,
      reason: 'Observed focused test',
      evidenceIds: ['e1'],
    }],
    readiness: 'ready',
    readinessReasons: [{
      code: 'mapped-checks-passed',
      text: 'Mapped checks passed',
      requirementIds: ['r1'],
      itemIds: ['t1'],
      checkIds: ['c1'],
      findingIds: [],
    }],
    automation: {
      counters: {
        extraTurns: 0,
        reviewCalls: 0,
        attributedInputTokens: 0,
        attributedOutputTokens: 0,
        attributedCacheReadTokens: 0,
        attributedCacheWriteTokens: 0,
        attributedCostUsd: 0,
      },
      limits: { maxExtraTurns: 2, maxAttributedCostUsd: 1 },
    },
    events: {
      totalEvents: 1,
      droppedEvents: 0,
      timeline: [{ id: 'ev1', type: 'check-passed', observedAt: 5, summary: 'Check passed' }],
    },
  }
}

function assertInvalid(mutator: (state: ValidatedWorkStateV1) => void, pattern: RegExp): void {
  const state = structuredClone(validState())
  mutator(state)
  assert.throws(() => parseValidatedWorkStateV1(state), pattern)
}

function setRoot(
  state: ValidatedWorkStateV1,
  key: string,
  value: unknown,
): Record<string, unknown> {
  const root = state as unknown as Record<string, unknown>
  root[key] = value
  return root
}

function strings(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `text-${index}`)
}

function requirements(count: number, text = 'Requirement'): ValidatedWorkStateV1['requirements'] {
  return Array.from({ length: count }, (_, index) => ({
    id: `r${index}`,
    text,
    source: 'explicit',
  }))
}

function goals(count: number, title = 'Goal'): ValidatedWorkStateV1['goals'] {
  return Array.from({ length: count }, (_, index) => ({
    id: `g${index}`,
    title,
    requirementIds: ['r1'],
    status: 'pending',
  }))
}

function items(count: number, text = 'Task'): ValidatedWorkStateV1['items'] {
  return Array.from({ length: count }, (_, index) => ({
    id: `t${index}`,
    goalId: 'g1',
    requirementIds: ['r1'],
    text,
    status: 'pending',
    confidence: 'speculative',
  }))
}

function checks(count: number, text = 'Check'): ValidatedWorkStateV1['checks'] {
  return Array.from({ length: count }, (_, index) => ({
    id: `c${index}`,
    requirementIds: ['r1'],
    itemIds: ['t1'],
    text,
    status: 'pending',
    evidenceIds: [],
  }))
}

function evidence(count: number): ValidatedWorkStateV1['evidence'] {
  return Array.from({ length: count }, (_, index) => ({
    id: `e${index}`,
    kind: 'inspection',
    summary: 'Observed inspection',
    observedAt: index,
    checkIds: ['c1'],
  }))
}

function timeline(count: number): ValidatedWorkStateV1['events']['timeline'] {
  return Array.from({ length: count }, (_, index) => ({
    id: `event-${index}`,
    type: 'observed',
    observedAt: index,
    summary: 'Observed event',
  }))
}
