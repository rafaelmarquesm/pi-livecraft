import type { JsonObject } from '../shared/types.ts'

/**
 * Durable incremental position into a session's entry log (M2).
 *
 * `get_entries` accepts a `since` cursor of the last entry id seen and returns
 * only entries strictly after it; the response's `leafId` reports the current
 * leaf of the active branch. A cursor stays valid across client restarts and
 * is invalidated only when the branch is rewritten (fork) or the `since` id
 * no longer matches any entry (documented as `success: false`).
 */
export interface EntryCursor {
  /** Last entry id seen; passed as `since` on the next incremental fetch. */
  lastEntryId: string | null
  /** Leaf id of the active branch when the cursor was last advanced. */
  leafId: string | null
}

export function emptyEntryCursor(): EntryCursor {
  return { lastEntryId: null, leafId: null }
}

/** Decides the next `get_entries` request given the current cursor. */
export function nextEntriesRequest(
  cursor: EntryCursor | null,
): { type: 'get_entries' } | { type: 'get_entries'; since: string } {
  return cursor?.lastEntryId
    ? { type: 'get_entries', since: cursor.lastEntryId }
    : { type: 'get_entries' }
}

/**
 * Whether a `get_entries` response invalidates the cached entry list.
 * A branch rewrite moves `leafId`; a failed response means the `since` id no
 * longer exists. Both require a full refetch, and both are normal paths.
 */
export function entriesResponseRequiresReset(
  cursor: EntryCursor,
  success: boolean,
  responseLeafId: unknown,
): boolean {
  if (!success) return true
  const leafId = typeof responseLeafId === 'string' ? responseLeafId : null
  return cursor.leafId !== leafId
}

/** Appends incremental entries to the cached list (assumes a strict delta). */
export function mergeEntryDeltas(cached: JsonObject[], delta: JsonObject[]): JsonObject[] {
  if (delta.length === 0) return cached
  const seen = new Set<string>()
  for (const entry of cached) {
    if (typeof entry.id === 'string') seen.add(entry.id)
  }
  const appended = delta.filter((entry) => typeof entry.id !== 'string' || !seen.has(entry.id))
  return appended.length === 0 ? cached : [...cached, ...appended]
}

/** Builds the cursor from a full (non-incremental) response. */
export function cursorFromFullResponse(entries: JsonObject[], leafId: unknown): EntryCursor {
  return {
    lastEntryId: lastEntryIdIn(entries),
    leafId: typeof leafId === 'string' ? leafId : null,
  }
}

/** Advances the cursor after a successful incremental response. */
export function advanceEntryCursor(
  cursor: EntryCursor,
  delta: JsonObject[],
  leafId: unknown,
): EntryCursor {
  return {
    lastEntryId: lastEntryIdIn(delta) ?? cursor.lastEntryId,
    leafId: typeof leafId === 'string' ? leafId : null,
  }
}

function lastEntryIdIn(entries: JsonObject[]): string | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const id = entries[index]?.id
    if (typeof id === 'string') return id
  }
  return null
}
