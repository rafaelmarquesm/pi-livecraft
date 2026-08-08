import assert from 'node:assert/strict'
import test from 'node:test'
import type { SessionMessage } from '../shared/types.ts'
import {
  MAX_SEARCH_MATCHES,
  searchableText,
  searchMessages,
  SNIPPET_RADIUS,
} from '../src/features/conversation/conversation-search.ts'

function entry(
  message: Record<string, unknown>,
  extra: { entryId?: string } = {},
): SessionMessage {
  return { ...extra, message }
}

test('extracts searchable text per role', () => {
  assert.equal(searchableText({ role: 'user', content: 'plain prompt' }), 'plain prompt')
  assert.equal(
    searchableText({
      role: 'user',
      content: [
        { type: 'text', text: 'part one' },
        { type: 'text', text: ' part two' },
        { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' },
      ],
    }),
    'part one part two',
  )
  assert.equal(
    searchableText({
      role: 'assistant',
      content: [
        { type: 'text', text: 'the answer' },
        { type: 'thinking', thinking: 'private reasoning' },
      ],
    }),
    'the answer\nprivate reasoning',
  )
  assert.equal(
    searchableText({
      role: 'toolResult',
      toolCallId: 'call_1',
      toolName: 'bash',
      content: [{ type: 'text', text: 'file listing output' }],
    }),
    'file listing output',
  )
  assert.equal(
    searchableText({
      role: 'custom',
      customType: 'compaction',
      display: true,
      content: 'summary of the conversation',
    }),
    'summary of the conversation',
  )
  assert.equal(searchableText({ role: 'system', content: 'ignored' }), null)
  assert.equal(
    searchableText({
      role: 'assistant',
      content: [{ type: 'toolCall', id: 'call_1', name: 'bash', arguments: { command: 'ls' } }],
    }),
    null,
  )
  assert.equal(searchableText({ role: 'toolResult', toolCallId: 'c', toolName: 'x' }), null)
})

test('falls back to message.output for assistant text', () => {
  assert.equal(searchableText({ role: 'assistant', output: 'plain output' }), 'plain output')
})

test('indexes assistant thinking with display styling stripped', () => {
  const messages = [entry({
    role: 'assistant',
    content: [{ type: 'thinking', thinking: '\x1b[38;2;56;189;248mplan\x1b[0m' }],
  })]
  assert.equal(searchMessages(messages, 'plan').length, 1)
  assert.equal(searchMessages(messages, '\x1b[38;2').length, 0)
})

test('searches toolResult text inside a nested content object', () => {
  const messages = [entry({
    role: 'toolResult',
    toolCallId: 'call_1',
    toolName: 'read',
    content: { content: [{ type: 'text', text: 'file contains a secret' }] },
  })]
  const matches = searchMessages(messages, 'secret')
  assert.equal(matches.length, 1)
  assert.equal(matches[0].index, 0)
})

test('matches case-insensitively', () => {
  const messages = [entry({ role: 'user', content: 'Hello World' })]
  assert.equal(searchMessages(messages, 'hello').length, 1)
  assert.equal(searchMessages(messages, 'WORLD').length, 1)
  assert.equal(searchMessages(messages, 'HeLlO wOrLd').length, 1)
  assert.equal(searchMessages(messages, 'missing').length, 0)
})

test('returns [] for an empty or whitespace query', () => {
  const messages = [entry({ role: 'user', content: 'anything' })]
  assert.deepEqual(searchMessages(messages, ''), [])
  assert.deepEqual(searchMessages(messages, '   '), [])
})

test('returns [] when nothing matches', () => {
  const messages = [
    entry({ role: 'user', content: 'hello there' }),
    entry({ role: 'assistant', content: [{ type: 'text', text: 'general answer' }] }),
  ]
  assert.deepEqual(searchMessages(messages, 'needle'), [])
})

test('caps matches at MAX_SEARCH_MATCHES', () => {
  const messages = Array.from(
    { length: 200 },
    () => entry({ role: 'user', content: 'needle needle needle' }),
  )
  const matches = searchMessages(messages, 'needle')
  assert.equal(matches.length, MAX_SEARCH_MATCHES)
  assert.equal(matches[0].index, 0)
  assert.equal(matches[matches.length - 1].index, 166)
})

test('returns every match in document order across and within messages', () => {
  const messages = [
    entry({ role: 'user', content: 'needle one' }, { entryId: 'aaa' }),
    entry({
      role: 'assistant',
      content: [{ type: 'text', text: 'two needles: needle again' }],
    }, { entryId: 'bbb' }),
  ]
  const matches = searchMessages(messages, 'needle')
  assert.deepEqual(matches.map(({ index }) => index), [0, 1, 1])
  assert.deepEqual(matches.map(({ entryId }) => entryId), ['aaa', 'bbb', 'bbb'])
})

test('carries the message entry id and array index', () => {
  const messages = [
    entry({ role: 'user', content: 'first query here' }, { entryId: 'aaa' }),
    entry({
      role: 'assistant',
      content: [{ type: 'text', text: 'second response' }],
    }, { entryId: 'bbb' }),
  ]
  assert.deepEqual(searchMessages(messages, 'response'), [
    { entryId: 'bbb', index: 1, snippet: 'second response' },
  ])
})

test('omits entryId for messages without one', () => {
  const matches = searchMessages([entry({ role: 'user', content: 'find me' })], 'find')
  assert.equal(matches.length, 1)
  assert.equal(matches[0].entryId, undefined)
})

test('builds snippets clamped to the text start', () => {
  const text = `needle${'x'.repeat(200)}`
  const [match] = searchMessages([entry({ role: 'user', content: text })], 'needle')
  assert.ok(match)
  assert.equal(match.snippet, `needle${'x'.repeat(SNIPPET_RADIUS)}…`)
})

test('builds snippets clamped to the text end', () => {
  const text = `${'y'.repeat(200)}needle`
  const [match] = searchMessages([entry({ role: 'user', content: text })], 'needle')
  assert.ok(match)
  assert.equal(match.snippet, `…${'y'.repeat(SNIPPET_RADIUS)}needle`)
})

test('keeps short texts whole without ellipses', () => {
  const text = 'a needle here'
  const [match] = searchMessages([entry({ role: 'user', content: text })], 'needle')
  assert.ok(match)
  assert.equal(match.snippet, text)
})
