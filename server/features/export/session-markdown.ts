import { isObject } from '../../../shared/is-object.ts'
import type { JsonObject, SessionMessage } from '../../../shared/types.ts'

export interface SessionMarkdownMeta {
  /** Session display name, used as the document title. */
  name: string
  /** Working directory recorded as provenance, when known. */
  cwd?: string
  /** Fixed export instant; injectable so golden tests stay deterministic. */
  exportedAt?: Date
}

/**
 * Serializes the visible conversation to Markdown (S §1.1). Pure and
 * deterministic: same messages in, same document out. Tool calls render as
 * fenced JSON blocks, results as indented fenced output, and images as a
 * placeholder (binary data never leaves the session file).
 */
export function sessionToMarkdown(messages: SessionMessage[], meta: SessionMarkdownMeta): string {
  const lines: string[] = [`# ${meta.name}`, '']
  const exported = (meta.exportedAt ?? new Date()).toISOString()
  lines.push(`_Exported ${exported}_`)
  if (meta.cwd) lines.push(`_Workspace: \`${meta.cwd}\`_`)
  lines.push('')

  for (const { message } of messages) {
    const block = messageToMarkdown(message)
    if (block) lines.push(block, '')
  }
  return `${lines.join('\n').trimEnd()}\n`
}

function messageToMarkdown(message: JsonObject): string | null {
  if (message.role === 'user') return section('User', userContentToMarkdown(message.content))
  if (message.role === 'assistant') return assistantToMarkdown(message)
  if (message.role === 'toolResult') return toolResultToMarkdown(message)
  if (message.role === 'custom' && message.display === true) {
    const label = typeof message.customType === 'string' ? message.customType : 'custom'
    const body = typeof message.content === 'string' ? message.content : null
    return body ? section(`Note — ${label}`, body) : null
  }
  return null
}

function assistantToMarkdown(message: JsonObject): string | null {
  const content = message.content ?? message.output
  if (!Array.isArray(content)) return null
  const parts: string[] = []
  for (const part of content) {
    if (!isObject(part)) continue
    if (part.type === 'text' && typeof part.text === 'string' && part.text.trim())
      parts.push(part.text.trimEnd())
    else if (part.type === 'thinking' && typeof part.thinking === 'string' && part.thinking.trim())
      parts.push(`> **Thinking**\n${quoteBlock(part.thinking.trim())}`)
    else if (part.type === 'toolCall' && typeof part.name === 'string') {
      const args = part.arguments === undefined ? '{}' : JSON.stringify(part.arguments, null, 2)
      parts.push(`**Tool call: \`${part.name}\`**\n\n\`\`\`json\n${args}\n\`\`\``)
    }
  }
  if (message.stopReason === 'error' && typeof message.errorMessage === 'string')
    parts.push(`> ⚠️ ${message.errorMessage}`)
  return parts.length ? section('Assistant', parts.join('\n\n')) : null
}

function toolResultToMarkdown(message: JsonObject): string | null {
  const name = typeof message.toolName === 'string' ? message.toolName : 'tool'
  const body = contentText(message.content)
  const isError = message.isError === true
  const title = `Tool result: \`${name}\`${isError ? ' (error)' : ''}`
  if (!body) return `**${title}**\n\n_(no output)_`
  const truncated = body.length > 10_000 ? `${body.slice(0, 10_000)}\n… (truncated)` : body
  return `**${title}**\n\n\`\`\`\n${truncated.replaceAll('```', '`\u200B``')}\n\`\`\``
}

function userContentToMarkdown(content: unknown): string | null {
  if (typeof content === 'string') return content.trim() || null
  if (!Array.isArray(content)) return null
  const parts: string[] = []
  for (const part of content) {
    if (!isObject(part)) continue
    if (part.type === 'text' && typeof part.text === 'string' && part.text.trim())
      parts.push(part.text.trimEnd())
    else if (part.type === 'image') parts.push('_[image attached]_')
  }
  return parts.length ? parts.join('\n\n') : null
}

function contentText(content: unknown): string | null {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return null
  const text = content
    .filter((part): part is JsonObject => isObject(part))
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('\n')
  return text.trim() ? text : null
}

function section(title: string, body: string | null): string | null {
  if (!body) return null
  return `## ${title}\n\n${body}`
}

function quoteBlock(text: string): string {
  return text.split('\n').map((line) => `> ${line}`).join('\n')
}
