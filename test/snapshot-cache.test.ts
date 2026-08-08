import assert from 'node:assert/strict'
import test from 'node:test'
import { SnapshotCaches } from '../server/snapshot-cache.ts'
import { activeSessionMessages } from '../server/session-snapshot.ts'
import type { JsonObject } from '../shared/types.ts'

/** Records every issued command and returns canned responses keyed by command type. */
class FakeManager {
  readonly calls: JsonObject[] = []
  readonly fullEntryResponses: unknown[] = []
  readonly incrementalEntryResponses: unknown[] = []
  state: unknown = {
    success: true,
    data: { model: 'model-a', isStreaming: false, isCompacting: false, pendingMessageCount: 0 },
  }
  stats: unknown = { success: true, data: { cost: 1.5 } }
  models: unknown = { success: true, data: { models: [{ id: 'model-a', provider: 'anthropic' }] } }
  commands: unknown = {
    success: true,
    data: { commands: [{ name: 'compact', source: 'builtin' }] },
  }

  request(
    { command }: { action: 'command'; sessionId: string; command: JsonObject },
  ): Promise<unknown> {
    this.calls.push(command)
    switch (command.type) {
      case 'get_entries': {
        const queue = 'since' in command ? this.incrementalEntryResponses : this.fullEntryResponses
        return Promise.resolve(
          queue.shift() ?? { success: true, data: { entries: [], leafId: null } },
        )
      }
      case 'get_state':
        return Promise.resolve(this.state)
      case 'get_session_stats':
        return Promise.resolve(this.stats)
      case 'get_available_models':
        return Promise.resolve(this.models)
      case 'get_commands':
        return Promise.resolve(this.commands)
      default:
        throw new Error(`Unexpected command: ${String(command.type)}`)
    }
  }
}

function entry(id: string, parentId: string | null, role = 'user', content = id): JsonObject {
  return { type: 'message', id, parentId, message: { role, content } }
}

const fullList = [entry('a', null), entry('b', 'a', 'assistant', 'First reply')]

test('first refresh issues five commands and builds the full cache', async () => {
  const manager = new FakeManager()
  manager.fullEntryResponses.push({ success: true, data: { entries: fullList, leafId: 'b' } })
  const caches = new SnapshotCaches()

  const cache = await caches.refresh(manager, 'session-1')

  assert.deepEqual(
    manager.calls.map((command) => command.type).sort(),
    ['get_available_models', 'get_commands', 'get_entries', 'get_session_stats', 'get_state'],
  )
  assert.deepEqual(manager.calls.find((command) => command.type === 'get_entries'), {
    type: 'get_entries',
  })
  assert.deepEqual(cache.messages, activeSessionMessages(fullList, 'b'))
  assert.deepEqual(cache.state, {
    model: 'model-a',
    isStreaming: false,
    isCompacting: false,
    pendingMessageCount: 0,
  })
  assert.deepEqual(cache.stats, { cost: 1.5 })
  assert.deepEqual(cache.models, [{ id: 'model-a', provider: 'anthropic' }])
  assert.deepEqual(cache.commands, [{ name: 'compact', source: 'builtin' }])
})

test('a warm refresh issues exactly one incremental get_entries', async () => {
  const manager = new FakeManager()
  manager.fullEntryResponses.push({ success: true, data: { entries: fullList, leafId: 'b' } })
  manager.incrementalEntryResponses.push({ success: true, data: { entries: [], leafId: 'b' } })
  const caches = new SnapshotCaches()
  const first = await caches.refresh(manager, 'session-1')
  const callsAfterFirst = manager.calls.length

  const refreshed = await caches.refresh(manager, 'session-1')

  assert.equal(manager.calls.length, callsAfterFirst + 1)
  assert.deepEqual(manager.calls.at(-1), { type: 'get_entries', since: 'b' })
  assert.deepEqual(refreshed.messages, first.messages)
  assert.deepEqual(refreshed.messages, activeSessionMessages(fullList, 'b'))
})

test('concurrent refreshes serialize through the per-session queue', async () => {
  const manager = new FakeManager()
  manager.fullEntryResponses.push({ success: true, data: { entries: fullList, leafId: 'b' } })
  manager.incrementalEntryResponses.push({ success: true, data: { entries: [], leafId: 'b' } })
  const caches = new SnapshotCaches()

  await Promise.all([caches.refresh(manager, 'session-1'), caches.refresh(manager, 'session-1')])

  assert.deepEqual(manager.calls.filter((command) => command.type === 'get_entries'), [
    { type: 'get_entries' },
    { type: 'get_entries', since: 'b' },
  ])
  assert.equal(manager.calls.length, 6)
})

