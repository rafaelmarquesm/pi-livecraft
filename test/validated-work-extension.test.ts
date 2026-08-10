import assert from 'node:assert/strict'
import test from 'node:test'
import {
  activatePlanningTools,
  captureToolsBeforePlanning,
  enforcePlanningToolGate,
  restorePlanningTools,
} from '../pi-extensions/validated-work/gates.ts'
import {
  applyValidatedWorkAction,
  buildSummary,
  createInitialState,
  defaultConfig,
  reconstructValidatedWork,
  summaryJson,
  validatedWorkConfigType,
  validatedWorkConfigVersion,
  validatedWorkToolName,
  type ValidatedWorkConfigEntry,
} from '../pi-extensions/validated-work/state.ts'
import type { ValidatedWorkStateV1 } from '../shared/validated-work.ts'

test('default validated work state is inactive and has no summary contract overhead', () => {
  const config = defaultConfig(100)
  const reconstructed = reconstructValidatedWork([], 100)
  assert.equal(config.mode, 'standard')
  assert.equal(reconstructed.config.mode, 'standard')
  assert.equal(reconstructed.state.mode, 'standard')
  assert.equal(reconstructed.state.phase, 'idle')
})

test('activation captures tools, switches to read-only planning tools, and restores exactly', () => {
  const pi = fakeTools(
    ['bash', 'read', 'grep', 'edit', 'ask_user_question', validatedWorkToolName],
    [
      'bash',
      'read',
      'edit',
    ],
  )
  const captured = captureToolsBeforePlanning(pi)
  activatePlanningTools(pi)
  assert.deepEqual(captured, ['bash', 'read', 'edit'])
  assert.deepEqual(pi.active, ['read', 'grep', 'ask_user_question', validatedWorkToolName])
  assert.equal(restorePlanningTools(pi, { toolsBeforePlanning: captured }), true)
  assert.deepEqual(pi.active, ['bash', 'read', 'edit'])
})

test('planning gate blocks stale write tool calls fail-closed', () => {
  const planning = createInitialState('plan', 100)
  assert.equal(enforcePlanningToolGate(planning, 'read'), undefined)
  assert.deepEqual(enforcePlanningToolGate(planning, 'bash'), {
    block: true,
    terminate: true,
    reason:
      'Validated Work planning mode allows only read-only tools: read, grep, find, ls, ask_user_question, validated_work.',
  })
  assert.equal(enforcePlanningToolGate({ ...planning, phase: 'executing' }, 'bash'), undefined)
})

test('structured tool actions apply strict partial updates and keep omitted fields', () => {
  let state = createInitialState('plan', 100)
  state = applyValidatedWorkAction(state, {
    action: 'replace_plan',
    userIntent: 'Implement structured planning',
    intentState: 'clear',
    requirements: [{ id: 'r1', text: 'Track requirements', source: 'explicit' }],
    goals: [{ id: 'g1', title: 'Planning', requirementIds: ['r1'], status: 'pending' }],
    items: [{
      id: 't1',
      goalId: 'g1',
      requirementIds: ['r1'],
      text: 'Add state machine',
      status: 'pending',
      confidence: 'plausible',
    }],
    checks: [{
      id: 'c1',
      requirementIds: ['r1'],
      itemIds: ['t1'],
      text: 'Unit test covers state machine',
      status: 'pending',
      evidenceIds: [],
    }],
  }, 101)
  state = applyValidatedWorkAction(state, {
    action: 'update_items',
    items: [{ id: 't1', status: 'completed' }],
  }, 102)
  assert.equal(state.items[0]?.text, 'Add state machine')
  assert.equal(state.items[0]?.status, 'completed')
  assert.equal(state.revision, 2)
})

test('malformed tool args and dangling references are rejected', () => {
  const state = createInitialState('plan', 100)
  assert.throws(
    () => applyValidatedWorkAction(state, { action: 'status', extra: true } as never),
    /not allowed: extra/,
  )
  assert.throws(
    () =>
      applyValidatedWorkAction(state, {
        action: 'update_items',
        items: [{ id: 't1', text: 'Task', extra: true } as never],
      }),
    /Update field is not allowed: extra/,
  )
  assert.throws(
    () =>
      applyValidatedWorkAction(state, {
        action: 'replace_plan',
        requirements: [{ id: 'r1', text: 'Requirement', source: 'explicit' }],
        goals: [{ id: 'g1', title: 'Goal', requirementIds: ['missing'], status: 'pending' }],
      }),
    /unknown id missing/,
  )
})

test('branch-aware reconstruction uses active branch config and toolResult details', () => {
  const baseConfig = config('plan', 10)
  const branchConfig = config('validated', 20)
  const planState = applyValidatedWorkAction(createInitialState('plan', 10), {
    action: 'replace_plan',
    userIntent: 'Old branch',
  }, 11)
  const validatedState = applyValidatedWorkAction(createInitialState('validated', 20), {
    action: 'replace_plan',
    userIntent: 'Active branch',
  }, 21)
  const activeBranch = [
    customEntry(baseConfig),
    toolResult(planState),
    customEntry(branchConfig),
    {
      ...toolResult(planState),
      message: { role: 'toolResult', toolName: validatedWorkToolName, details: { bad: true } },
    },
    toolResult(validatedState),
  ]
  const reconstructed = reconstructValidatedWork(activeBranch, 30)
  assert.equal(reconstructed.config.mode, 'validated')
  assert.equal(reconstructed.state.userIntent, 'Active branch')
  assert.equal(reconstructed.ignoredSnapshots, 1)
})

test('approval config reconstructs execution and bounded summary stays below two KiB', () => {
  const activeConfig = { ...config('validated', 20), approvedAt: 25 }
  const state = createInitialState('validated', 20)
  const reconstructed = reconstructValidatedWork([customEntry(activeConfig), toolResult(state)], 30)
  assert.equal(reconstructed.state.phase, 'executing')

  const noisy = withManyReadinessReasons(reconstructed.state)
  const summary = buildSummary(noisy)
  assert.ok(summary.blockers.length < noisy.readinessReasons.length)
  assert.ok(new TextEncoder().encode(summaryJson(noisy)).length <= 2_048)
})

function fakeTools(all: string[], active: string[]) {
  return {
    active: [...active],
    getActiveTools() {
      return [...this.active]
    },
    getAllTools() {
      return all.map((name) => ({ name }))
    },
    setActiveTools(toolNames: string[]) {
      this.active = [...toolNames]
    },
  }
}

function config(
  mode: ValidatedWorkConfigEntry['mode'],
  updatedAt: number,
): ValidatedWorkConfigEntry {
  return { protocol: validatedWorkConfigType, version: validatedWorkConfigVersion, mode, updatedAt }
}

function customEntry(data: ValidatedWorkConfigEntry) {
  return { type: 'custom', customType: validatedWorkConfigType, data }
}

function toolResult(state: ValidatedWorkStateV1) {
  return {
    type: 'message',
    message: { role: 'toolResult', toolName: validatedWorkToolName, details: state },
  }
}

function withManyReadinessReasons(state: ValidatedWorkStateV1): ValidatedWorkStateV1 {
  return {
    ...state,
    readinessReasons: Array.from({ length: 80 }, (_, index) => ({
      code: `blocker-${index}`,
      text: `Long blocker text ${index} ${'x'.repeat(120)}`,
      requirementIds: [],
      itemIds: [],
      checkIds: [],
      findingIds: [],
    })),
  }
}
