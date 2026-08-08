import assert from 'node:assert/strict'
import test from 'node:test'
import { settleEventForSession } from '../src/features/conversation/session-settled.ts'
import type { JsonObject } from '../shared/types.ts'

test('agent_settled is the only settled signal for a normal run', () => {
  assert.equal(settleEventForSession({ type: 'agent_settled' }), 'settled')
})

test('agent_end never settles, even with willRetry false (E6)', () => {
  assert.equal(settleEventForSession({ type: 'agent_end', willRetry: false }), null)
  assert.equal(settleEventForSession({ type: 'agent_end', willRetry: true }), null)
})

test('retry and compaction progress events never settle', () => {
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
    assert.equal(settleEventForSession(event), null, JSON.stringify(event))
  }
})

test('auto_retry_end with success false is a retry-exhausted signal', () => {
  assert.equal(
    settleEventForSession({ type: 'auto_retry_end', success: false, finalError: 'boom' }),
    'retry-exhausted',
  )
})

test('unknown events never settle', () => {
  assert.equal(settleEventForSession({ type: 'nonsense' }), null)
  assert.equal(
    settleEventForSession({ type: 'session_info_changed', name: 'x' } as JsonObject),
    null,
  )
})
