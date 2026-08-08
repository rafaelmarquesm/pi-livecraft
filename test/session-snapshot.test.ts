import assert from 'node:assert/strict'
import test from 'node:test'
import {
  activeSessionMessages,
  LiveSessionEvents,
  visibleSessionMessages,
} from '../server/session-snapshot.ts'
import type { JsonObject, SessionMessage } from '../shared/types.ts'

test('retains only the events needed to restore active thinking and tools', () => {
  const live = new LiveSessionEvents()
  live.receive({ type: 'agent_start' }, 1)
  live.receive({ type: 'message_start', message: { role: 'assistant', content: [] } }, 2)
  live.receive({
    type: 'message_update',
    message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'Inspecting' }] },
    assistantMessageEvent: { type: 'thinking_delta', delta: 'Inspecting' },
  }, 3)
  live.receive({
    type: 'message_update',
    message: {
      role: 'assistant',
      content: [{ type: 'thinking', thinking: 'Inspecting' }, {
        type: 'toolCall',
        id: 'call-1',
        name: 'read',
        arguments: {},
      }],
    },
    assistantMessageEvent: { type: 'toolcall_start', contentIndex: 1 },
  }, 4)
  live.receive(
    { type: 'tool_execution_start', toolCallId: 'call-1', toolName: 'read', args: {} },
    5,
  )
  live.receive({
    type: 'tool_execution_update',
    toolCallId: 'call-1',
    toolName: 'read',
    partialResult: { content: 'partial' },
  }, 6)

  assert.deepEqual(live.snapshot().map(({ sequence }) => sequence), [1, 2, 4, 5, 6])

  live.receive({ type: 'message_end' }, 7)
  assert.deepEqual(live.snapshot().map(({ sequence }) => sequence), [1, 5, 6])
  live.receive({ type: 'tool_execution_end', toolCallId: 'call-1' }, 8)
  assert.deepEqual(live.snapshot().map(({ sequence }) => sequence), [1])
  live.receive({ type: 'agent_settled' }, 9)
  assert.deepEqual(live.snapshot(), [])
})

test('stores an assembled assistant message for delta-only replay', () => {
  const live = new LiveSessionEvents()
  live.receive({ type: 'message_start', message: { role: 'assistant', content: [] } }, 1)
  live.receive({
    type: 'message_update',
    assistantMessageEvent: { type: 'text_start', contentIndex: 0 },
  }, 2)
  live.receive({
    type: 'message_update',
    assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Hello ' },
  }, 3)
  live.receive({
    type: 'message_update',
    assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'world' },
  }, 4)

  assert.deepEqual(live.snapshot().at(-1)?.data.message, {
    role: 'assistant',
    content: [{ type: 'text', text: 'Hello world' }],
  })
})

test('keeps the active conversation before and after compaction', () => {
  const messages = activeSessionMessages([
    {
      type: 'message',
      id: 'user-1',
      parentId: null,
      message: { role: 'user', content: 'Original request' },
    },
    {
      type: 'message',
      id: 'assistant-1',
      parentId: 'user-1',
      message: { role: 'assistant', content: 'Original response' },
    },
    {
      type: 'message',
      id: 'abandoned',
      parentId: 'user-1',
      message: { role: 'assistant', content: 'Abandoned branch' },
    },
    { type: 'compaction', id: 'compact-1', parentId: 'assistant-1', summary: 'Summary' },
    {
      type: 'message',
      id: 'user-2',
      parentId: 'compact-1',
      message: { role: 'user', content: 'Continue' },
    },
  ], 'user-2')

  assert.deepEqual(messages, [
    {
      entryId: 'user-1',
      parentEntryId: undefined,
      message: { role: 'user', content: 'Original request' },
    },
    {
      entryId: 'assistant-1',
      parentEntryId: 'user-1',
      message: { role: 'assistant', content: 'Original response' },
    },
    {
      message: { role: 'custom', customType: 'compaction', content: 'Summary', display: true },
    },
    {
      entryId: 'user-2',
      parentEntryId: 'compact-1',
      message: { role: 'user', content: 'Continue' },
    },
  ])
})

test('carries a stable entry id on every message backed by a real entry', () => {
  const messages = activeSessionMessages([
    { type: 'message', id: 'user-1', parentId: null, message: { role: 'user', content: 'Hi' } },
    { type: 'compaction', id: 'compact-1', parentId: 'user-1', summary: 'Summary' },
    {
      type: 'custom_message',
      id: 'custom-1',
      parentId: 'compact-1',
      customType: 'status',
      content: 'Ready',
      display: true,
    },
  ], 'custom-1')

  assert.deepEqual(messages, [
    { entryId: 'user-1', parentEntryId: undefined, message: { role: 'user', content: 'Hi' } },
    {
      message: { role: 'custom', customType: 'compaction', content: 'Summary', display: true },
    },
    {
      entryId: 'custom-1',
      parentEntryId: 'compact-1',
      message: {
        role: 'custom',
        customType: 'status',
        content: 'Ready',
        display: true,
      },
    },
  ])
  for (const { entryId, message } of messages) {
    if (message.role !== 'custom' || message.customType !== 'compaction') {
      assert.equal(typeof entryId, 'string')
    }
  }
})

test('filters compaction entries without a string summary', () => {
  const messages = activeSessionMessages([
    { type: 'message', id: 'user-1', parentId: null, message: { role: 'user', content: 'Hello' } },
    { type: 'compaction', id: 'compact-1', parentId: 'user-1', summary: 42 },
    {
      type: 'message',
      id: 'user-2',
      parentId: 'compact-1',
      message: { role: 'user', content: 'World' },
    },
  ], 'user-2')

  assert.deepEqual(messages, [
    { entryId: 'user-1', parentEntryId: undefined, message: { role: 'user', content: 'Hello' } },
    {
      entryId: 'user-2',
      parentEntryId: 'compact-1',
      message: { role: 'user', content: 'World' },
    },
  ])
})

test('keeps visible custom messages out of hidden extension context', () => {
  const visible = { role: 'custom', customType: 'status', content: 'Prêt', display: true }
  const hidden = {
    role: 'custom',
    customType: 'secret-context',
    content: 'Interne',
    display: false,
  }
  const wrap = (message: JsonObject): SessionMessage => ({ message })

  assert.deepEqual(
    visibleSessionMessages([
      wrap({ role: 'user', content: 'Bonjour' }),
      wrap(visible),
      wrap(hidden),
      wrap({ role: 'custom', content: 'Type manquant', display: true }),
      wrap({ role: 'branchSummary', summary: 'Résumé' }),
    ]),
    [
      wrap({ role: 'user', content: 'Bonjour' }),
      wrap(visible),
    ],
  )
})
