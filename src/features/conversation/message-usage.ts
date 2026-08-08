import type { JsonObject, SessionMessage } from '../../../shared/types.ts'
import { isObject } from '../../../shared/is-object.ts'
import { toolCallsInMessage } from './tool-protocol.ts'

export interface MessageUsage {
  cacheMiss: number
  cacheRead: number
  cacheWrite: number
  cost: number
  output: number
}

/** Extracts final counters associated with a Pi response or tool result. */
export function messageUsage(message: JsonObject): MessageUsage | null {
  const usage = isObject(message.usage) ? message.usage : null
  const cost = usage && isObject(usage.cost) ? usage.cost : null
  if (
    !usage || !cost || !isNumber(usage.input) || !isNumber(usage.cacheRead) || !isNumber(
      usage.output,
    ) || !isNumber(cost.total)
  ) return null
  return {
    cacheMiss: usage.input,
    cacheRead: usage.cacheRead,
    cacheWrite: isNumber(usage.cacheWrite) ? usage.cacheWrite : 0,
    cost: cost.total,
    output: usage.output,
  }
}

export function formatTurnCost(value: number): string {
  const digits = value < 0.01 ? 4 : 2
  return `$${
    new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
      .format(value)
  }`
}

export function formatTokens(value: number): string {
  return value >= 1000 ? `${Math.round(value / 1000)}k` : String(value)
}

/** Associates each agent turn with the billed counters from its assistant response.
 * When resolvedCallIds is provided, only returns usage for messages whose tool calls
 * have all been resolved (result received). */
export function turnUsageByMessage(
  messages: readonly SessionMessage[],
  resolvedCallIds?: ReadonlySet<string>,
): Map<number, MessageUsage> {
  return new Map(messages.flatMap((entry, index) => {
    const message = entry.message
    const usage = message.role === 'assistant' ? messageUsage(message) : null
    if (!usage) return []
    if (resolvedCallIds !== undefined) {
      const calls = toolCallsInMessage(message)
      if (calls.length > 0 && calls.some((call) => !resolvedCallIds.has(call.id))) return []
    }
    return [[index, usage] as const]
  }))
}

/** Formats an observed millisecond duration for display. */
export function formatDuration(value: number): string {
  if (value < 1000) return `${Math.round(value)} ms`
  return `${
    new Intl.NumberFormat(navigator.language, { maximumFractionDigits: 1 }).format(value / 1000)
  } s`
}
function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}
