import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test, { type TestContext } from 'node:test'
import { RpcProcess, getPiVersion } from './support/rpc-process.ts'
import { isObject } from '../shared/is-object.ts'
import type { JsonObject } from '../shared/types.ts'

const validatedWorkExtension = resolve('pi-extensions/validated-work/index.ts')
const validatedWorkStatusKey = 'pi-livecraft.validated-work'
const validatedWorkConfigType = 'pi-livecraft.validated-work-config'
const probeStatusKey = 'probe-tools'
const readOnlyTools = new Set(['read', 'grep', 'find', 'ls', 'ask_user_question', 'validated_work'])

function createSessionDir(): string {
  return mkdtempSync(join(tmpdir(), 'pi-validated-work-'))
}

function writeProbeExtension(directory: string): string {
  const path = join(directory, 'probe-tools.ts')
  writeFileSync(
    path,
    [
      'export default function (pi) {',
      '  pi.registerCommand("probe-tools", {',
      '    description: "publish active tool names",',
      '    handler: async (_args, ctx) => {',
      `      ctx.ui.setStatus("${probeStatusKey}", JSON.stringify(pi.getActiveTools()))`,
      '    },',
      '  })',
      '}',
      '',
    ]
      .join('\n'),
  )
  return path
}

function extensionRpc(directory: string, sessionPath?: string): RpcProcess {
  const probe = writeProbeExtension(directory)
  const args = [
    '--offline',
    '--no-extensions',
    '--session-dir',
    directory,
    '--extension',
    validatedWorkExtension,
    '--extension',
    probe,
  ]
  if (sessionPath) args.push('--session', sessionPath)
  return new RpcProcess({ args, cwd: directory })
}

function writeActiveSession(directory: string): string {
  const sessionPath = join(directory, 'active-validated-work.jsonl')
  const lines = [
    {
      type: 'session',
      version: 3,
      id: '77777777-1111-4222-8333-444444444444',
      timestamp: '2026-08-10T00:00:00.000Z',
      cwd: directory,
    },
    {
      type: 'custom',
      id: 'validated-config',
      parentId: null,
      timestamp: '2026-08-10T00:00:01.000Z',
      customType: validatedWorkConfigType,
      data: {
        protocol: validatedWorkConfigType,
        version: 1,
        mode: 'validated',
        updatedAt: 1,
        toolsBeforePlanning: ['bash', 'read'],
      },
    },
  ]
  writeFileSync(sessionPath, lines.map((line) => `${JSON.stringify(line)}\n`).join(''))
  return sessionPath
}

async function cleanup(directory: string, pi: RpcProcess): Promise<void> {
  await pi.terminate()
  rmSync(directory, { recursive: true, force: true })
}

async function prompt(pi: RpcProcess, message: string): Promise<JsonObject> {
  const response = await pi.request({ type: 'prompt', message }, 30_000)
  assert.equal(response.type, 'response')
  return response
}

async function publishTools(pi: RpcProcess): Promise<string[]> {
  const response = await prompt(pi, '/probe-tools')
  assert.equal(response.success, true)
  const event = await waitForStatus(pi, probeStatusKey)
  const text = typeof event.statusText === 'string' ? event.statusText : '[]'
  const value = JSON.parse(text) as unknown
  assert.ok(Array.isArray(value))
  assert.ok(value.every((name) => typeof name === 'string'))
  return value
}

async function waitForStatus(pi: RpcProcess, key: string): Promise<JsonObject> {
  return await pi.waitForEvent(
    (event) =>
      event.type === 'extension_ui_request' && event.method === 'setStatus'
      && event.statusKey === key,
    20_000,
  )
}

test('real Pi offline keeps Validated Work inactive by default and activates/restores tools', {
  timeout: 60_000,
}, async (t: TestContext) => {
  const directory = createSessionDir()
  const pi = extensionRpc(directory)
  try {
    const initialTools = await publishTools(pi)
    assert.equal(initialTools.includes('validated_work'), false)
    assert.equal(
      pi.collectEvents().some((event) => event.statusKey === validatedWorkStatusKey),
      false,
    )

    const activation = await prompt(pi, '/livecraft-validated-work plan')
    if (!activation.success) {
      t.skip(`pi ${getPiVersion()} rejected extension command: ${String(activation.error)}`)
      return
    }
    const summaryEvent = await waitForStatus(pi, validatedWorkStatusKey)
    const summary = parseSummary(summaryEvent)
    assert.equal(summary.mode, 'plan')
    assert.equal(summary.phase, 'planning')

    const planningTools = await publishTools(pi)
    assert.ok(planningTools.includes('validated_work'))
    assert.ok(planningTools.every((name) => readOnlyTools.has(name)), planningTools.join(', '))

    const malformed = await prompt(pi, '/livecraft-validated-work {"mode":"bad"}')
    assert.equal(malformed.type, 'response')

    const approval = await prompt(pi, '/livecraft-validated-work {"action":"approve"}')
    assert.equal(approval.success, true)
    await waitForStatus(pi, validatedWorkStatusKey)
    const restoredTools = await publishTools(pi)
    assert.deepEqual(restoredTools, initialTools)
  } finally {
    await cleanup(directory, pi)
  }
})

test('real Pi offline resumes active validated-work config from the session branch', {
  timeout: 60_000,
}, async () => {
  const directory = createSessionDir()
  const sessionPath = writeActiveSession(directory)
  const resumed = extensionRpc(directory, sessionPath)
  try {
    const summary = parseSummary(await waitForStatus(resumed, validatedWorkStatusKey))
    assert.equal(summary.mode, 'validated')
    assert.equal(summary.phase, 'planning')
  } finally {
    await cleanup(directory, resumed)
  }
})

function parseSummary(event: JsonObject): JsonObject {
  assert.equal(typeof event.statusText, 'string')
  const text = event.statusText as string
  assert.ok(new TextEncoder().encode(text).length <= 2_048)
  const value = JSON.parse(text) as unknown
  assert.ok(isObject(value))
  assert.equal(value.protocol, 'pi-livecraft.validated-work-summary')
  assert.equal(value.version, 1)
  return value
}
