import type { JsonObject, PromptTemplate, SessionMessage, SessionStats } from '../shared/types.ts'
import { isObject } from '../shared/is-object.ts'
import { activeSessionMessages } from './session-snapshot.ts'
import {
  advanceEntryCursor,
  cursorFromFullResponse,
  entriesResponseRequiresReset,
  mergeEntryDeltas,
  nextEntriesRequest,
  type EntryCursor,
} from './session-entries.ts'
import { loadPromptTemplates } from './prompt-templates.ts'

/**
 * Optional RPC counter for the §4.1 snapshot benchmark. Active only when
 * `PI_LIVECRAFT_DEBUG_RPC=1` so normal operation stays zero-overhead. A warm
 * cache refresh must issue exactly one command (`get_entries {since}`).
 */
export const snapshotRpcDebug: { commands: number } | null =
  process.env.PI_LIVECRAFT_DEBUG_RPC === '1' ? { commands: 0 } : null

/** The subset of ManagerClient used to issue Pi RPC commands from the cache. */
export interface SnapshotCommandClient {
  request(
    request: { action: 'command'; sessionId: string; command: JsonObject },
    timeoutMs?: number,
  ): Promise<unknown>
}

export interface SnapshotRefreshOptions {
  /** Also refresh state and stats in the same pass (skipped on warm refreshes otherwise). */
  stateStats?: boolean
}

/**
 * Per-session cached snapshot data (M2). Entries are advanced incrementally
 * through the entry cursor; state, stats, models, commands, and prompt
 * templates are fetched once per session. All refreshes run through a
 * serialized promise queue so concurrent snapshot GETs cannot race each other
 * or the background event-driven refresh.
 */
export class SnapshotCache {
  entries: JsonObject[] = []
  cursor: EntryCursor | null = null
  state: JsonObject | null = null
  stats: SessionStats | null = null
  models: JsonObject[] = []
  commands: JsonObject[] = []
  promptTemplates: PromptTemplate[] = []

  #queue: Promise<void> = Promise.resolve()
  #initialized = false
  #promptTemplatesLoaded = false

  get messages(): SessionMessage[] {
    return activeSessionMessages(this.entries, this.cursor?.leafId ?? null)
  }

