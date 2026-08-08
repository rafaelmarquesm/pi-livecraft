import assert from 'node:assert/strict'
import { chmod, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { connect, type Socket } from 'node:net'
import test from 'node:test'
import { isObject } from '../shared/is-object.ts'
import {
  extensionEditorTextLimit,
  extensionStatusTextLimit,
  extensionTitleLimit,
  extensionWidgetLineLimit,
} from '../shared/extension-ui.ts'
import type { JsonObject } from '../shared/types.ts'

/**
 * Manager-side transport hardening for extension UI (T-EXT-5): a fake Pi
 * emits fire-and-forget `extension_ui_request` events (oversized, ANSI-laden)
 * plus a blocking confirm dialog; the client observes that every broadcast is
 * sanitized, that only the confirm enters pendingUi, and that the session
 * still reaches idle after `agent_settled`.
 */
test(
  'sanitizes broadcast extension UI requests and keeps only the confirm blocking',
  { timeout: 15_000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pi-manager-ext-ui-'))
    const port = 46_000 + (process.pid % 10_000)
    await writeFakePi(directory, 'sequence')
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

      const statusEvent = client.waitForEvent(piRequestOf('setStatus'))
      const widgetEvent = client.waitForEvent(piRequestOf('setWidget'))
      const titleEvent = client.waitForEvent(piRequestOf('setTitle'))
      const editorEvent = client.waitForEvent(piRequestOf('set_editor_text'))
      const confirmEvent = client.waitForEvent(piRequestOf('confirm'))
      const settledEvent = client.waitForEvent((event) =>
        event.event === 'pi'
        && isObject(event.data)
        && event.data.type === 'agent_settled'
      )

      const prompt = await client.request('command', {
        sessionId,
        command: { type: 'prompt', message: 'hi' },
      })
      assert.equal(prompt.ok, true)

      const [status, widget, title, editor, confirm, settled] = await Promise.all([
        statusEvent,
        widgetEvent,
        titleEvent,
        editorEvent,
        confirmEvent,
        settledEvent,
      ])
      assert.equal(settled.sessionId, sessionId)
      // The blocking confirm passes through the sanitizer unchanged.
      const confirmRequest = requireData(confirm)
      assert.equal(confirmRequest.method, 'confirm')
      assert.equal(confirmRequest.id, 'confirm-1')
      assert.equal(confirmRequest.title, 'Question')

      const statusRequest = requireData(status)
      assert.equal(statusRequest.method, 'setStatus')
      assert.equal(statusRequest.statusKey, 'my-ext')
      assert.equal(typeof statusRequest.statusText, 'string')
      assert.equal((statusRequest.statusText as string).length, extensionStatusTextLimit)
      assert.ok((statusRequest.statusText as string).endsWith('…'))
      assertNoAnsi(statusRequest)

      const widgetRequest = requireData(widget)
      assert.equal(widgetRequest.method, 'setWidget')
      assert.equal(widgetRequest.widgetKey, 'my-ext')
      assert.equal(widgetRequest.widgetPlacement, 'aboveEditor')
      assert.ok(Array.isArray(widgetRequest.widgetLines))
      assert.equal(widgetRequest.widgetLines.length, extensionWidgetLineLimit + 1)
      assert.equal(widgetRequest.widgetLines[extensionWidgetLineLimit], '…')
      assert.ok(
        widgetRequest.widgetLines.every((line) => typeof line === 'string' && line.length <= 200),
      )
      assertNoAnsi(widgetRequest)

      const titleRequest = requireData(title)
      assert.equal(titleRequest.method, 'setTitle')
      assert.equal(typeof titleRequest.title, 'string')
      assert.equal((titleRequest.title as string).length, extensionTitleLimit)
      assert.ok((titleRequest.title as string).endsWith('…'))
      assertNoAnsi(titleRequest)

      const editorRequest = requireData(editor)
      assert.equal(editorRequest.method, 'set_editor_text')
      assert.equal(typeof editorRequest.text, 'string')
      assert.equal((editorRequest.text as string).length, extensionEditorTextLimit)
      assert.ok((editorRequest.text as string).endsWith('…'))
      assertNoAnsi(editorRequest)

      // The confirm is the only request that enters pendingUi; the session
      // already reached idle because agent_settled preceded the prompt response.
      const withConfirm = await client.request('list', {})
      assert.equal(sessionStatusOf(withConfirm, sessionId), 'idle')
      const pendingUi = sessionPendingUi(withConfirm, sessionId)
      assert.deepEqual(
        pendingUi.map((request) => isObject(request) ? request.id : undefined),
        ['confirm-1'],
      )
      const pendingConfirm = pendingUi.find(
        (request): request is JsonObject => isObject(request) && request.id === 'confirm-1',
      )
      assert.equal(pendingConfirm?.method, 'confirm')
      assert.equal(pendingConfirm?.title, 'Question')
      assert.equal(pendingConfirm?.message, 'Do you want to continue?')
      assertNoAnsi(pendingConfirm ?? {})

      // Responding to the confirm clears pendingUi and the session stays idle.
      const response = await client.request('command', {
        sessionId,
        command: { type: 'extension_ui_response', id: 'confirm-1', cancelled: true },
      })
      assert.equal(response.ok, true)
      const cleared = await client.request('list', {})
      assert.equal(sessionStatusOf(cleared, sessionId), 'idle')
      assert.equal(sessionPendingUi(cleared, sessionId).length, 0)
    } finally {
      client.close()
      if (manager.exitCode === null) await stopProcess(manager)
      await rm(directory, { force: true, recursive: true })
    }
  },
)

