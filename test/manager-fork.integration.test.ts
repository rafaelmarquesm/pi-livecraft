import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { chmod, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { connect, type Socket } from 'node:net'
import test from 'node:test'
import { isObject } from '../shared/is-object.ts'
import type { JsonObject } from '../shared/types.ts'

/**
 * Manager hook for fork/clone (Fase 3.1/3.2): a fake Pi that, like the real
 * Pi 0.84.1, moves to a new session file on `fork` (the new file's header
 * records `parentSession`) and emits `session_start`. The manager must keep
 * its own session id, update `summary.sessionPath` from the follow-up
 * get_state, broadcast `session_reassigned`, and soft-fail when that
 * follow-up read fails — the fork itself already succeeded.
 */
test(
  'a successful fork broadcasts session_reassigned and updates the session path',
  { timeout: 15_000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pi-manager-fork-'))
    const port = 46_000 + (process.pid % 10_000)
    await writeFakePi(directory, 'fork')
    const manager = spawn(process.execPath, ['server/manager.ts'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PATH: `${
          process.platform === 'win32'
            ? join(directory, 'node_modules', '.bin')
            : directory
        }${delimiter}${process.env.PATH}`,
        PI_LIVECRAFT_MANAGER_PORT: String(port),
      },
      stdio: 'ignore',
    })
    const client = await connectManager(port)
    try {
      const created = await client.request('create', { cwd: process.cwd() })
      assert.equal(created.ok, true)
      const sessionId = sessionIdOf(created)
      const originalPath = sessionPathOf(created)

      const reassigned = client.waitForEvent(
        (event) => event.event === 'session_reassigned' && event.sessionId === sessionId,
      )
      const fork = await client.request('command', {
        sessionId,
        command: { type: 'fork', entryId: '33333333' },
      })
      // The manager passes the full Pi RPC envelope through, so the fork
      // result lives at data.data.
      assert.equal(fork.ok, true)
      assert.ok(isObject(fork.data))
      assert.equal(fork.data.success, true)
      assert.ok(isObject(fork.data.data))
      assert.equal(fork.data.data.text, 'Forked branch')
      assert.equal(fork.data.data.cancelled, false)

      // (a) the manager broadcasts the existing session_reassigned event,
      // keeping the same manager session id.
      const event = await reassigned
      assert.equal(event.sessionId, sessionId)
      // The reuse path attaches data.newSessionId; the fork path must not,
      // so the frontend can distinguish a same-id reassignment.
      assert.equal(event.data, undefined)

      // (b) a subsequent list shows the updated sessionPath (and name).
      const listed = await client.request('list', {})
      assert.equal(sessionPathOf(listed, sessionId), join(directory, 'forked-1.jsonl'))
      assert.equal(sessionNameOf(listed, sessionId), 'Forked session')

      // The fake Pi wrote the new branch file whose header records the
      // pre-fork session file as parentSession, mirroring the real Pi.
      const forkedPath = join(directory, 'forked-1.jsonl')
      assert.equal(existsSync(forkedPath), true)
      const header = JSON.parse(readFileSync(forkedPath, 'utf8').split('\n')[0]) as JsonObject
      assert.equal(header.parentSession, originalPath)
    } finally {
      client.close()
      if (manager.exitCode === null) await stopProcess(manager)
      await rm(directory, { force: true, recursive: true })
    }
  },
)

test(
  'a failed fork changes nothing: no reassigned event and the session path stays',
  { timeout: 15_000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pi-manager-fork-fail-'))
    const port = 46_000 + (process.pid % 10_000)
    await writeFakePi(directory, 'fork-fail')
    const manager = spawn(process.execPath, ['server/manager.ts'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PATH: `${
          process.platform === 'win32'
            ? join(directory, 'node_modules', '.bin')
            : directory
        }${delimiter}${process.env.PATH}`,
        PI_LIVECRAFT_MANAGER_PORT: String(port),
      },
      stdio: 'ignore',
    })
    const client = await connectManager(port)
    try {
      const created = await client.request('create', { cwd: process.cwd() })
      assert.equal(created.ok, true)
      const sessionId = sessionIdOf(created)
      const originalPath = sessionPathOf(created)

      const fork = await client.request('command', {
        sessionId,
        command: { type: 'fork', entryId: '33333333' },
      })
      // Pi reports success:false; the manager surfaces it as a failed command.
      assert.equal(fork.ok, false)
      assert.equal(fork.error, 'Invalid entry ID for forking')
      assert.equal(client.hasSeen((event) => event.event === 'session_reassigned'), false)

      const listed = await client.request('list', {})
      assert.equal(sessionPathOf(listed, sessionId), originalPath)
    } finally {
      client.close()
      if (manager.exitCode === null) await stopProcess(manager)
      await rm(directory, { force: true, recursive: true })
    }
  },
)

