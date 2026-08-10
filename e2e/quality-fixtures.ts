import {
  applyValidatedWorkAction,
  approveState,
  buildSummary,
  createInitialState,
} from '../pi-extensions/validated-work/state.ts'
import type {
  QualityCampaignDetailResponse,
  QualityCampaignListResponse,
} from '../shared/quality-campaigns.ts'
import type { ValidatedWorkDetailsResponse } from '../shared/validated-work.ts'

export function awaitingPlanDetails(): ValidatedWorkDetailsResponse {
  let state = createInitialState('plan', 1)
  state = applyValidatedWorkAction(state, {
    action: 'replace_plan',
    userIntent: 'Implement the requested workflow safely.',
    intentState: 'clear',
    requirements: [
      { id: 'r1', text: 'Add plan-first approval before execution.', source: 'explicit' },
      { id: 'r2', text: 'Keep standard mode zero-overhead.', source: 'explicit' },
    ],
    goals: [{ id: 'g1', title: 'Planning UI', requirementIds: ['r1'], status: 'pending' }],
    items: [{
      id: 't1',
      goalId: 'g1',
      requirementIds: ['r1'],
      text: 'Wire approval dialog actions.',
      status: 'pending',
      confidence: 'plausible',
    }],
    checks: [{
      id: 'c1',
      requirementIds: ['r1'],
      itemIds: ['t1'],
      text: 'Playwright covers approve/request changes/cancel.',
      status: 'pending',
      evidenceIds: [],
    }],
    assumptions: ['Approval should restore write tools only after the user approves.'],
  }, 2)
  state = applyValidatedWorkAction(state, { action: 'submit_for_approval' }, 3)
  return { state, summary: buildSummary(state), review: null, stale: false }
}

export function executingPlanDetails(): ValidatedWorkDetailsResponse {
  const awaiting = awaitingPlanDetails().state
  const state = awaiting ? approveState(awaiting, 4) : null
  return { state, summary: state ? buildSummary(state) : null, review: null, stale: false }
}

export const standardDetails: ValidatedWorkDetailsResponse = {
  state: null,
  summary: null,
  review: null,
  stale: false,
}

export const campaignListFixture: QualityCampaignListResponse = {
  campaigns: [{
    arms: ['livecraft-standard', 'livecraft-validated'],
    generatedAt: '2026-01-01T00:00:02.000Z',
    id: 'fixture-campaign',
    invalidTrials: 1,
    smallSample: true,
    totalTrials: 3,
    validTrials: 2,
  }],
}

export const campaignDetailFixture: QualityCampaignDetailResponse = {
  arms: [
    {
      arm: 'livecraft-standard',
      costPerSuccess: null,
      costUsd: 0.01,
      durationMs: 1000,
      invalidReasons: {},
      invalidTrials: 0,
      passAt1: 0,
      passAtK: null,
      rawTrialIds: ['standard-1'],
      score: {
        bootstrapMeanCi: { confidence: 0.95, iterations: 1000, lower: 0, upper: 0 },
        mean: 0,
        median: 0,
        sampleSd: 0,
      },
      successes: 0,
      timeToFirstPassMs: null,
      tokens: { cacheRead: 0, cacheWrite: 0, input: 100, output: 20 },
      totalTrials: 1,
      validTrials: 1,
      wilson: { center: 0.396, lower: 0, upper: 0.793 },
    },
    {
      arm: 'livecraft-validated',
      costPerSuccess: 0.02,
      costUsd: 0.03,
      durationMs: 2200,
      invalidReasons: { settings_drift: 1 },
      invalidTrials: 1,
      passAt1: 1,
      passAtK: null,
      rawTrialIds: ['validated-1', 'validated-2'],
      score: {
        bootstrapMeanCi: { confidence: 0.95, iterations: 1000, lower: 1, upper: 1 },
        mean: 1,
        median: 1,
        sampleSd: 0,
      },
      successes: 1,
      timeToFirstPassMs: 1200,
      tokens: { cacheRead: 0, cacheWrite: 0, input: 180, output: 60 },
      totalTrials: 2,
      validTrials: 1,
      wilson: { center: 0.604, lower: 0.207, upper: 1 },
    },
  ],
  generatedAt: '2026-01-01T00:00:02.000Z',
  id: 'fixture-campaign',
  invalidReasons: {
    artifact_incomplete: 0,
    auth_failure: 0,
    grader_missing: 0,
    grader_parse_failure: 0,
    model_mismatch: 0,
    network_failure: 0,
    outside_workspace_mutation: 0,
    output_truncated: 0,
    provider_mismatch: 0,
    quota_failure: 0,
    rate_limited: 0,
    settings_drift: 1,
    settle_missing: 0,
    thinking_mismatch: 0,
    workspace_dirty: 0,
  },
  pairedDeltas: [{
    delta: 1,
    left: 0,
    leftArm: 'livecraft-standard',
    right: 1,
    rightArm: 'livecraft-validated',
    seed: 'seed1',
    taskId: 'parser-repair',
  }],
  progress: [
    { arm: 'livecraft-standard', points: [{ bestPassed: false, bestScore: 0, elapsedMs: 1000 }] },
    { arm: 'livecraft-validated', points: [{ bestPassed: true, bestScore: 1, elapsedMs: 1200 }] },
  ],
  provenance: {
    campaignUpdatedAt: '2026-01-01T00:00:02.000Z',
    environment: { arch: 'arm64', node: 'v24.0.0', os: 'darwin' },
    livecraftRevision: 'fixture-revision',
    manifestFingerprint: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    observed: { model: 'fixture-model', provider: 'fixture', thinking: 'none' },
    piExecutableSha256: 'sha256:pi',
    piVersion: '0.84.1',
    requested: { model: 'fixture-model', provider: 'fixture', thinking: 'none' },
  },
  rawTrials: [
    {
      arm: 'livecraft-standard',
      attempt: 1,
      costUsd: 0.01,
      durationMs: 1000,
      id: 'standard-1',
      invalidReasons: [],
      passed: false,
      score: 0,
      seed: 'seed1',
      taskId: 'parser-repair',
      valid: true,
    },
    {
      arm: 'livecraft-validated',
      attempt: 1,
      costUsd: 0.02,
      durationMs: 1200,
      id: 'validated-1',
      invalidReasons: [],
      passed: true,
      score: 1,
      seed: 'seed1',
      taskId: 'parser-repair',
      valid: true,
    },
    {
      arm: 'livecraft-validated',
      attempt: 2,
      costUsd: 0.01,
      durationMs: 1000,
      id: 'validated-2',
      invalidReasons: ['settings_drift'],
      passed: false,
      score: null,
      seed: 'seed1',
      taskId: 'parser-repair',
      valid: false,
    },
  ],
  winner: null,
  winnerSuppressedReasons: [
    'fewer than 3 valid trials per cell',
    'settings drift invalidated at least one trial',
    'confidence intervals are inconclusive',
  ],
}
