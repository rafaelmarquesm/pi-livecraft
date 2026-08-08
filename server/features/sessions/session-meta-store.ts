import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { SessionMeta, SessionMetaStore } from '../../../shared/types.ts'
import { isObject } from '../../../shared/is-object.ts'

const defaultSessionMetaStorePath = join(homedir(), '.pi-livecraft', 'session-meta.json')
const maxSessionPathLength = 1000
const maxTags = 8
const maxTagLength = 40
const maxNoteLength = 2000
let saveQueue = Promise.resolve()

/** Resolves the store path, honoring the per-call override and the environment override. */
function storePath(path?: string): string {
  return path ?? process.env.PI_LIVECRAFT_SESSION_META_STORE ?? defaultSessionMetaStorePath
}

/** Loads the global session metadata registry keyed by canonical session path. */
export async function loadSessionMeta(path?: string): Promise<SessionMetaStore> {
  try {
    return parseSessionMetaStore(await readFile(storePath(path), 'utf8'))
  } catch (error) {
    if (isNotFound(error)) return {}
    throw error
  }
}

/** Atomically stores one session's metadata by serializing writes to the shared registry. */
export function saveSessionMeta(
  sessionPath: string,
  meta: SessionMeta,
  path?: string,
): Promise<SessionMeta> {
  if (
    typeof sessionPath !== 'string' || !sessionPath.trim()
    || sessionPath.length > maxSessionPathLength
  ) throw new Error('Invalid session path')
  const validatedMeta = validateSessionMeta(meta)
  const storeFile = storePath(path)
  const operation = saveQueue.then(async () => {
    let store: SessionMetaStore
    try {
      store = parseSessionMetaStore(await readFile(storeFile, 'utf8'))
    } catch (error) {
      if (!isNotFound(error)) throw error
      store = {}
    }

    if (Object.keys(validatedMeta).length > 0) store[sessionPath] = validatedMeta
    else delete store[sessionPath]
    const temporaryPath = `${storeFile}.${process.pid}.tmp`
    await mkdir(dirname(storeFile), { recursive: true })
    await writeFile(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 })
    await rename(temporaryPath, storeFile)
  })
  saveQueue = operation.catch(() => undefined)
  return operation.then(() => validatedMeta)
}

/** Validates and normalizes a session metadata object, rejecting unknown or oversized fields. */
export function validateSessionMeta(value: unknown): SessionMeta {
  if (!isObject(value)) throw new Error('Invalid session metadata')
  for (const key of Object.keys(value)) {
    if (key !== 'pinned' && key !== 'tags' && key !== 'note')
      throw new Error('Invalid session metadata')
  }
  const meta: SessionMeta = {}
  if (value.pinned !== undefined) {
    if (typeof value.pinned !== 'boolean') throw new Error('Invalid session metadata')
    meta.pinned = value.pinned
  }
  if (value.tags !== undefined) {
    if (!Array.isArray(value.tags) || value.tags.length > maxTags)
      throw new Error('Invalid session metadata')
    meta.tags = value.tags.map((tag) => {
      if (typeof tag !== 'string' || tag.trim().length === 0 || tag.length > maxTagLength)
        throw new Error('Invalid session metadata')
      return tag.trim()
    })
  }
  if (value.note !== undefined) {
    if (typeof value.note !== 'string' || value.note.length > maxNoteLength)
      throw new Error('Invalid session metadata')
    meta.note = value.note
  }
  return meta
}

/** Parses the on-disk session metadata JSON into a structured session-path-to-meta map. */
export function parseSessionMetaStore(content: string): SessionMetaStore {
  const value: unknown = JSON.parse(content)
  if (!isObject(value)) throw new Error('Invalid Pi Livecraft session meta store')
  return Object.fromEntries(
    Object.entries(value).map(([sessionPath, meta]) => [sessionPath, validateSessionMeta(meta)]),
  )
}

function isNotFound(error: unknown): boolean {
  return isObject(error) && error.code === 'ENOENT'
}
