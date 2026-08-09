import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { RpcProcess, getPiVersion } from './support/rpc-process.ts'
import { isObject } from '../shared/is-object.ts'
import type { JsonObject } from '../shared/types.ts'

/**
 * Session-scoped RPC integration suite. Session commands (`fork`, `clone`,
 * `export_html`) need a persisted session, which offline mode never produces
 * on its own (the session file is written only after the first assistant
 * response, and offline prompts never reach the LLM). Each test therefore
 * either prompts offline and inspects the resulting entries, or opens a
 * minimal valid session JSONL crafted below (see
 * node_modules/@earendil-works/pi-coding-agent/docs/session-format.md).
 *
 * Version differences follow the existing convention: a session command that
 * fails in offline mode, or a documented contract the installed Pi does not
 * honor, becomes a `t.skip` with a specific reason instead of a CI failure.
 */
function createSessionDir(): string {
  return mkdtempSync(join(tmpdir(), 'pi-rpc-capabilities-'))
}

function writeCraftedSession(directory: string): string {
  const sessionPath = join(directory, 'session.jsonl')
  const header = {
    type: 'session',
    version: 3,
    id: 'aaaaaaaa-1111-2222-3333-444444444444',
    timestamp: '2024-12-03T14:00:00.000Z',
    cwd: directory,
  }
  const modelChange = {
    type: 'model_change',
    id: '11111111',
    parentId: null,
    timestamp: '2024-12-03T14:00:00.500Z',
    provider: 'anthropic',
    modelId: 'claude-sonnet-4-5',
  }
  const thinkingChange = {
    type: 'thinking_level_change',
    id: '22222222',
    parentId: '11111111',
    timestamp: '2024-12-03T14:00:00.750Z',
    thinkingLevel: 'medium',
  }
  const userMessage = {
    type: 'message',
    id: '33333333',
    parentId: '22222222',
    timestamp: '2024-12-03T14:00:01.000Z',
    message: { role: 'user', content: 'Hello from crafted session' },
  }
  const assistantMessage = {
    type: 'message',
    id: '44444444',
    parentId: '33333333',
    timestamp: '2024-12-03T14:00:02.000Z',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'Hi!' }],
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: 'stop',
    },
  }
  const lines = [header, modelChange, thinkingChange, userMessage, assistantMessage]
  writeFileSync(sessionPath, lines.map((line) => `${JSON.stringify(line)}\n`).join(''))
  return sessionPath
}

function sessionRpc(directory: string, sessionPath?: string): RpcProcess {
  const args = ['--offline', '--session-dir', directory]
  if (sessionPath) args.push('--session', sessionPath)
  return new RpcProcess({ args, cwd: directory })
}

function cleanup(directory: string, pi: RpcProcess): Promise<void> {
  rmSync(directory, { recursive: true, force: true })
  return pi.terminate()
}

test(
  'T-RPC-1 get_fork_messages lists user messages with entry ids',
  { timeout: 60_000 },
  async (t) => {
    const directory = createSessionDir()
    const sessionPath = writeCraftedSession(directory)
    const pi = sessionRpc(directory, sessionPath)
    try {
      const response = await pi.request({ type: 'get_fork_messages' })
      if (!response.success) {
        t.skip(`get_fork_messages failed in offline mode: ${String(response.error)}`)
        return
      }
      assert.ok(isObject(response.data) && Array.isArray(response.data.messages))
      const messages = response.data.messages as JsonObject[]
      assert.ok(messages.length > 0, 'crafted session contributes one user message')
      for (const message of messages) {
        assert.equal(typeof message.entryId, 'string')
        assert.equal(typeof message.text, 'string')
      }
    } finally {
      await cleanup(directory, pi)
    }
  },
)