test('a moved leaf refetches entries fully and rebuilds the cache', async () => {
  const manager = new FakeManager()
  const rewrittenList = [...fullList, entry('c', 'b', 'assistant', 'Rewritten reply')]
  manager.fullEntryResponses.push(
    { success: true, data: { entries: fullList, leafId: 'b' } },
    { success: true, data: { entries: rewrittenList, leafId: 'c' } },
  )
  manager.incrementalEntryResponses.push({ success: true, data: { entries: [], leafId: 'c' } })
  const caches = new SnapshotCaches()
  await caches.refresh(manager, 'session-1')
  const callsAfterFirst = manager.calls.length

  const cache = await caches.refresh(manager, 'session-1')

  assert.equal(manager.calls.length, callsAfterFirst + 2)
  assert.deepEqual(manager.calls.slice(callsAfterFirst), [
    { type: 'get_entries', since: 'b' },
    { type: 'get_entries' },
  ])
  assert.deepEqual(cache.messages, activeSessionMessages(rewrittenList, 'c'))
})

test('a stale since refetches entries fully without throwing', async () => {
  const manager = new FakeManager()
  const rebuiltList = [...fullList, entry('c', 'b', 'assistant', 'After reset')]
  manager.fullEntryResponses.push(
    { success: true, data: { entries: fullList, leafId: 'b' } },
    { success: true, data: { entries: rebuiltList, leafId: 'c' } },
  )
  manager.incrementalEntryResponses.push({ success: false })
  const caches = new SnapshotCaches()
  await caches.refresh(manager, 'session-1')
  const callsAfterFirst = manager.calls.length

  const cache = await caches.refresh(manager, 'session-1')

  assert.equal(manager.calls.length, callsAfterFirst + 2)
  assert.deepEqual(manager.calls.slice(callsAfterFirst), [
    { type: 'get_entries', since: 'b' },
    { type: 'get_entries' },
  ])
  assert.deepEqual(cache.messages, activeSessionMessages(rebuiltList, 'c'))
})

test('models, commands and prompt templates are fetched once per session and after clear', async () => {
  const manager = new FakeManager()
  manager.fullEntryResponses.push(
    { success: true, data: { entries: fullList, leafId: 'b' } },
    { success: true, data: { entries: fullList, leafId: 'b' } },
  )
  manager.incrementalEntryResponses.push({ success: true, data: { entries: [], leafId: 'b' } })
  const caches = new SnapshotCaches()

  const first = await caches.refresh(manager, 'session-1')
  assert.equal(manager.calls.filter((command) => command.type === 'get_available_models').length, 1)
  assert.equal(manager.calls.filter((command) => command.type === 'get_commands').length, 1)
  assert.ok(Array.isArray(first.promptTemplates))

  await caches.refresh(manager, 'session-1')
  assert.equal(manager.calls.filter((command) => command.type === 'get_available_models').length, 1)
  assert.equal(manager.calls.filter((command) => command.type === 'get_commands').length, 1)

  caches.clear('session-1')
  const rebuilt = await caches.refresh(manager, 'session-1')
  assert.equal(manager.calls.filter((command) => command.type === 'get_available_models').length, 2)
  assert.equal(manager.calls.filter((command) => command.type === 'get_commands').length, 2)
  assert.ok(Array.isArray(rebuilt.promptTemplates))
})

test('refreshStateStats issues exactly two commands on a warm cache', async () => {
  const manager = new FakeManager()
  manager.fullEntryResponses.push({ success: true, data: { entries: fullList, leafId: 'b' } })
  const caches = new SnapshotCaches()
  await caches.refresh(manager, 'session-1')
  const callsAfterFirst = manager.calls.length

  await caches.refreshStateStats(manager, 'session-1')

  assert.deepEqual(manager.calls.slice(callsAfterFirst), [
    { type: 'get_state' },
    { type: 'get_session_stats' },
  ])
})

test('refreshStateStats on a cold cache builds the full cache', async () => {
  const manager = new FakeManager()
  manager.fullEntryResponses.push({ success: true, data: { entries: fullList, leafId: 'b' } })
  const caches = new SnapshotCaches()

  await caches.refreshStateStats(manager, 'session-1')

  assert.deepEqual(
    manager.calls.map((command) => command.type).sort(),
    ['get_available_models', 'get_commands', 'get_entries', 'get_session_stats', 'get_state'],
  )
})
