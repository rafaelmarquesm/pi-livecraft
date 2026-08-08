#!/usr/bin/env node
/**
 * §4.1 — Snapshot benchmark (the heart of M2). Generates a synthetic session
 * with 5,000 messages (chained by parentId, worst case from the plan) and
 * measures cold vs warm snapshot latency against the running backend.
 *
 * Gates (spec §4.1):
 *   - warm bytes <= 5% of cold bytes
 *   - warm latency p50 < 200 ms
 *   - cold latency < 5 s
 * (The "warm refresh == 1 RPC" gate is verified in-process by a unit test with
 *  PI_LIVECRAFT_DEBUG_RPC=1 — the counter lives in the backend's SnapshotCache.)
 *
 * Usage:  node scripts/bench-snapshot.ts
 * Requires the backend (npm run dev) running on PI_LIVECRAFT_BACKEND_PORT (43121).
 */
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const base = `http://127.0.0.1:${process.env.PI_LIVECRAFT_BACKEND_PORT ?? '43121'}`
const MESSAGE_COUNT = Number(process.env.PI_LIVECRAFT_BENCH_MESSAGES ?? 5_000)

/** Builds a synthetic Pi session JSONL with `count` messages chained by parentId. */
function syntheticSession(count: number, id: string, cwd: string): string {
  const now = new Date()
  const lines: string[] = [
    JSON.stringify({
      type: 'session',
      version: 3,
      id,
      timestamp: now.toISOString(),
      cwd,
    }),
    JSON.stringify({
      type: 'model_change',
      id: 'mdl',
      parentId: null,
      timestamp: now.toISOString(),
      provider: 'bench',
      modelId: 'bench-model',
    }),
  ]
  let parentId = 'mdl'
  for (let i = 0; i < count; i += 1) {
    const entryId = `e${i.toString(16).padStart(8, '0')}`
    const role = i % 2 === 0 ? 'user' : 'assistant'
    lines.push(JSON.stringify({
      type: 'message',
      id: entryId,
      parentId,
      timestamp: new Date(now.getTime() + i).toISOString(),
      message: {
        role,
        content: [{ type: 'text', text: `Synthetic message ${i} ${'x'.repeat(120)}` }],
        timestamp: now.getTime() + i,
      },
    }))
    parentId = entryId
  }
  return `${lines.join('\n')}\n`
}

async function main(): Promise<void> {
  // The backend only loads session files stored in Pi's session directory.
  const dir = join(homedir(), '.pi', 'agent', 'sessions', 'bench')
  await mkdir(dir, { recursive: true })
  const file = join(dir, `bench-${Date.now()}.jsonl`)
  const id = crypto.randomUUID()
  // cwd must be a real directory; default to the E2E workspace.
  const cwd = process.env.PI_LIVECRAFT_BENCH_CWD ?? '/tmp/pi-livecraft-e2e-workspace'
  const body = syntheticSession(MESSAGE_COUNT, id, cwd)
  await writeFile(file, body)

  const session = await (await fetch(`${base}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cwd, sessionPath: file }),
  }))
    .json() as { id?: string; error?: string }

  const sid = session.id
  if (!sid) {
    console.error('Failed to open synthetic session:', JSON.stringify(session).slice(0, 500))
    await rm(dir, { recursive: true, force: true })
    process.exit(1)
  }

  const measure = async (): Promise<{ ms: number; bytes: number }> => {
    const start = performance.now()
    const res = await fetch(`${base}/api/sessions/${sid}/snapshot`)
    const bytes = (await res.text()).length
    return { ms: performance.now() - start, bytes }
  }

  // Cold snapshot (first load populates the cache from the full entry list).
  const cold = await measure()
  // Warm snapshot (cache already initialized; refreshes entries incrementally).
  const warmSamples: number[] = []
  for (let i = 0; i < 5; i += 1) warmSamples.push((await measure()).ms)
  warmSamples.sort((a, b) => a - b)
  const warmP50 = warmSamples[2]

  const coldBytes = cold.bytes
  const warmBytes = (await measure()).bytes
  const warmByteRatio = coldBytes === 0 ? 0 : warmBytes / coldBytes

  console.log(`Messages: ${MESSAGE_COUNT}`)
  console.log(`Cold snapshot: ${cold.ms.toFixed(1)} ms, ${coldBytes} bytes`)
  console.log(`Warm snapshot p50: ${warmP50.toFixed(1)} ms, ${warmBytes} bytes`)
  console.log(`Warm/cold byte ratio: ${(warmByteRatio * 100).toFixed(2)}%`)

  const gates = [
    ['cold < 5000 ms', cold.ms < 5_000],
    ['warm p50 < 200 ms', warmP50 < 200],
    ['warm bytes <= 5% of cold', warmByteRatio <= 0.05],
  ]
  for (const [name, pass] of gates) console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`)

  // The "warm refresh == 1 RPC" gate is verified in-process (the counter lives
  // in the backend's SnapshotCache; a separate HTTP process cannot read it).
  // See test/snapshot-cache.test.ts with PI_LIVECRAFT_DEBUG_RPC=1.

  await rm(dir, { recursive: true, force: true })
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
