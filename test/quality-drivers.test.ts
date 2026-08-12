import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { QualityManifest } from '../evals/quality/manifest.ts'
import { sha256Text } from '../evals/quality/fingerprint.ts'
import { runQualityCampaign } from '../evals/quality/runner.ts'
import { runBoundedProcess } from '../evals/quality/process.ts'
import { createLivecraftQualityDriver } from '../evals/quality/drivers/livecraft.ts'
import { createPiDirectQualityDriver } from '../evals/quality/drivers/pi-direct.ts'
import {
  applyGeneratedTaskFakeRepair,
  GENERATED_TASK_REVISION,
  generatedTaskFingerprint,
  generatedTaskPrompt,
  type GeneratedTaskId,
} from '../evals/quality/tasks/generated.ts'

function manifest(
  taskId: GeneratedTaskId = 'parser-repair',
  arm: QualityManifest['cells'][number]['arm'] = 'livecraft-standard',
): QualityManifest {
  const seed = 'seed1'
  const prompt = generatedTaskPrompt(taskId, seed)
  return {
    campaignId: 'driver-smoke',
    cells: [{
      arm,
      attempts: 1,
      id: `${arm}-${taskId}`,
      promptHash: sha256Text(prompt),
      seed,
      taskFingerprint: generatedTaskFingerprint(taskId, seed),
      taskId,
      taskRevision: GENERATED_TASK_REVISION,
    }],
    environment: { arch: 'arm64', node: 'v24.0.0', os: 'darwin' },
    limits: { maxCostUsd: 1, maxTimeMs: 30_000, maxTurns: 4 },
    livecraftRevision: 'offline-fake',
    observed: { model: 'fake-model', provider: 'fake-provider', thinking: 'none' },
    pi: { executableSha256: sha256Text('fake-pi'), version: 'fake' },
    requested: { model: 'fake-model', provider: 'fake-provider', thinking: 'none' },
    resources: { concurrency: 1 },
    review: {},
    timestamps: { createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    validatedWork: { mode: 'fake' },
    version: 1,
  }
}

test('bounded process execution reports timeouts without using a shell', async () => {
  const result = await runBoundedProcess(process.execPath, ['-e', 'setTimeout(() => {}, 1000)'], {
    timeoutMs: 50,
  })
  assert.equal(result.timedOut, true)
  assert.notEqual(result.signal, null)
})

test('pi-direct driver captures requested and observed config through a fake RPC process', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quality-pi-direct-test-'))
  try {
    const script = join(root, 'fake-pi.cjs')
    await writeFile(
      script,
      `
const fs = require('node:fs')
const readline = require('node:readline')
const fixed = ${
        JSON.stringify(
          `function stripInlineComment(value) { let quoted = false; let output = ''; for (const char of value) { if (char === '"') quoted = !quoted; if (char === '#' && !quoted) break; output += char; } return output.trim(); }\nfunction coerceValue(raw) { const value = stripInlineComment(raw); if (value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1); if (value === 'true') return true; if (value === 'false') return false; if (/^-?\\d+(?:\\.\\d+)?$/.test(value)) return Number(value); return value; }\nfunction parseConfig(text) { const result = {}; for (const rawLine of text.split('\\n')) { const line = rawLine.trim(); if (!line || line.startsWith('#')) continue; const separator = line.indexOf('='); if (separator === -1) continue; const key = line.slice(0, separator).trim(); result[key] = coerceValue(line.slice(separator + 1)); } return result; }\nmodule.exports = { parseConfig };\n`,
        )
      }
const logPath = process.env.QUALITY_RPC_LOG
const rl = readline.createInterface({ input: process.stdin })
rl.on('line', (line) => {
  const request = JSON.parse(line)
  if (request.type === 'prompt') {
    if (logPath) fs.appendFileSync(logPath, JSON.stringify(request) + '\\n')
    const isValidatedCommand = String(request.message).startsWith('/livecraft-validated-work')
    if (!isValidatedCommand) fs.writeFileSync('src/config-parser.js', fixed)
    if (!isValidatedCommand) process.stdout.write(JSON.stringify({ type: 'agent_settled' }) + '\\n')
    process.stdout.write(JSON.stringify({ type: 'response', id: request.id, success: true, data: {} }) + '\\n')
  } else if (request.type === 'get_state') {
    process.stdout.write(JSON.stringify({ type: 'response', id: request.id, success: true, data: { model: { provider: 'fake-provider', id: 'fake-model' }, thinkingLevel: 'none' } }) + '\\n')
  } else if (request.type === 'get_session_stats') {
    process.stdout.write(JSON.stringify({ type: 'response', id: request.id, success: true, data: { cost: 0.01, usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 } } }) + '\\n')
  }
})
setInterval(() => {}, 1000)
`,
    )
    const logPath = join(root, 'rpc-log.jsonl')
    const previousLogPath = process.env.QUALITY_RPC_LOG
    process.env.QUALITY_RPC_LOG = logPath
    const qualityManifest = manifest('parser-repair', 'livecraft-validated')
    const result = await runQualityCampaign(
      qualityManifest,
      createPiDirectQualityDriver({
        executable: process.execPath,
        executableArgs: [script],
      }),
    )
    if (previousLogPath === undefined) delete process.env.QUALITY_RPC_LOG
    else process.env.QUALITY_RPC_LOG = previousLogPath
    const trial = result.artifact.trials[0]
    assert.equal(trial.passed, true)
    assert.deepEqual(trial.observed, qualityManifest.requested)
    assert.deepEqual(trial.tokens, { cacheRead: 0, cacheWrite: 0, input: 10, output: 5 })
    const rpcLog = await import('node:fs/promises').then((fs) => fs.readFile(logPath, 'utf8'))
    const messages = rpcLog.trim().split('\n').map((line) => JSON.parse(line).message)
    assert.deepEqual(messages, [
      '/livecraft-validated-work {"mode":"validated"}',
      generatedTaskPrompt('parser-repair', 'seed1'),
    ])
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test('livecraft driver activates validated mode through the backend config endpoint', async () => {
  let cwd = ''
  let status = 'idle'
  const configBodies: unknown[] = []
  const promptMessages: string[] = []
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input))
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {}
    if (url.pathname === '/api/sessions' && init?.method === 'POST') {
      cwd = body.cwd
      return jsonResponse({ id: 'session1', status })
    }
    if (url.pathname === '/api/sessions' && init?.method === 'GET')
      return jsonResponse([{ id: 'session1', status }])
    if (url.pathname === '/api/sessions/session1/validated-work/config') {
      configBodies.push(body)
      return jsonResponse({ mode: 'validated' })
    }
    if (url.pathname === '/api/sessions/session1/commands') {
      if (body.type === 'prompt') {
        promptMessages.push(body.message)
        status = 'running'
        await applyGeneratedTaskFakeRepair({
          cleanup: async () => {},
          hiddenGradeCommand: ['npm', 'run', 'grade'],
          id: 'parser-repair',
          materializeHiddenGrader: async () => {},
          prompt: body.message,
          promptHash: '',
          publicSmokeCommand: ['npm', 'run', 'smoke'],
          revision: GENERATED_TASK_REVISION,
          seed: 'seed1',
          taskFingerprint: '',
          workspace: cwd,
        })
        status = 'idle'
      }
      return jsonResponse({ success: true })
    }
    if (url.pathname === '/api/sessions/session1/snapshot') {
      return jsonResponse({
        state: { model: { id: 'fake-model', provider: 'fake-provider' }, thinkingLevel: 'none' },
        stats: { cost: 0.02, usage: { inputTokens: 20, outputTokens: 6 } },
      })
    }
    if (url.pathname === '/api/sessions/session1/close') return jsonResponse({ closed: true })
    return jsonResponse({ error: 'not found' }, 404)
  }

  const qualityManifest = manifest('parser-repair', 'livecraft-validated')
  const result = await runQualityCampaign(
    qualityManifest,
    createLivecraftQualityDriver({ baseUrl: 'http://127.0.0.1:9999', fetchImpl }),
  )
  const trial = result.artifact.trials[0]
  assert.equal(trial.passed, true)
  assert.deepEqual(trial.observed, qualityManifest.requested)
  assert.deepEqual(trial.tokens, { cacheRead: 0, cacheWrite: 0, input: 20, output: 6 })
  assert.deepEqual(configBodies, [{ mode: 'validated' }])
  assert.equal(promptMessages.length, 1)
  assert.equal(promptMessages[0], generatedTaskPrompt('parser-repair', 'seed1'))
})

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    headers: { 'Content-Type': 'application/json' },
    status,
  })
}
