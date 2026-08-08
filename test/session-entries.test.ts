import assert from 'node:assert/strict'
import test from 'node:test'
import {
  advanceEntryCursor,
  cursorFromFullResponse,
  emptyEntryCursor,
  entriesResponseRequiresReset,
  mergeEntryDeltas,
  nextEntriesRequest,
} from '../server/session-entries.ts'

test('requests a full fetch when no cursor exists', () => {
  assert.deepEqual(nextEntriesRequest(null), { type: 'get_entries' })
  assert.deepEqual(nextEntriesRequest(emptyEntryCursor()), { type: 'get_entries' })
})

test('requests an incremental fetch after a cursor advanced', () => {
  const cursor = cursorFromFullResponse(
    [{ type: 'message', id: 'abc123' }, { type: 'message', id: 'def456' }],
    'def456',
  )
  assert.deepEqual(nextEntriesRequest(cursor), { type: 'get_entries', since: 'def456' })
})

test('a full response seeds the cursor from the last entry and leaf', () => {
  assert.deepEqual(cursorFromFullResponse([], null), { lastEntryId: null, leafId: null })
  assert.deepEqual(
    cursorFromFullResponse(
      [{ type: 'message', id: 'a' }, { type: 'custom_message', id: 'b' }],
      'b',
    ),
    { lastEntryId: 'b', leafId: 'b' },
  )
})

test('advancing keeps the previous cursor position when the delta is empty', () => {
  const cursor = { lastEntryId: 'abc123', leafId: 'abc123' }
  assert.deepEqual(advanceEntryCursor(cursor, [], 'abc123'), {
    lastEntryId: 'abc123',
    leafId: 'abc123',
  })
})

test('advancing picks the last delta id and the fresh leaf', () => {
  const cursor = { lastEntryId: 'abc123', leafId: 'abc123' }
  assert.deepEqual(
    advanceEntryCursor(
      cursor,
      [{ type: 'message', id: 'def456' }],
      'def456',
    ),
    { lastEntryId: 'def456', leafId: 'def456' },
  )
})

test('an unchanged leaf keeps the cursor valid', () => {
  const cursor = { lastEntryId: 'abc123', leafId: 'abc123' }
  assert.equal(entriesResponseRequiresReset(cursor, true, 'abc123'), false)
})

test('a moved leaf invalidates the cursor (branch rewrite)', () => {
  const cursor = { lastEntryId: 'abc123', leafId: 'abc123' }
  assert.equal(entriesResponseRequiresReset(cursor, true, 'new-leaf'), true)
})

test('a failed response invalidates the cursor (stale since)', () => {
  const cursor = { lastEntryId: 'gone', leafId: 'abc123' }
  assert.equal(entriesResponseRequiresReset(cursor, false, 'abc123'), true)
})

test('a null leaf on an empty session keeps an empty cursor valid', () => {
  assert.equal(entriesResponseRequiresReset(emptyEntryCursor(), true, null), false)
})

test('merging appends strict deltas without duplicates', () => {
  const cached = [{ type: 'message', id: 'a' }]
  assert.deepEqual(mergeEntryDeltas(cached, []), cached)
  assert.deepEqual(mergeEntryDeltas(cached, [{ type: 'message', id: 'b' }]), [
    { type: 'message', id: 'a' },
    { type: 'message', id: 'b' },
  ])
  assert.deepEqual(
    mergeEntryDeltas(cached, [{ type: 'message', id: 'a' }, { type: 'message', id: 'b' }]),
    [cached[0], { type: 'message', id: 'b' }],
  )
})
