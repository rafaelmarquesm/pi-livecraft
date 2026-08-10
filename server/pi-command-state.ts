import type { JsonObject } from '../shared/types.ts'

/**
 * Commands whose successful response changes fields returned by `get_state`.
 * Snapshot entries alone cannot reconcile these preferences, so the backend
 * must refresh cached state before responding to the browser.
 */
const stateMutatingCommands = new Set([
  'cycle_model',
  'cycle_thinking_level',
  'set_auto_compaction',
  'set_model',
  'set_thinking_level',
])

export function piCommandMutatesState(command: JsonObject): boolean {
  return typeof command.type === 'string' && stateMutatingCommands.has(command.type)
}