test('T-RPC-2 fork moves the session to a new session file', { timeout: 60_000 }, async (t) => {
  const directory = createSessionDir()
  const sessionPath = writeCraftedSession(directory)
  const pi = sessionRpc(directory, sessionPath)
  try {
    // Empirically verified on pi 0.84.1: an offline prompt creates entries
    // but never persists the session, and fork on such a session fails with
    // "This session has not been saved yet. Wait for the first assistant
    // response before cloning or forking it." The crafted, saved session
    // JSONL below is the persisted-session path fork requires.
    const forkMessages = await pi.request({ type: 'get_fork_messages' })
    if (
      !forkMessages.success || !isObject(forkMessages.data)
      || !Array.isArray(forkMessages.data.messages) || forkMessages.data.messages.length === 0
    ) {
      t.skip('no user-message entry available for forking in offline mode')
      return
    }
    const first = (forkMessages.data.messages as JsonObject[])[0]
    assert.equal(typeof first.entryId, 'string')

    const stateBefore = await pi.request({ type: 'get_state' })
    const sessionFileBefore = isObject(stateBefore.data) ? stateBefore.data.sessionFile : undefined
    assert.equal(typeof sessionFileBefore, 'string')

    const fork = await pi.request({ type: 'fork', entryId: first.entryId })
    if (!fork.success) {
      t.skip(`fork failed in offline mode: ${String(fork.error)}`)
      return
    }
    assert.ok(isObject(fork.data))
    assert.equal(typeof fork.data.text, 'string')
    assert.ok((fork.data.text as string).length > 0)
    assert.equal(typeof fork.data.cancelled, 'boolean')

    const stateAfter = await pi.request({ type: 'get_state' })
    const sessionFileAfter = isObject(stateAfter.data) ? stateAfter.data.sessionFile : undefined
    assert.equal(typeof sessionFileAfter, 'string')
    // The manager (Livecraft) session id stays the same after a fork; on the
    // Pi side the runtime moves to a brand-new session file (verified on
    // pi 0.84.1: get_state.sessionFile changes, get_state.sessionId may too).
    assert.notEqual(sessionFileAfter, sessionFileBefore, 'fork moves Pi to a new session file')
    // The branch file header records parentSession, but offline mode only
    // writes a session file after the first assistant response (which never
    // happens), so the file is not persisted here; the fake-Pi manager test
    // covers the hook's session_reassigned broadcast and sessionPath update.
    if (existsSync(sessionFileAfter as string)) {
      const header = JSON.parse(
        readFileSync(sessionFileAfter as string, 'utf8').split('\n')[0],
      ) as JsonObject
      assert.equal(header.parentSession, sessionFileBefore)
    } else {
      t.diagnostic(
        `pi ${getPiVersion()} offline fork did not persist the branch file; parentSession header verified by the clone test and the manager-fork integration test`,
      )
    }
  } finally {
    await cleanup(directory, pi)
  }
})

test(
  'T-RPC-3 clone duplicates the branch into a new session file',
  { timeout: 60_000 },
  async (t) => {
    const directory = createSessionDir()
    const sessionPath = writeCraftedSession(directory)
    const pi = sessionRpc(directory, sessionPath)
    try {
      const stateBefore = await pi.request({ type: 'get_state' })
      const sessionFileBefore = isObject(stateBefore.data)
        ? stateBefore.data.sessionFile
        : undefined
      assert.equal(typeof sessionFileBefore, 'string')

      const clone = await pi.request({ type: 'clone' })
      if (!clone.success) {
        t.skip(`clone failed in offline mode: ${String(clone.error)}`)
        return
      }
      assert.ok(isObject(clone.data))
      assert.equal(typeof clone.data.cancelled, 'boolean')

      const stateAfter = await pi.request({ type: 'get_state' })
      const sessionFileAfter = isObject(stateAfter.data) ? stateAfter.data.sessionFile : undefined
      assert.equal(typeof sessionFileAfter, 'string')
      // E4: clients discover the clone destination because the session file changes.
      assert.notEqual(sessionFileAfter, sessionFileBefore)
      // The clone persists its new session file immediately and the header
      // records the pre-clone session file as parentSession (verified on
      // pi 0.84.1 offline).
      assert.equal(existsSync(sessionFileAfter as string), true, 'clone writes the branch file')
      const header = JSON.parse(
        readFileSync(sessionFileAfter as string, 'utf8').split('\n')[0],
      ) as JsonObject
      assert.equal(header.parentSession, sessionFileBefore)
    } finally {
      await cleanup(directory, pi)
    }
  },
)

