import type { JsonObject } from '../../../shared/types.ts'

/**
 * Reasons a session-level run can finish. Consumers (native notifications,
 * document title, quota refresh, ledger flush) subscribe to this single signal
 * instead of reimplementing the Pi event decision (M3).
 */
export type SettleReason = 'settled' | 'aborted' | 'retry-exhausted' | 'exited'

/**
 * Returns a settle signal for a Pi event, or null when the event does not
 * finish a session-level run.
 *
 * `agent_settled` is the only signal that a run is truly over: `agent_end`
 * may still be followed by an automatic retry, compaction retry, or queued
 * continuation (E6). `auto_retry_end` with `success: false` is a settle
 * signal too: the retry loop exhausted itself without settling the run.
 */
export function settleEventForSession(event: JsonObject): SettleReason | null {
  if (event.type === 'agent_settled') return 'settled'
  if (event.type === 'auto_retry_end' && event.success === false) return 'retry-exhausted'
  return null
}
