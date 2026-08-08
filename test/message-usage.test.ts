import assert from 'node:assert/strict'
import test from 'node:test'
import {
  formatTurnCost,
  messageUsage,
  turnUsageByMessage,
} from '../src/features/conversation/message-usage.ts'

test('extracts per-response cost and token counters from Pi usage', () => {
  const usage = messageUsage({
    role: 'assistant',
    usage: {
      input: 12_345,
      output: 678,
      cacheRead: 9_876,
      cost: { total: 0.00105 },
    },
  })

  assert.deepEqual(usage, {
    cacheMiss: 12_345,
    cacheRead: 9_876,
    cacheWrite: 0,
    cost: 0.00105,
    output: 678,
  })
  assert.equal(formatTurnCost(usage?.cost ?? 0), '$0.0011')
})

test('keeps usage separate for each agentic turn', () => {
  const usages = turnUsageByMessage([
    { message: { role: 'user', content: 'Inspecte le dépôt.' } },
    {
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Je cherche les fichiers.' },
          { type: 'toolCall', id: 'call_1', name: 'read' },
          { type: 'toolCall', id: 'call_2', name: 'grep' },
        ],
        usage: { input: 100, output: 10, cacheRead: 1_000, cost: { total: 0.001 } },
      },
    },
    { message: { role: 'toolResult', toolCallId: 'call_1' } },
    { message: { role: 'toolResult', toolCallId: 'call_2' } },
    {
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'C’est fait.' }],
        usage: { input: 200, output: 20, cacheRead: 2_000, cost: { total: 0.002 } },
      },
    },
  ])

  assert.deepEqual([...usages], [
    [1, { cacheMiss: 100, cacheRead: 1_000, cacheWrite: 0, cost: 0.001, output: 10 }],
    [4, { cacheMiss: 200, cacheRead: 2_000, cacheWrite: 0, cost: 0.002, output: 20 }],
  ])
})

test('hides metrics when Pi does not provide complete usage', () => {
  assert.equal(messageUsage({ role: 'assistant', usage: { input: 10 } }), null)
  assert.deepEqual(
    turnUsageByMessage([
      { message: { role: 'user' } },
      { message: { role: 'assistant', usage: { input: 10 } } },
    ]),
    new Map(),
  )
})

test('defers usage for messages whose tool calls are not yet resolved', () => {
  const messages = [
    { message: { role: 'user', content: 'Lis et cherche.' } },
    {
      message: {
        role: 'assistant',
        content: [
          { type: 'toolCall', id: 'call_1', name: 'read' },
          { type: 'toolCall', id: 'call_2', name: 'grep' },
        ],
        usage: { input: 100, output: 10, cacheRead: 50, cost: { total: 0.001 } },
      },
    },
    { message: { role: 'toolResult', toolCallId: 'call_1' } },
    { message: { role: 'toolResult', toolCallId: 'call_2' } },
  ]

  // Neither call resolved (live): no usage.
  assert.deepEqual(
    turnUsageByMessage(messages, new Set()),
    new Map(),
  )
  // Only one call resolved: still no usage.
  assert.deepEqual(
    turnUsageByMessage(messages, new Set(['call_1'])),
    new Map(),
  )
  // Both resolved from history: usage appears.
  assert.deepEqual(
    [...turnUsageByMessage(messages, new Set(['call_1', 'call_2']))],
    [[1, { cacheMiss: 100, cacheRead: 50, cacheWrite: 0, cost: 0.001, output: 10 }]],
  )
})

test('shows usage immediately for assistant responses without tool calls', () => {
  const messages = [
    { message: { role: 'user', content: 'Bonjour' } },
    {
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Salut !' }],
        usage: { input: 10, output: 5, cacheRead: 0, cost: { total: 0.0001 } },
      },
    },
  ]

  assert.deepEqual(
    [...turnUsageByMessage(messages, new Set())],
    [[1, { cacheMiss: 10, cacheRead: 0, cacheWrite: 0, cost: 0.0001, output: 5 }]],
  )
})

test('returns all usages when resolvedCallIds is not provided', () => {
  const messages = [
    {
      message: {
        role: 'assistant',
        content: [{ type: 'toolCall', id: 'pending', name: 'read' }],
        usage: { input: 100, output: 10, cacheRead: 1, cost: { total: 0.001 } },
      },
    },
  ]

  // Without gating the usage still appears (session-analysis path).
  assert.equal(turnUsageByMessage(messages).size, 1)
  assert.equal(turnUsageByMessage(messages, undefined).size, 1)
})