test(
  'a get_state failure after a successful fork does not reject the fork response',
  { timeout: 15_000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pi-manager-fork-state-'))
    const port = 46_000 + (process.pid % 10_000)
    await writeFakePi(directory, 'fork-state-error')
    const manager = spawn(process.execPath, ['server/manager.ts'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PATH: `${
          process.platform === 'win32'
            ? join(directory, 'node_modules', '.bin')
            : directory
        }${delimiter}${process.env.PATH}`,
        PI_LIVECRAFT_MANAGER_PORT: String(port),
      },
      stdio: 'ignore',
    })
    const client = await connectManager(port)
    try {
      const created = await client.request('create', { cwd: process.cwd() })
      assert.equal(created.ok, true)
      const sessionId = sessionIdOf(created)
      const originalPath = sessionPathOf(created)

      const fork = await client.request('command', {
        sessionId,
        command: { type: 'fork', entryId: '33333333' },
      })
      // (d) the hook's follow-up get_state fails, but the fork response
      // still reaches the client unchanged.
      assert.equal(fork.ok, true)
      assert.ok(isObject(fork.data))
      assert.equal(fork.data.success, true)
      assert.ok(isObject(fork.data.data))
      assert.equal(fork.data.data.cancelled, false)
      // Without a successful state read there is nothing to update or
      // broadcast, so the summary stays on the original session file.
      assert.equal(client.hasSeen((event) => event.event === 'session_reassigned'), false)
      const listed = await client.request('list', {})
      assert.equal(sessionPathOf(listed, sessionId), originalPath)
    } finally {
      client.close()
      if (manager.exitCode === null) await stopProcess(manager)
      await rm(directory, { force: true, recursive: true })
    }
  },
)

/**
 * Writes a fake `pi` executable that mimics the RPC surface the manager
 * needs for the fork hook. In 'fork' mode a `fork` command moves the runtime
 * to a new session file whose header records `parentSession`, emits
 * `session_start`, and responds success. 'fork-fail' responds success:false
 * without touching state. 'fork-state-error' behaves like 'fork' but makes
 * the follow-up get_state fail, exercising the hook's soft-fail path.
 */
async function writeFakePi(
  directory: string,
  mode: 'fork' | 'fork-fail' | 'fork-state-error',
): Promise<void> {
  const source = `#!/usr/bin/env node
import readline from 'node:readline'
import { writeFileSync } from 'node:fs'
const sessionDirectory = ${JSON.stringify(directory)}
const sessionArgument = process.argv.indexOf('--session')
const sessionIdArgument = process.argv.indexOf('--session-id')
let sessionPath = sessionArgument !== -1
  ? process.argv[sessionArgument + 1]
  : sessionIdArgument !== -1
  ? sessionDirectory + '/' + process.argv[sessionIdArgument + 1] + '.jsonl'
  : ''
const mode = ${JSON.stringify(mode)}
let sessionName = 'Original session'
let forkCount = 0
let failNextState = false
function emitLine(value) {
  console.log(JSON.stringify(value))
}
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const command = JSON.parse(line)
  if (command.type === 'get_state') {
    if (failNextState) {
      failNextState = false
      emitLine({ type: 'response', id: command.id, success: false, error: 'state read exploded' })
      return
    }
    emitLine({
      type: 'response',
      id: command.id,
      success: true,
      data: {
        sessionFile: sessionPath,
        sessionName,
        isStreaming: false,
        isCompacting: false,
        pendingMessageCount: 0
      }
    })
    return
  }
  if (command.type === 'fork') {
    if (mode === 'fork-fail') {
      emitLine({ type: 'response', id: command.id, success: false, error: 'Invalid entry ID for forking' })
      return
    }
    const previousPath = sessionPath
    forkCount += 1
    sessionPath = sessionDirectory + '/forked-' + forkCount + '.jsonl'
    writeFileSync(sessionPath, JSON.stringify({
      type: 'session',
      version: 3,
      id: 'forked-' + forkCount,
      timestamp: new Date().toISOString(),
      cwd: sessionDirectory,
      parentSession: previousPath
    }) + '\\n')
    sessionName = 'Forked session'
    if (mode === 'fork-state-error') failNextState = true
    emitLine({ type: 'session_start' })
    emitLine({ type: 'response', id: command.id, success: true, data: { text: 'Forked branch', cancelled: false } })
    return
  }
  emitLine({ type: 'response', id: command.id, success: true, data: {} })
})
`
  if (process.platform === 'win32') {
    const packageRoot = join(directory, 'node_modules', '@earendil-works', 'pi-coding-agent')
    const bin = join(directory, 'node_modules', '.bin')
    await mkdir(join(packageRoot, 'dist'), { recursive: true })
    await mkdir(bin, { recursive: true })
    await writeFile(
      join(packageRoot, 'package.json'),
      JSON.stringify({ bin: { pi: 'dist/cli.mjs' } }),
    )
    await writeFile(join(packageRoot, 'dist', 'cli.mjs'), source)
    await writeFile(join(bin, 'pi.cmd'), '@echo off')
    return
  }
  const path = join(directory, 'pi')
  await writeFile(path, source)
  await chmod(path, 0o755)
}

