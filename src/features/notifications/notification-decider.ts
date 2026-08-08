import type { JsonObject } from '../../../shared/types.ts'
import { settleEventForSession } from '../conversation/session-settled.ts'

export interface NotificationDecision {
  reason: 'settled' | 'retry-exhausted'
}

/**
 * Per-session policy: converts a Pi event stream into notification decisions.
 *
 * The decider is the single place that turns session-run events into the
 * decisions `App.tsx` renders as toasts. It wraps `settleEventForSession`
 * (M3) and adds run-level deduplication:
 *
 * - `agent_settled` produces one `'settled'` decision (E6: `agent_end` never
 *   decides, even with `willRetry: false`).
 * - `auto_retry_end` with `success: false` produces one `'retry-exhausted'`
 *   decision; `auto_retry_end` with `success: true` produces none.
 * - Retry and compaction progress, tool events, queue updates, and message
 *   events produce nothing.
 * - After a `'retry-exhausted'` decision, the next `'settled'` decision from
 *   the same run is suppressed: Pi may or may not emit `agent_settled` after
 *   retry exhaustion, and the policy must not double-notify. A later
 *   `agent_start` re-arms settled notifications for the new run.
 * - No cross-session state: callers use one decider per session, so two
 *   sessions ending together produce two independent decisions.
 */
export class NotificationDecider {
  private suppressNextSettled = false

  receive(event: JsonObject): NotificationDecision | null {
    if (event.type === 'agent_start') {
      // A new run starts: re-arm settled notifications after retry exhaustion.
      this.suppressNextSettled = false
      return null
    }

    const reason = settleEventForSession(event)
    if (reason === null) return null

    if (reason === 'settled') {
      if (this.suppressNextSettled) {
        // Retry exhaustion already notified for this run; drop the trailing
        // agent_settled instead of double-notifying.
        this.suppressNextSettled = false
        return null
      }
      return { reason: 'settled' }
    }

    this.suppressNextSettled = true
    return { reason: 'retry-exhausted' }
  }
}
