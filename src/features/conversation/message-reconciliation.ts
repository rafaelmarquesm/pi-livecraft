import { isObject } from '../../../shared/is-object.ts'
import type { JsonObject, SessionMessage } from '../../../shared/types.ts'
import { toolCallsInMessage, type ToolCall } from './tool-protocol.ts'

export type AssistantTurnPart = { kind: 'message'; message: JsonObject } | {
  kind: 'tool'
  call: ToolCall
}

export interface LiveMessage {
  id: string
  message: JsonObject
}

export type ConversationMessageEntry =
  | { key: string; message: JsonObject; source: 'history'; historyIndex: number }
  | { key: string; message: JsonObject; source: 'live' }

/** Matches assistant messages by role, timestamp when available, and serialized content. */
export function sameAssistantMessage(left: JsonObject, right: JsonObject): boolean {
  if (left.role !== 'assistant' || right.role !== 'assistant') return false
  if (
    typeof left.timestamp === 'number' && typeof right.timestamp === 'number'
    && left.timestamp !== right.timestamp
  ) return false
  const leftContent = assistantContentKey(left)
  const rightContent = assistantContentKey(right)
  return leftContent !== null && rightContent !== null && leftContent === rightContent
}

/** Extracts the concatenated text from a user message's content, or null when no text is present. */
function extractUserText(message: JsonObject): string | null {
  if (message.role !== 'user') return null
  const content = message.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const text = content
      .filter((part): part is { type: string; text: string } =>
        isObject(part) && part.type === 'text' && typeof part.text === 'string'
      )
      .map((part) => part.text)
      .join('')
    return text || null
  }
  return null
}

/** Returns a stable comparison key without reserializing the same message for every candidate. */
function messageMatchKey(message: JsonObject): string | null {
  const userText = extractUserText(message)
  if (userText !== null) return `user\u0000${userText}`
  const assistantContent = assistantContentKey(message)
  return assistantContent === null ? null : `assistant\u0000${assistantContent}`
}

function assistantContentKey(message: JsonObject): string | null {
  if (message.role !== 'assistant') return null
  const content = message.content ?? message.output
  if (content === undefined) return null
  return JSON.stringify(content) ?? null
}

/** Checks the non-content part of a match after both messages share an index key. */
function sameIndexedMessage(left: JsonObject, right: JsonObject): boolean {
  if (left.role === 'user' && right.role === 'user') return extractUserText(left) !== null
  if (left.role !== 'assistant' || right.role !== 'assistant') return false
  return !(
    typeof left.timestamp === 'number' && typeof right.timestamp === 'number'
    && left.timestamp !== right.timestamp
  )
}

/** Matches messages so optimistic users reconcile with history and assistants retain their identity. */
export function sameMessage(left: JsonObject, right: JsonObject): boolean {
  const leftKey = messageMatchKey(left)
  return leftKey !== null && leftKey === messageMatchKey(right)
    && sameIndexedMessage(left, right)
}

/** Merges history and streamed messages while retaining each streamed message's React identity. */
export function conversationMessageEntries(
  historyMessages: SessionMessage[],
  liveMessages: LiveMessage[],
): ConversationMessageEntry[] {
  const liveByKey = new Map<string, LiveMessage[]>()
  for (const live of liveMessages) {
    const key = messageMatchKey(live.message)
    if (key === null) continue
    const bucket = liveByKey.get(key)
    if (bucket) bucket.push(live)
    else liveByKey.set(key, [live])
  }
  const matchedLiveIds = new Set<string>()
  const historyEntries = historyMessages.map((entry, historyIndex): ConversationMessageEntry => {
    const message = entry.message
    const key = messageMatchKey(message)
    const candidates = key === null ? undefined : liveByKey.get(key)
    const candidateIndex = candidates
      ?.findIndex((live) => sameIndexedMessage(message, live.message)) ?? -1
    const live = candidateIndex >= 0 ? candidates?.[candidateIndex] : undefined
    if (live) {
      matchedLiveIds.add(live.id)
      candidates?.splice(candidateIndex, 1)
    }
    return {
      key: live?.id ?? entry.entryId
        ?? `history-${String(message.timestamp ?? '')}-${historyIndex}`,
      message,
      source: 'history',
      historyIndex,
    }
  })
  return [
    ...historyEntries,
    ...liveMessages
      .filter(({ id }) => !matchedLiveIds.has(id))
      .map(({ id, message }) => ({ key: id, message, source: 'live' as const })),
  ]
}

/** Returns assistant content before the tool calls belonging to that message. */
export function assistantTurnParts(message: JsonObject): AssistantTurnPart[] {
  return [
    { kind: 'message', message },
    ...toolCallsInMessage(message).map((call) => ({ kind: 'tool' as const, call })),
  ]
}
