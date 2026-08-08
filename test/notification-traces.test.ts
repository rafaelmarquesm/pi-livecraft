import assert from 'node:assert/strict'
import test from 'node:test'
import {
  NotificationDecider,
  type NotificationDecision,
} from '../src/features/notifications/notification-decider.ts'
import type { JsonObject } from '../shared/types.ts'

/** Feeds a trace into a fresh per-session decider and collects decisions. */
function runTrace(trace: JsonObject[]): NotificationDecision[] {
  const decider = new NotificationDecider()
  const decisions: NotificationDecision[] = []
  for (const event of trace) {
    const decision = decider.receive(event)
    if (decision !== null) decisions.push(decision)
  }
  return decisions
}

test('trace 1: retried run settles exactly once', () => {
  const decisions = runTrace([
    { type: 'agent_start' },
    { type: 'agent_end', willRetry: true },
    { type: 'auto_retry_start', attempt: 1, maxAttempts: 3 },
    { type: 'agent_end', willRetry: false },
    { type: 'agent_settled' },
  ])
  assert.equal(decisions.length, 1)
  assert.deepEqual(decisions, [{ reason: 'settled' }])
})

test('trace 2: compaction run settles exactly once', () => {
  const decisions = runTrace([
    { type: 'compaction_start' },
    { type: 'compaction_end' },
    { type: 'agent_end', willRetry: false },
    { type: 'agent_settled' },
  ])
  assert.equal(decisions.length, 1)
  assert.deepEqual(decisions, [{ reason: 'settled' }])
})

test('trace 3: plain run settles exactly once', () => {
  // Visibility suppression (dropping decisions while the tab is visible) is an
  // App concern; the decider always reports the decision and App.tsx filters.
  const decisions = runTrace([
    { type: 'agent_end', willRetry: false },
    { type: 'agent_settled' },
  ])
  assert.equal(decisions.length, 1)
  assert.deepEqual(decisions, [{ reason: 'settled' }])
})

test('trace 4: retry exhaustion notifies once and suppresses the trailing settle', () => {
  assert.deepEqual(runTrace([{ type: 'auto_retry_end', success: false, finalError: 'boom' }]), [
    { reason: 'retry-exhausted' },
  ])

  assert.deepEqual(runTrace([{ type: 'auto_retry_end', success: true }]), [])

  // Pi may or may not emit agent_settled after retry exhaustion: either way
  // the run notifies exactly once.
  const decisions = runTrace([
    { type: 'auto_retry_end', success: false, finalError: 'boom' },
    { type: 'agent_settled' },
  ])
  assert.equal(decisions.length, 1)
  assert.deepEqual(decisions, [{ reason: 'retry-exhausted' }])
})

test('trace 5: independent deciders produce independent decisions', () => {
  const trace: JsonObject[] = [
    { type: 'auto_retry_end', success: false, finalError: 'boom' },
    { type: 'agent_settled' },
  ]
  // Two sessions ending simultaneously with the same trace: state must not
  // leak across deciders, so the second is not deduplicated by the first.
  const total = runTrace(trace).length + runTrace(trace).length
  assert.equal(total, 2)
})

test('agent_settled decides settled', () => {
  assert.deepEqual(runTrace([{ type: 'agent_settled' }]), [{ reason: 'settled' }])
})

test('agent_end never decides, even with willRetry false (E6)', () => {
  assert.deepEqual(runTrace([{ type: 'agent_end', willRetry: false }]), [])
  assert.deepEqual(runTrace([{ type: 'agent_end', willRetry: true }]), [])
})

test('retry and compaction progress events never decide', () => {
  for (
    const event of [
      { type: 'agent_start' },
      { type: 'auto_retry_start', attempt: 1, maxAttempts: 3 },
      { type: 'auto_retry_end', success: true },
      { type: 'compaction_start' },
      { type: 'compaction_end' },
      { type: 'summarization_retry_scheduled' },
      { type: 'summarization_retry_attempt_start' },
      { type: 'summarization_retry_finished' },
      { type: 'tool_execution_end' },
      { type: 'queue_update' },
    ]
  ) {
    assert.deepEqual(runTrace([event]), [], JSON.stringify(event))
  }
})

test('auto_retry_end with success false decides retry-exhausted', () => {
  assert.deepEqual(
    runTrace([{ type: 'auto_retry_end', success: false, finalError: 'boom' }]),
    [{ reason: 'retry-exhausted' }],
  )
})

test('unknown events never decide', () => {
  assert.deepEqual(runTrace([{ type: 'nonsense' }]), [])
  assert.deepEqual(runTrace([{ type: 'session_info_changed', name: 'x' } as JsonObject]), [])
})

test('agent_start re-arms settled notifications after retry exhaustion', () => {
  const decisions = runTrace([
    { type: 'auto_retry_end', success: false, finalError: 'boom' },
    { type: 'agent_settled' },
    { type: 'agent_start' },
    { type: 'agent_settled' },
  ])
  assert.deepEqual(decisions, [
    { reason: 'retry-exhausted' },
    { reason: 'settled' },
  ])
})
