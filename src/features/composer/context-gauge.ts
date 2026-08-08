import type { SessionStats } from '../../../shared/types.ts'

/** Context-gauge CSS classes, matching the existing status-bar styles. */
export type ContextGaugeClass = '' | 'context-warning' | 'context-warning-strong' | 'context-danger'

/** Context usage is usable; percent is the rounded value to display. */
export interface ContextGaugeValue {
  kind: 'value'
  percent: number
  className: ContextGaugeClass
}

/** Context usage was reported but the percent is null (e.g. right after compaction). */
export interface ContextGaugeUnknown {
  kind: 'unknown'
  className: ''
}

/** No context usage at all (no model/context window). */
export interface ContextGaugeMissing {
  kind: 'missing'
  className: ''
}

export type ContextGaugeState = ContextGaugeValue | ContextGaugeUnknown | ContextGaugeMissing

/**
 * Decides how to render context usage in the status bar.
 * - 'value' — percent is usable; warning classes apply at 20/30/40.
 * - 'unknown' — context usage exists but the percent is null (e.g. right after
 *   compaction); render '—' with an explanatory tooltip.
 * - 'missing' — no context usage at all (no model/context window); render '—'.
 */
export function contextGaugeState(
  contextUsage: SessionStats['contextUsage'],
): ContextGaugeState {
  if (contextUsage === undefined || contextUsage === null) {
    return { kind: 'missing', className: '' }
  }
  if (typeof contextUsage.percent !== 'number') {
    return { kind: 'unknown', className: '' }
  }
  const className = contextUsage.percent >= 40
    ? 'context-danger'
    : contextUsage.percent >= 30
    ? 'context-warning-strong'
    : contextUsage.percent >= 20
    ? 'context-warning'
    : ''
  return { kind: 'value', percent: Math.round(contextUsage.percent), className }
}
