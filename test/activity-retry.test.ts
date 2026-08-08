import assert from 'node:assert/strict'
import test from 'node:test'
import { activityForPiEvent, activityText } from '../src/features/conversation/activity.ts'

test('maps a compaction summarization retry schedule to a retrying activity, never stuck compacting', () => {
  const compacting = activityForPiEvent({ kind: 'working' }, {
    type: 'compaction_start',
    reason: 'threshold',
  })
  assert.deepEqual(compacting, { kind: 'compacting' })

  const scheduled = activityForPiEvent(compacting, {
    type: 'summarization_retry_scheduled',
    attempt: 1,
    maxAttempts: 3,
    delayMs: 2000,
    errorMessage: 'terminated',
  })
  assert.deepEqual(scheduled, {
    kind: 'retrying',
    attempt: 1,
    maxAttempts: 3,
    summarizationRetry: true,
    compactionRetry: true,
  })
  assert.notEqual(scheduled?.kind, 'compacting')
  assert.equal(activityText(scheduled, 'pi'), 'Pi is retrying compaction (1/3)…')
})

test('maps summarization_retry_attempt_start to the retrying activity with its source', () => {
  const scheduled = activityForPiEvent({ kind: 'compacting' }, {
    type: 'summarization_retry_scheduled',
    attempt: 2,
    maxAttempts: 3,
  })
  const started = activityForPiEvent(scheduled, {
    type: 'summarization_retry_attempt_start',
    source: 'compaction',
    reason: 'threshold',
  })
  assert.equal(started?.kind, 'retrying')
  assert.equal(started?.compactionRetry, true)
  assert.equal(started?.summarizationRetry, true)
  assert.equal(started?.attempt, 2)
  assert.equal(started?.maxAttempts, 3)
})

test('returns to compacting when a compaction retry finishes', () => {
  const scheduled = activityForPiEvent({ kind: 'compacting' }, {
    type: 'summarization_retry_scheduled',
    attempt: 1,
    maxAttempts: 3,
  })
  const finished = activityForPiEvent(scheduled, { type: 'summarization_retry_finished' })
  assert.deepEqual(finished, { kind: 'compacting' })
  assert.equal(activityText(finished, 'pi'), 'Pi is compacting the session…')
})

test('returns to working when a branch-summary retry finishes', () => {
  const scheduled = activityForPiEvent({ kind: 'working' }, {
    type: 'summarization_retry_scheduled',
    attempt: 1,
    maxAttempts: 3,
  })
  assert.equal(scheduled?.compactionRetry, false)
  assert.equal(activityText(scheduled, 'pi'), 'Pi is retrying a summary (1/3)…')

  const started = activityForPiEvent(scheduled, {
    type: 'summarization_retry_attempt_start',
    source: 'branchSummary',
  })
  assert.equal(started?.compactionRetry, false)
  assert.equal(activityText(started, 'pi'), 'Pi is retrying a summary (1/3)…')

  const finished = activityForPiEvent(started, { type: 'summarization_retry_finished' })
  assert.deepEqual(finished, { kind: 'working' })
})

test('keeps provider auto-retry behavior and label unchanged', () => {
  const retry = activityForPiEvent({ kind: 'working' }, {
    type: 'auto_retry_start',
    attempt: 2,
    maxAttempts: 3,
  })
  assert.deepEqual(retry, { kind: 'retrying', attempt: 2, maxAttempts: 3 })
  assert.equal(activityText(retry, 'pi'), 'Pi is reconnecting to the provider (2/3)…')
})