/**
 * Exercises the buffered-replay path: an extension_ui_request emitted while a
 * Pi process is switching sessions is buffered, then flushed through the same
 * broadcast point and must arrive sanitized.
 */
test(
  'sanitizes extension UI requests replayed from the switching buffer',
  { timeout: 15_000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pi-manager-ext-ui-'))
    const port = 46_000 + (process.pid % 10_000)
    await writeFakePi(directory, 'switch')
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
        PI_LIVECRAFT_IDLE_REUSE_AFTER_MS: '0',
      },
      stdio: 'ignore',
    })
    const client = await connectManager(port)
    try {
      const first = await client.request('open', {
        cwd: process.cwd(),
        name: 'First',
        sessionPath: join(directory, 'first.jsonl'),
      })
      const firstId = sessionIdOf(first)
      await client.request('open', {
        cwd: process.cwd(),
        name: 'Second',
        sessionPath: join(directory, 'second.jsonl'),
      })
      await client.request('open', {
        cwd: process.cwd(),
        name: 'Third',
        sessionPath: join(directory, 'third.jsonl'),
      })
      // The manager decides reuse in a separate process with
      // `Date.now() - idleSince > PI_LIVECRAFT_IDLE_REUSE_AFTER_MS` against
      // the real clock, so no fake-timer control is possible: let the first
      // session's idle timestamp age past the 0 ms threshold.
      await new Promise((resolve) => setTimeout(resolve, 10))

      const reassigned = client.waitForEvent(
        (event) => event.event === 'session_reassigned' && event.sessionId === firstId,
      )
      const bufferedStatus = client.waitForEvent(piRequestOf('setStatus'))
      const fourth = await client.request('open', {
        cwd: process.cwd(),
        name: 'Fourth',
        sessionPath: join(directory, 'fourth.jsonl'),
      })
      assert.equal(fourth.ok, true)
      const fourthId = sessionIdOf(fourth)

      const [reassignedEvent, status] = await Promise.all([reassigned, bufferedStatus])
      assert.equal(
        isObject(reassignedEvent.data) && reassignedEvent.data.newSessionId === fourthId,
        true,
      )
      assert.equal(status.sessionId, fourthId)
      const statusRequest = requireData(status)
      assert.equal(statusRequest.method, 'setStatus')
      assert.equal(statusRequest.statusKey, 'buffered-ext')
      assert.equal(typeof statusRequest.statusText, 'string')
      assert.equal((statusRequest.statusText as string).length, extensionStatusTextLimit)
      assert.ok((statusRequest.statusText as string).endsWith('…'))
      assertNoAnsi(statusRequest)
      assert.equal(sessionStatusOf(await client.request('list', {}), fourthId), 'idle')
    } finally {
      client.close()
      if (manager.exitCode === null) await stopProcess(manager)
      await rm(directory, { force: true, recursive: true })
    }
  },
)

/**
 * Writes a fake `pi` executable that mimics the RPC surface the manager
 * needs. In 'sequence' mode a prompt emits the full extension UI sequence
 * (oversized, ANSI-laden fire-and-forget requests plus a blocking confirm)
 * before responding. In 'switch' mode a switch_session emits a single
 * oversized setStatus that the manager buffers during the switch.
 */