test(
  'T-RPC-4 abort_retry answers even without a retry in flight',
  { timeout: 60_000 },
  async () => {
    const directory = createSessionDir()
    const pi = sessionRpc(directory)
    try {
      const response = await pi.request({ type: 'abort_retry' })
      // Outside a retry the command may succeed (0.84.1) or report failure;
      // the contract is that a response arrives and the process stays alive.
      assert.equal(response.type, 'response')
      assert.equal(response.command, 'abort_retry')
      assert.equal(typeof response.success, 'boolean')
    } finally {
      await pi.terminate()
      rmSync(directory, { recursive: true, force: true })
    }
  },
)

test('T-RPC-5 export_html writes a non-empty HTML file', { timeout: 60_000 }, async (t) => {
  const directory = createSessionDir()
  const sessionPath = writeCraftedSession(directory)
  const pi = sessionRpc(directory, sessionPath)
  const outputPath = join(directory, 'exported.html')
  try {
    const response = await pi.request({ type: 'export_html', outputPath })
    if (!response.success) {
      t.skip(`export_html failed in offline mode: ${String(response.error)}`)
      return
    }
    assert.ok(isObject(response.data))
    assert.equal(typeof response.data.path, 'string')
    const exportedPath = response.data.path as string
    assert.equal(existsSync(exportedPath), true)
    assert.ok(statSync(exportedPath).size > 0, 'export is not empty')
    const head = readFileSync(exportedPath, 'utf8').slice(0, 200)
    assert.ok(
      head.toLowerCase().includes('<html') || head.toLowerCase().startsWith('<!doctype html'),
      `exported file looks like HTML, got: ${head.slice(0, 60)}`,
    )
  } finally {
    await cleanup(directory, pi)
  }
})

test(
  'T-RPC-6 get_entries since implements incremental cursor semantics',
  { timeout: 60_000 },
  async (t) => {
    const directory = createSessionDir()
    const pi = sessionRpc(directory)
    try {
      const full = await pi.request({ type: 'get_entries' })
      if (!full.success) {
        t.skip(`get_entries failed in offline mode: ${String(full.error)}`)
        return
      }
      assert.ok(isObject(full.data) && Array.isArray(full.data.entries))
      const entries = full.data.entries as JsonObject[]
      assert.ok(entries.length > 0, 'a session-dir session has startup entries')
      const leafId = full.data.leafId
      const lastId = typeof leafId === 'string' ? leafId : entries[entries.length - 1]?.id
      assert.equal(typeof lastId, 'string')

      // Full fetch, then since=last id: nothing strictly after the leaf yet.
      const emptyDelta = await pi.request({ type: 'get_entries', since: lastId })
      assert.equal(emptyDelta.success, true)
      assert.ok(isObject(emptyDelta.data) && Array.isArray(emptyDelta.data.entries))
      assert.deepEqual(emptyDelta.data.entries, [])

      // A bash command appends context entries without an LLM call. Newer Pi
      // builds return success:false for offline prompts, so prompt was not a
      // version-stable way to exercise the cursor delta.
      const bash = await pi.request({ type: 'bash', command: 'printf incremental-cursor-probe' })
      assert.equal(bash.success, true)
      const delta = await pi.request({ type: 'get_entries', since: lastId })
      assert.equal(delta.success, true)
      assert.ok(isObject(delta.data) && Array.isArray(delta.data.entries))
      const fullIds = new Set(entries.map((entry) => entry.id))
      assert.ok(delta.data.entries.length > 0, 'delta contains the new entry')
      assert.ok(
        (delta.data.entries as JsonObject[]).every((entry) =>
          typeof entry.id === 'string'
          && !fullIds.has(entry.id)
        ),
        'delta contains only entries strictly newer than the cursor',
      )

      // A bogus cursor is the documented invalidation signal, not an error.
      const bogus = await pi.request({ type: 'get_entries', since: 'bogus0000' })
      assert.equal(bogus.success, false)
      assert.equal(typeof bogus.error, 'string')
    } finally {
      await pi.terminate()
      rmSync(directory, { recursive: true, force: true })
    }
  },
)

