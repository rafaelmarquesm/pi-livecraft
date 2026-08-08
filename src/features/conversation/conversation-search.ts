import { isObject } from '../../../shared/is-object.ts'
import type { JsonObject, SessionMessage } from '../../../shared/types.ts'
import { reasoningTextForDisplay } from './message-display.ts'
import { toolContentText } from './tool-protocol.ts'

/** A single case-insensitive match inside a conversation message. */
export interface SearchMatch {
  /** Stable session entry id (M1); absent only for synthesized compaction placeholders. */
  entryId?: string
  /** Position of the message within the searched array. */
  index: number
  /** Text around the match (±60 chars), clamped to the extracted text boundaries. */
  snippet: string
}

export const MAX_SEARCH_MATCHES = 500
export const SNIPPET_RADIUS = 60

/** Extracts the searchable text of a protocol message, or null when its role has no text. */
export function searchableText(message: JsonObject): string | null {
  const role = message.role
  if (role === 'user' || role === 'custom') {
    const text = textFromContent(message.content)
    return text || null
  }
  if (role === 'assistant') {
    const text = assistantText(message)
    return text || null
  }
  if (role === 'toolResult') {
    const text = toolContentText(message.content)
    return text || null
  }
  return null
}

/** Searches extracted message text case-insensitively, capped at MAX_SEARCH_MATCHES. */
export function searchMessages(messages: SessionMessage[], query: string): SearchMatch[] {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) return []
  const matches: SearchMatch[] = []
  for (let index = 0; index < messages.length && matches.length < MAX_SEARCH_MATCHES; index += 1) {
    const text = searchableText(messages[index].message)
    if (text === null) continue
    const haystack = text.toLowerCase()
    let from = 0
    let at = haystack.indexOf(needle, from)
    while (at !== -1 && matches.length < MAX_SEARCH_MATCHES) {
      matches.push({
        entryId: messages[index].entryId,
        index,
        snippet: snippetAround(text, at, needle.length),
      })
      from = at + needle.length
      at = haystack.indexOf(needle, from)
    }
  }
  return matches
}

function assistantText(message: JsonObject): string {
  const content = message.content ?? message.output
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .flatMap((part) => {
      if (isObject(part) && part.type === 'text' && typeof part.text === 'string') {
        return [part.text]
      }
      if (isObject(part) && part.type === 'thinking' && typeof part.thinking === 'string') {
        return [reasoningTextForDisplay(message.role, part.thinking)]
      }
      return []
    })
    .join('\n')
}

function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((part): part is { type: 'text'; text: string } =>
      isObject(part) && part.type === 'text' && typeof part.text === 'string'
    )
    .map((part) => part.text)
    .join('')
}

function snippetAround(text: string, at: number, length: number): string {
  const start = Math.max(0, at - SNIPPET_RADIUS)
  const end = Math.min(text.length, at + length + SNIPPET_RADIUS)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < text.length ? '…' : ''
  return `${prefix}${text.slice(start, end)}${suffix}`
}
