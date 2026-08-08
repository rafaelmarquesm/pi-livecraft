import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assistantTurnParts,
  conversationMessageEntries,
  sameAssistantMessage,
  sameMessage,
} from '../src/features/conversation/message-reconciliation.ts'

test('keeps each streamed assistant message before its tool calls', () => {
  const turns = [
    {
      role: 'assistant',
      content: [{ type: 'thinking', thinking: 'Inspecting' }, {
        type: 'toolCall',
        id: 'call_1',
        name: 'read',
        arguments: { path: 'one' },
      }],
    },
    {
      role: 'assistant',
      content: [{ type: 'thinking', thinking: 'Checking' }, {
        type: 'toolCall',
        id: 'call_2',
        name: 'read',
        arguments: { path: 'two' },
      }],
    },
  ]

  assert.deepEqual(
    turns.flatMap((message) => assistantTurnParts(message).map((part) => part.kind)),
    ['message', 'tool', 'message', 'tool'],
  )
})

test('reconciles completed messages without collapsing distinct live turns', () => {
  const completed = { role: 'assistant', timestamp: 10, content: [{ type: 'text', text: 'done' }] }
  const different = {
    role: 'assistant',
    timestamp: 10,
    content: [{ type: 'text', text: 'still working' }],
  }
  const live = [
    { id: 'completed-1', message: completed },
    { id: 'different', message: different },
    { id: 'completed-2', message: completed },
  ]

  assert.equal(sameAssistantMessage(completed, different), false)
  assert.deepEqual(
    conversationMessageEntries([{ message: completed }], live).map(({ key, source }) => ({
      key,
      source,
    })),
    [
      { key: 'completed-1', source: 'history' },
      { key: 'different', source: 'live' },
      { key: 'completed-2', source: 'live' },
    ],
  )
})

test('indexes repeated message content without reusing a streamed identity', () => {
  const message = { role: 'assistant', timestamp: 10, content: [{ type: 'text', text: 'same' }] }
  const live = [{ id: 'live-1', message }, { id: 'live-2', message }]

  assert.deepEqual(
    conversationMessageEntries([{ message }, { message }], live).map(({ key, source }) => ({
      key,
      source,
    })),
    [
      { key: 'live-1', source: 'history' },
      { key: 'live-2', source: 'history' },
    ],
  )
})

test('preserves streamed identities when messages move into history', () => {
  const first = { role: 'assistant', timestamp: 10, content: [{ type: 'text', text: 'first' }] }
  const second = { role: 'assistant', timestamp: 11, content: [{ type: 'text', text: 'second' }] }
  const live = [{ id: 'live-1', message: first }, { id: 'live-2', message: second }]

  assert.deepEqual(
    conversationMessageEntries([{ message: first }], live).map(({ key, source }) => ({
      key,
      source,
    })),
    [
      { key: 'live-1', source: 'history' },
      { key: 'live-2', source: 'live' },
    ],
  )
  assert.deepEqual(
    conversationMessageEntries([{ message: first }, { message: second }], live).map((
      { key, source },
    ) => ({ key, source })),
    [
      { key: 'live-1', source: 'history' },
      { key: 'live-2', source: 'history' },
    ],
  )
})

test('matches identical user messages by text content', () => {
  assert.equal(
    sameMessage({ role: 'user', content: 'Bonjour' }, { role: 'user', content: 'Bonjour' }),
    true,
  )
  assert.equal(
    sameMessage({ role: 'user', content: 'Bonjour' }, { role: 'user', content: 'Salut' }),
    false,
  )
  assert.equal(
    sameMessage({ role: 'user', content: 'Bonjour' }, { role: 'assistant', content: 'Bonjour' }),
    false,
  )
  assert.equal(sameMessage({ role: 'user' }, { role: 'user' }), false)
})

test('matches user messages when Pi returns content as an array', () => {
  assert.equal(
    sameMessage(
      { role: 'user', content: 'Salut' },
      {
        role: 'user',
        content: [{ type: 'text', text: 'Salut' }, {
          type: 'image',
          data: '...',
          mimeType: 'image/png',
        }],
      },
    ),
    true,
  )
})

test('reconciles an optimistic user message with its history counterpart', () => {
  const history = [
    { message: { role: 'user', timestamp: 100, content: 'Bonjour' } },
    { message: { role: 'assistant', timestamp: 101, content: 'Réponse' } },
  ]
  const live = [{ id: 'opt-1', message: { role: 'user', content: 'Bonjour' } }]
  const entries = conversationMessageEntries(history, live)
  assert.deepEqual(entries.map(({ key, source }) => ({ key, source })), [
    { key: 'opt-1', source: 'history' },
    { key: 'history-101-1', source: 'history' },
  ])
})

test('keeps an unmatched optimistic user message as a live entry', () => {
  const history = [{ message: { role: 'assistant', content: 'Précédent' } }]
  const live = [{ id: 'opt-1', message: { role: 'user', content: 'En attente' } }]
  const entries = conversationMessageEntries(history, live)
  assert.deepEqual(entries.map(({ key, source }) => ({ key, source })), [
    { key: 'history--0', source: 'history' },
    { key: 'opt-1', source: 'live' },
  ])
})

test('uses the stable entry id as the history key when present', () => {
  const history = [{ entryId: 'a1b2c3d4', message: { role: 'assistant', content: 'stable' } }]

  assert.deepEqual(
    conversationMessageEntries(history, []).map(({ key, source }) => ({ key, source })),
    [{ key: 'a1b2c3d4', source: 'history' }],
  )
})

test('keeps timestamp-index fallback keys for messages without an entry id', () => {
  const history = [
    { message: { role: 'assistant', timestamp: 1, content: 'premier' } },
    { message: { role: 'assistant', timestamp: 2, content: 'second' } },
  ]

  assert.deepEqual(
    conversationMessageEntries(history, []).map(({ key, source }) => ({ key, source })),
    [
      { key: 'history-1-0', source: 'history' },
      { key: 'history-2-1', source: 'history' },
    ],
  )
})

test('reconciles an entry-id history message with a live message by content', () => {
  const message = { role: 'assistant', timestamp: 10, content: [{ type: 'text', text: 'done' }] }
  const live = [{ id: 'live-9', message }]

  assert.deepEqual(
    conversationMessageEntries([{ entryId: 'a1b2c3d4', message }], live).map(({ key, source }) => ({
      key,
      source,
    })),
    [{ key: 'live-9', source: 'history' }],
  )
})