  /** Builds the full cache on first use; on a warm cache refreshes entries incrementally. */
  refresh(
    client: SnapshotCommandClient,
    sessionId: string,
    opts: SnapshotRefreshOptions = {},
  ): Promise<void> {
    const operation = this.#queue.then(async () => {
      if (!this.#initialized) {
        await this.#buildFullCache(client, sessionId)
        return
      }
      await this.#refreshEntries(client, sessionId)
      if (opts.stateStats) await this.#fetchStateStats(client, sessionId)
    })
    this.#queue = operation.catch(() => undefined)
    return operation
  }

  /** Refreshes state only after a command that mutates model/session preferences. */
  refreshState(client: SnapshotCommandClient, sessionId: string): Promise<void> {
    const operation = this.#queue.then(async () => {
      if (!this.#initialized) {
        await this.#buildFullCache(client, sessionId)
        return
      }
      this.state = objectData(await this.#command(client, sessionId, { type: 'get_state' }))
    })
    this.#queue = operation.catch(() => undefined)
    return operation
  }

  /** Refreshes state and stats only, for background reconciliation after Pi events. */
  refreshStateStats(client: SnapshotCommandClient, sessionId: string): Promise<void> {
    const operation = this.#queue.then(async () => {
      if (!this.#initialized) {
        await this.#buildFullCache(client, sessionId)
        return
      }
      await this.#fetchStateStats(client, sessionId)
    })
    this.#queue = operation.catch(() => undefined)
    return operation
  }

  async #buildFullCache(client: SnapshotCommandClient, sessionId: string): Promise<void> {
    const [state, entries, models, commands, stats] = await Promise.all([
      this.#command(client, sessionId, { type: 'get_state' }),
      this.#command(client, sessionId, { type: 'get_entries' }),
      this.#command(client, sessionId, { type: 'get_available_models' }),
      this.#command(client, sessionId, { type: 'get_commands' }),
      this.#command(client, sessionId, { type: 'get_session_stats' }),
    ])
    const entryList = arrayData(entries, 'entries')
    this.entries = entryList
    this.cursor = cursorFromFullResponse(entryList, objectData(entries)?.leafId)
    this.state = objectData(state)
    this.models = arrayData(models, 'models')
    this.commands = arrayData(commands, 'commands')
    this.stats = objectData(stats) as SessionStats | null
    this.#initialized = true
    if (!this.#promptTemplatesLoaded) {
      this.promptTemplates = await loadPromptTemplates(this.commands)
      this.#promptTemplatesLoaded = true
    }
  }

  /** Issues exactly one RPC on a warm cache; a reset triggers a full entries refetch. */
  async #refreshEntries(client: SnapshotCommandClient, sessionId: string): Promise<void> {
    const cursor = this.cursor ?? cursorFromFullResponse([], null)
    const response = await this.#command(client, sessionId, nextEntriesRequest(cursor))
    const success = response.success !== false
    const leafId = objectData(response)?.leafId
    if (entriesResponseRequiresReset(cursor, success, leafId)) {
      const full = await this.#command(client, sessionId, { type: 'get_entries' })
      const fullList = arrayData(full, 'entries')
      this.entries = fullList
      this.cursor = cursorFromFullResponse(fullList, objectData(full)?.leafId)
      return
    }
    const delta = arrayData(response, 'entries')
    this.entries = mergeEntryDeltas(this.entries, delta)
    this.cursor = advanceEntryCursor(cursor, delta, leafId)
  }

  async #fetchStateStats(client: SnapshotCommandClient, sessionId: string): Promise<void> {
    const [state, stats] = await Promise.all([
      this.#command(client, sessionId, { type: 'get_state' }),
      this.#command(client, sessionId, { type: 'get_session_stats' }),
    ])
    this.state = objectData(state)
    this.stats = objectData(stats) as SessionStats | null
  }

  async #command(
    client: SnapshotCommandClient,
    sessionId: string,
    command: JsonObject,
  ): Promise<JsonObject> {
    if (snapshotRpcDebug) snapshotRpcDebug.commands += 1
    const response = await client.request({ action: 'command', sessionId, command })
    if (!isObject(response)) throw new Error('Invalid response from Pi manager')
    return response
  }
}

/** Per-session registry of snapshot caches, cleared when sessions exit or are reassigned. */
export class SnapshotCaches {
  readonly #caches = new Map<string, SnapshotCache>()

  /** Returns the refreshed cache so callers can read the snapshot fields. */
  async refresh(
    client: SnapshotCommandClient,
    sessionId: string,
    opts: SnapshotRefreshOptions = {},
  ): Promise<SnapshotCache> {
    const cache = this.#cacheFor(sessionId)
    await cache.refresh(client, sessionId, opts)
    return cache
  }

  refreshState(client: SnapshotCommandClient, sessionId: string): Promise<void> {
    return this.#cacheFor(sessionId).refreshState(client, sessionId)
  }

  refreshStateStats(client: SnapshotCommandClient, sessionId: string): Promise<void> {
    return this.#cacheFor(sessionId).refreshStateStats(client, sessionId)
  }

  clear(sessionId: string): void {
    this.#caches.delete(sessionId)
  }

  #cacheFor(sessionId: string): SnapshotCache {
    let cache = this.#caches.get(sessionId)
    if (!cache) {
      cache = new SnapshotCache()
      this.#caches.set(sessionId, cache)
    }
    return cache
  }
}

function objectData(response: JsonObject): JsonObject | null {
  return isObject(response.data) ? response.data : null
}

function arrayData(response: JsonObject, key: string): JsonObject[] {
  if (!isObject(response.data) || !Array.isArray(response.data[key])) return []
  return response.data[key].filter(isObject)
}