interface ManagerResponse {
  kind: 'response'
  id: string
  ok: boolean
  data?: unknown
  error?: string
}

interface ManagerEvent {
  kind: 'event'
  event: string
  sessionId: string
  data?: unknown
}

async function connectManager(
  port: number,
): Promise<
  {
    request: (action: string, fields: Record<string, unknown>) => Promise<ManagerResponse>
    waitForEvent: (predicate: (event: ManagerEvent) => boolean) => Promise<ManagerEvent>
    hasSeen: (predicate: (event: ManagerEvent) => boolean) => boolean
    close: () => void
  }
> {
  const socket = await connectWithRetry(port)
  let buffer = ''
  let requestId = 0
  const pending = new Map<string, (response: ManagerResponse) => void>()
  const events: ManagerEvent[] = []
  const eventWaiters = new Set<() => void>()
  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8')
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line) continue
      const response: unknown = JSON.parse(line)
      if (isManagerResponse(response)) {
        pending.get(response.id)?.(response)
        pending.delete(response.id)
        continue
      }
      if (isManagerEvent(response)) {
        events.push(response)
        for (const notify of eventWaiters) notify()
      }
    }
  })

  return {
    request(action, fields) {
      const id = String(++requestId)
      return new Promise((resolve) => {
        pending.set(id, resolve)
        socket.write(`${JSON.stringify({ id, action, ...fields })}\n`)
      })
    },
    waitForEvent(predicate) {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          eventWaiters.delete(check)
          reject(new Error('Timed out waiting for manager event'))
        }, 5_000)
        function check(): void {
          const index = events.findIndex(predicate)
          if (index === -1) return
          clearTimeout(timeout)
          eventWaiters.delete(check)
          resolve(events.splice(index, 1)[0])
        }
        eventWaiters.add(check)
        check()
      })
    },
    hasSeen(predicate) {
      return events.some(predicate)
    },
    close: () => socket.end(),
  }
}

async function connectWithRetry(port: number): Promise<Socket> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      return await new Promise<Socket>((resolve, reject) => {
        const socket = connect({ host: '127.0.0.1', port })
        socket.once('connect', () => resolve(socket))
        socket.once('error', reject)
      })
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }
  throw new Error('Pi manager did not start')
}

function sessionIdOf(response: ManagerResponse): string {
  if (!isObject(response.data) || typeof response.data.id !== 'string')
    throw new Error('Invalid session response')
  return response.data.id
}

function sessionPathOf(response: ManagerResponse, id?: string): string {
  const session = sessionEntry(response, id)
  if (typeof session.sessionPath !== 'string') throw new Error('Session has no sessionPath')
  return session.sessionPath
}

function sessionNameOf(response: ManagerResponse, id: string): unknown {
  return sessionEntry(response, id).name
}

function sessionEntry(response: ManagerResponse, id?: string): Record<string, unknown> {
  const data = response.data
  const session = id === undefined
    ? isObject(data) ? data : undefined
    : Array.isArray(data)
    ? data.find((value) => isObject(value) && value.id === id)
    : undefined
  if (!isObject(session)) throw new Error('Session not found')
  return session
}

function isManagerResponse(value: unknown): value is ManagerResponse {
  return isObject(value) && value.kind === 'response' && typeof value.id === 'string'
    && typeof value.ok === 'boolean'
}

function isManagerEvent(value: unknown): value is ManagerEvent {
  return isObject(value) && value.kind === 'event' && typeof value.event === 'string'
    && typeof value.sessionId === 'string'
}

async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || !child.pid) return
  if (process.platform === 'win32') {
    const taskkill = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
      shell: false,
      stdio: 'ignore',
      windowsHide: true,
    })
    await once(taskkill, 'exit')
    return
  }
  child.kill('SIGTERM')
  await once(child, 'exit')
}

function once(process: ChildProcess, event: 'exit'): Promise<void> {
  return new Promise((resolve) => process.once(event, () => resolve()))
}
