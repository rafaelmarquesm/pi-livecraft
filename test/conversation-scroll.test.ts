import assert from 'node:assert/strict'
import test from 'node:test'
import {
  conversationHistoryStart,
  isNearConversationBottom,
  resumesAutoScrollAfterDownwardScroll,
  suspendsAutoScrollAfterUpwardScroll,
} from '../src/features/conversation/conversation-scroll.ts'

test('conversationHistoryStart adds complete user turns in batches', () => {
  const messages = Array.from({ length: 180 }, () => ({ message: { role: 'assistant' } }))
  for (const index of [0, 30, 60, 90, 120, 150]) messages[index] = { message: { role: 'user' } }

  assert.equal(conversationHistoryStart(messages, messages.length), 120)
  assert.equal(conversationHistoryStart(messages, 120), 60)
  assert.equal(conversationHistoryStart(messages, 60), 0)
})

test('conversationHistoryStart bounds a long turn and history without users', () => {
  const longTurn = Array.from({ length: 120 }, () => ({ message: { role: 'assistant' } }))
  longTurn[10] = { message: { role: 'user' } }
  const withoutUser = Array.from({ length: 120 }, () => ({ message: { role: 'assistant' } }))

  assert.equal(conversationHistoryStart(longTurn, longTurn.length), 70)
  assert.equal(conversationHistoryStart(longTurn, 70), 10)
  assert.equal(conversationHistoryStart(withoutUser, withoutUser.length), 70)
})

test('isNearConversationBottom identifies viewport proximity to conversation bottom', () => {
  assert.equal(isNearConversationBottom(1_000, 2_000, 1_000), true)
  assert.equal(isNearConversationBottom(951, 2_000, 1_000), true)
  assert.equal(isNearConversationBottom(950, 2_000, 1_000), false)
  assert.equal(isNearConversationBottom(500, 2_000, 1_000), false)
})

test('suspends automatic scrolling after any upward movement', () => {
  assert.equal(suspendsAutoScrollAfterUpwardScroll(1_000, 999), true)
  assert.equal(suspendsAutoScrollAfterUpwardScroll(1_000, 1_000), false)
  assert.equal(suspendsAutoScrollAfterUpwardScroll(1_000, 1_001), false)
})

test('resumes automatic scrolling only after a downward scroll near the bottom', () => {
  assert.equal(resumesAutoScrollAfterDownwardScroll(950, 940, 2_000, 1_000), false)
  assert.equal(resumesAutoScrollAfterDownwardScroll(900, 940, 2_000, 1_000), false)
  assert.equal(resumesAutoScrollAfterDownwardScroll(900, 960, 2_000, 1_000), true)
})
