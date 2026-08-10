import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyValidatedWorkAction,
  createInitialState,
  validatedWorkConfigType,
  validatedWorkConfigVersion,
} from '../pi-extensions/validated-work/state.ts'
import {
  parseValidatedWorkConfigUpdate,
} from '../server/features/validated-work/validated-work-config.ts'
import { parseStatusPaths } from '../server/features/validated-work/validated-work-baseline.ts'
import {
  extractValidatedWorkDetails,
  validatedWorkEtag,
} from '../server/features/validated-work/validated-work-state.ts'

test('validated-work config parser rejects unknown browser fields and serializes canonical private command', () => {
  const parsed = parseValidatedWorkConfigUpdate({
    mode: 'validated',
    limits: { maxExtraTurns: 2, maxAttributedCostUsd: 1 },
  })
  assert.equal(
    parsed.commandArgs,
    '{"maxAttributedCostUsd":1,"maxExtraTurns":2,"mode":"validated"}',
  )
  assert.equal(parsed.capturesBaseline, true)
  assert.throws(
    () => parseValidatedWorkConfigUpdate({ mode: 'plan', extensionPath: '/tmp/evil.ts' }),
    /extensionPath is not allowed/,
  )
})

test('validated-work config parser maps approval and cancel actions to fixed private commands', () => {
  assert.equal(
    parseValidatedWorkConfigUpdate({ action: 'approve' }).commandArgs,
    '{"action":"approve"}',
  )
  assert.equal(
    parseValidatedWorkConfigUpdate({ mode: 'standard' }).commandArgs,
    '{"mode":"standard"}',
  )
  assert.equal(
    parseValidatedWorkConfigUpdate({ action: 'abort_automation' }).commandArgs,
    '{"action":"abort_automation"}',
  )
  assert.equal(
    parseValidatedWorkConfigUpdate({ paused: true }).commandArgs,
    '{"paused":true}',
  )
})

test('validated-work state extraction returns null standard details and stable ETags', () => {
  const standard = extractValidatedWorkDetails('session one', [])
  assert.equal(standard.response.state, null)
  assert.equal(standard.response.summary, null)
  assert.equal(standard.etag, validatedWorkEtag('session one', 0))

  const state = applyValidatedWorkAction(createInitialState('plan', 1), {
    action: 'replace_plan',
    userIntent: 'Ship the plan UI',
  }, 2)
  const extracted = extractValidatedWorkDetails('s1', [{
    type: 'custom',
    customType: validatedWorkConfigType,
    data: {
      protocol: validatedWorkConfigType,
      version: validatedWorkConfigVersion,
      mode: 'plan',
      updatedAt: 1,
    },
  }, {
    type: 'message',
    message: { role: 'toolResult', toolName: 'validated_work', details: state },
  }])
  assert.equal(extracted.response.state?.userIntent, 'Ship the plan UI')
  assert.equal(extracted.response.summary?.revision, 1)
  assert.equal(extracted.etag, validatedWorkEtag('s1', 1))
})

test('validated-work baseline parser records changed paths without raw status records', () => {
  assert.deepEqual(parseStatusPaths(' M src/App.ts\0R  new.ts\0old.ts\0?? scratch.md\0'), [
    'new.ts',
    'scratch.md',
    'src/App.ts',
  ])
})
