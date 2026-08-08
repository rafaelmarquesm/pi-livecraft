const NEAR_BOTTOM_THRESHOLD = 50
const HISTORY_RENDER_BATCH_SIZE = 50

/** Finds a bounded recent render boundary, preferring a nearby complete user turn. */
export function conversationHistoryStart(
  messages: readonly { message: { role?: unknown } }[],
  beforeIndex: number,
): number {
  const end = Math.min(messages.length, Math.max(0, beforeIndex))
  const tentativeStart = Math.max(0, end - HISTORY_RENDER_BATCH_SIZE)
  if (tentativeStart === 0) return 0
  const alignmentStart = Math.max(0, tentativeStart - HISTORY_RENDER_BATCH_SIZE)
  for (let index = tentativeStart; index >= alignmentStart; index -= 1) {
    if (messages[index]?.message.role === 'user') return index
  }
  return tentativeStart
}

/** True when the viewport is within the threshold of the conversation bottom. */
export function isNearConversationBottom(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
): boolean {
  return scrollHeight - scrollTop - clientHeight < NEAR_BOTTOM_THRESHOLD
}

/** Identifies any upward movement that should stop following live output. */
export function suspendsAutoScrollAfterUpwardScroll(
  previousScrollTop: number,
  scrollTop: number,
): boolean {
  return scrollTop < previousScrollTop
}

/** Identifies a manual downward scroll that has returned near the conversation end. */
export function resumesAutoScrollAfterDownwardScroll(
  previousScrollTop: number,
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
): boolean {
  return scrollTop > previousScrollTop
    && isNearConversationBottom(scrollTop, scrollHeight, clientHeight)
}