async function writeFakePi(directory: string, mode: 'sequence' | 'switch'): Promise<void> {
  const source = `#!/usr/bin/env node
import readline from 'node:readline'
const sessionDirectory = ${JSON.stringify(directory)}
const sessionArgument = process.argv.indexOf('--session')
const sessionIdArgument = process.argv.indexOf('--session-id')
let sessionPath = sessionArgument !== -1
  ? process.argv[sessionArgument + 1]
  : sessionIdArgument !== -1
  ? sessionDirectory + '/' + process.argv[sessionIdArgument + 1] + '.jsonl'
  : ''
const mode = ${JSON.stringify(mode)}
let streaming = false
function emitLine(value) {
  console.log(JSON.stringify(value))
}
function emitExtensionSequence() {
  emitLine({ type: 'agent_start' })
  emitLine({
    type: 'extension_ui_request',
    id: 'status-1',
    method: 'setStatus',
    statusKey: 'my-ext',
    statusText: '\\u001b[32m' + 'y'.repeat(3900) + '\\u001b[0m' + ' running'
  })
  emitLine({
    type: 'extension_ui_request',
    id: 'widget-1',
    method: 'setWidget',
    widgetKey: 'my-ext',
    widgetLines: Array.from({ length: 150 }, (_, index) => '\\u001b[31mline-' + index + '\\u001b[0m'),
    widgetPlacement: 'aboveEditor'
  })
  emitLine({
    type: 'extension_ui_request',
    id: 'title-1',
    method: 'setTitle',
    title: '\\u001b]0;window\\u0007' + 't'.repeat(300)
  })
  emitLine({
    type: 'extension_ui_request',
    id: 'editor-1',
    method: 'set_editor_text',
    text: '\\u001b[34m' + 'e'.repeat(101000) + '\\u001b[0m'
  })
  emitLine({
    type: 'extension_ui_request',
    id: 'confirm-1',
    method: 'confirm',
    title: 'Question',
    message: 'Do you want to continue?'
  })
  emitLine({ type: 'agent_settled' })
}
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const command = JSON.parse(line)
  if (command.type === 'extension_ui_response') return
  if (command.type === 'new_session') {
    sessionPath = sessionDirectory + '/new-' + process.pid + '.jsonl'
    streaming = false
    emitLine({ type: 'response', id: command.id, success: true, data: { cancelled: false } })
    return
  }
  if (command.type === 'switch_session') {
    sessionPath = command.sessionPath
    streaming = false
    if (mode === 'switch') {
      emitLine({
        type: 'extension_ui_request',
        id: 'buffered-1',
        method: 'setStatus',
        statusKey: 'buffered-ext',
        statusText: '\\u001b[33m' + 'b'.repeat(700) + '\\u001b[0m'
      })
    }
    emitLine({ type: 'response', id: command.id, success: true, data: { cancelled: false } })
    return
  }
  if (command.type === 'prompt') {
    streaming = true
    if (mode === 'sequence') emitExtensionSequence()
    streaming = false
    emitLine({ type: 'response', id: command.id, success: true, data: {} })
    return
  }
  const data = command.type === 'get_state'
    ? { sessionFile: sessionPath, isStreaming: streaming, isCompacting: false, pendingMessageCount: 0 }
    : {}
  emitLine({ type: 'response', id: command.id, success: true, data })
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

function piRequestOf(method: string): (event: ManagerEvent) => boolean {
  return (event) =>
    event.event === 'pi'
    && isObject(event.data)
    && event.data.type === 'extension_ui_request'
    && event.data.method === method
}

function requireData(event: ManagerEvent): JsonObject {
  if (!isObject(event.data)) throw new Error('Manager pi event is missing data')
  return event.data
}

function assertNoAnsi(request: JsonObject): void {
  assert.doesNotMatch(JSON.stringify(request), /\u001b/)
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

function sessionStatusOf(response: ManagerResponse, id: string): unknown {
  if (!Array.isArray(response.data)) throw new Error('Invalid sessions response')
  const session = response.data.find((value) => isObject(value) && value.id === id)
  return isObject(session) ? session.status : undefined
}

function sessionPendingUi(response: ManagerResponse, id: string): JsonObject[] {
  if (!Array.isArray(response.data)) throw new Error('Invalid sessions response')
  const session = response.data.find((value) => isObject(value) && value.id === id)
  if (!isObject(session) || !Array.isArray(session.pendingUi)) return []
  return session.pendingUi.filter((value): value is JsonObject => isObject(value))
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
