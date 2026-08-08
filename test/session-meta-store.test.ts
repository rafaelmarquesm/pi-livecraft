import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  loadSessionMeta,
  parseSessionMetaStore,
  saveSessionMeta,
  validateSessionMeta,
} from '../server/features/sessions/session-meta-store.ts'

const meta = { pinned: true, tags: ['deep-dive', 'bug'], note: 'Needs a second look.' }

test('round-trips session metadata keyed by canonical session path', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-livecraft-session-meta-'))
  const path = join(directory, 'session-meta.json')
  try {
    assert.deepEqual(await saveSessionMeta('/sessions/a.jsonl', meta, path), meta)
    assert.deepEqual(await saveSessionMeta('/sessions/b.jsonl', { pinned: false }, path), {
      pinned: false,
    })

    assert.deepEqual(await loadSessionMeta(path), {
      '/sessions/a.jsonl': meta,
      '/sessions/b.jsonl': { pinned: false },
    })
    assert.equal((await readFile(path, 'utf8')).endsWith('\n'), true)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test('returns an empty store when the file does not exist', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-livecraft-session-meta-'))
  try {
    assert.deepEqual(await loadSessionMeta(join(directory, 'missing.json')), {})
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test('serializes concurrent writes, cleans temp files, and writes with mode 0o600', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-livecraft-session-meta-'))
  const path = join(directory, 'session-meta.json')
  try {
    await Promise.all([
      saveSessionMeta('/sessions/a.jsonl', { note: 'a' }, path),
      saveSessionMeta('/sessions/b.jsonl', { note: 'b' }, path),
      saveSessionMeta('/sessions/c.jsonl', { note: 'c' }, path),
    ])

    assert.deepEqual(await loadSessionMeta(path), {
      '/sessions/a.jsonl': { note: 'a' },
      '/sessions/b.jsonl': { note: 'b' },
      '/sessions/c.jsonl': { note: 'c' },
    })
    assert.deepEqual(
      (await readdir(directory)).filter((name) => name.endsWith('.tmp')),
      [],
    )
    assert.equal((await stat(path)).mode & 0o777, 0o600)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test('removes the entry when saving an empty meta object', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-livecraft-session-meta-'))
  const path = join(directory, 'session-meta.json')
  try {
    await saveSessionMeta('/sessions/a.jsonl', { pinned: true }, path)
    await saveSessionMeta('/sessions/b.jsonl', { note: 'kept' }, path)
    await saveSessionMeta('/sessions/a.jsonl', {}, path)

    assert.deepEqual(await loadSessionMeta(path), { '/sessions/b.jsonl': { note: 'kept' } })
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test('honors the PI_LIVECRAFT_SESSION_META_STORE environment override', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-livecraft-session-meta-'))
  const envPath = join(directory, 'env-meta.json')
  const previous = process.env.PI_LIVECRAFT_SESSION_META_STORE
  process.env.PI_LIVECRAFT_SESSION_META_STORE = envPath
  try {
    assert.deepEqual(await saveSessionMeta('/sessions/env.jsonl', { pinned: true }), {
      pinned: true,
    })
    assert.deepEqual(await loadSessionMeta(), { '/sessions/env.jsonl': { pinned: true } })
    assert.equal((await readFile(envPath, 'utf8')).includes('"pinned": true'), true)
  } finally {
    if (previous === undefined) delete process.env.PI_LIVECRAFT_SESSION_META_STORE
    else process.env.PI_LIVECRAFT_SESSION_META_STORE = previous
    await rm(directory, { force: true, recursive: true })
  }
})

test('validates tags, note, and unknown keys strictly', () => {
  assert.deepEqual(validateSessionMeta(meta), meta)
  assert.deepEqual(validateSessionMeta({ tags: ['ok'] }), { tags: ['ok'] })
  assert.deepEqual(validateSessionMeta({ tags: ['  padded  '] }), { tags: ['padded'] })

  assert.throws(() => validateSessionMeta('nope'), /Invalid session metadata/)
  assert.throws(() => validateSessionMeta({ pinned: 'yes' }), /Invalid session metadata/)
  assert.throws(() => validateSessionMeta({ tags: 'a,b' }), /Invalid session metadata/)
  assert.throws(() => validateSessionMeta({ tags: ['a', ''] }), /Invalid session metadata/)
  assert.throws(
    () => validateSessionMeta({ tags: ['x'.repeat(41)] }),
    /Invalid session metadata/,
  )
  assert.throws(
    () => validateSessionMeta({ tags: Array.from({ length: 9 }, () => 'a') }),
    /Invalid session metadata/,
  )
  assert.throws(
    () => validateSessionMeta({ note: 'x'.repeat(2001) }),
    /Invalid session metadata/,
  )
  assert.throws(() => validateSessionMeta({ favorite: true }), /Invalid session metadata/)
})

test('parseSessionMetaStore rejects malformed or invalid content', () => {
  assert.deepEqual(
    parseSessionMetaStore(
      JSON.stringify({ '/sessions/a.jsonl': { pinned: true, tags: ['t'], note: 'n' } }),
    ),
    { '/sessions/a.jsonl': { pinned: true, tags: ['t'], note: 'n' } },
  )
  assert.throws(() => parseSessionMetaStore('not json'), SyntaxError)
  assert.throws(() => parseSessionMetaStore('[]'), /Invalid Pi Livecraft session meta store/)
  assert.throws(
    () => parseSessionMetaStore(JSON.stringify({ '/sessions/bad.jsonl': { pinned: 1 } })),
    /Invalid session metadata/,
  )
})

test('saveSessionMeta rejects invalid input without touching the store', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-livecraft-session-meta-'))
  const path = join(directory, 'session-meta.json')
  try {
    assert.throws(
      () => saveSessionMeta('/sessions/a.jsonl', { tags: ['x'.repeat(41)] }, path),
      /Invalid session metadata/,
    )
    assert.throws(
      () => saveSessionMeta('', { pinned: true }, path),
      /Invalid session path/,
    )
    assert.deepEqual(await loadSessionMeta(path), {})
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})