test(
  'T-RPC-7 set_auto_compaction disables automatic compaction',
  { timeout: 60_000 },
  async (t) => {
    const directory = createSessionDir()
    const pi = sessionRpc(directory)
    try {
      const set = await pi.request({ type: 'set_auto_compaction', enabled: false })
      if (!set.success) {
        t.skip(`set_auto_compaction failed in offline mode: ${String(set.error)}`)
        return
      }
      const state = await pi.request({ type: 'get_state' })
      assert.equal(state.success, true)
      assert.ok(isObject(state.data))
      assert.equal(state.data.autoCompactionEnabled, false)
    } finally {
      await pi.terminate()
      rmSync(directory, { recursive: true, force: true })
    }
  },
)

test('T-RPC-8 set_auto_retry accepts disabling automatic retry', { timeout: 60_000 }, async (t) => {
  const directory = createSessionDir()
  const pi = sessionRpc(directory)
  try {
    // No getter exists for auto-retry (rpc.md documents only the setter), so
    // the contract is that the command is accepted with success: true.
    const response = await pi.request({ type: 'set_auto_retry', enabled: false })
    if (!response.success) {
      t.skip(`set_auto_retry failed in offline mode: ${String(response.error)}`)
      return
    }
    assert.equal(response.command, 'set_auto_retry')
  } finally {
    await pi.terminate()
    rmSync(directory, { recursive: true, force: true })
  }
})

test(
  'T-RPC-9 get_session_stats reports context usage within bounds',
  { timeout: 60_000 },
  async (t) => {
    const directory = createSessionDir()
    const pi = sessionRpc(directory)
    try {
      const response = await pi.request({ type: 'get_session_stats' })
      if (!response.success) {
        t.skip(`get_session_stats failed in offline mode: ${String(response.error)}`)
        return
      }
      assert.ok(isObject(response.data))
      // Per rpc.md, contextUsage is omitted when no model or context window is
      // available, and its tokens/percent are null immediately after compaction.
      // When percent is present it must be a number in 0..100.
      const contextUsage = response.data.contextUsage
      if (
        isObject(contextUsage) && contextUsage.percent !== null
        && contextUsage.percent !== undefined
      ) {
        const percent = contextUsage.percent
        assert.ok(
          typeof percent === 'number',
          `contextUsage.percent must be a number, got ${String(percent)}`,
        )
        if (typeof percent === 'number') assert.ok(percent >= 0 && percent <= 100)
      }
    } finally {
      await pi.terminate()
      rmSync(directory, { recursive: true, force: true })
    }
  },
)

test(
  'H7 unknown commands fail with success:false without crashing Pi',
  { timeout: 60_000 },
  async () => {
    const directory = createSessionDir()
    const pi = sessionRpc(directory)
    try {
      const response = await pi.request({ type: 'pi_livecraft_nonexistent_probe' })
      assert.equal(response.type, 'response')
      assert.equal(response.command, 'pi_livecraft_nonexistent_probe')
      assert.equal(response.success, false)
      assert.equal(typeof response.error, 'string')
      // The process survives and keeps serving commands — the base of the
      // capabilities probe.
      const state = await pi.request({ type: 'get_state' })
      assert.equal(state.success, true)
    } finally {
      await pi.terminate()
      rmSync(directory, { recursive: true, force: true })
    }
  },
)
